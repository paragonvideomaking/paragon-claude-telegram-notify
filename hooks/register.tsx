import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Mode, Setup, Task } from '../types'
import {
  IDLE,
  USAGE,
  botName,
  buildMessage,
  findStart,
  folderName,
  isTokenLike,
  makeCode,
  parseVerb,
  previewPrompt,
  readReply,
  scrub,
} from './core'
import type { Reply } from './core'

const PANE = 'telegram-notify-setup'
const API = 'https://api.telegram.org/bot'
const STATUS = '🔔 Telegram'
const POLL_MS = 2000
const WAIT_LIMIT_MS = 10 * 60_000

// Промпт, набранный самим человеком, начинает новую задачу; уведомление фоновой
// задачи или сообщение другого агента продолжают текущую.
const TYPED = new Set(['composer', 'bridge', 'sdk'])

const modeAtom = atom({ plugin: 'telegram-notify', key: 'mode' } as const, 'off' as Mode)
const setupAtom = atom({ plugin: 'telegram-notify', key: 'setup' } as const, IDLE)
const taskAtom = atom({ plugin: 'telegram-notify', key: 'task' } as const, null as Task | null)
const backgroundAtom = atom({ plugin: 'telegram-notify', key: 'background' } as const, [] as string[])

type Creds = { token: string; chatId: number }

// Токен и chat_id лежат только в хранилище мода ($.store), не в state и не в чате.
async function creds($: EngineInterface): Promise<Creds | null> {
  const token = await $.store.get('token')
  const chatId = await $.store.get('chatId')

  return typeof token === 'string' && typeof chatId === 'number' ? { token, chatId } : null
}

async function telegram($: EngineInterface, token: string, method: string, body: Record<string, unknown> = {}): Promise<Reply> {
  try {
    const res = await $.http.fetch(`${API}${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const reply = readReply(res.status, res.text)

    return reply.ok ? reply : { ...reply, error: scrub(reply.error, token) }
  } catch {
    return { ok: false, status: 0, error: 'нет связи с api.telegram.org' }
  }
}

async function send($: EngineInterface, text: string): Promise<Reply> {
  const c = await creds($)

  if (c === null) return { ok: false, status: 0, error: 'бот не подключён' }

  return telegram($, c.token, 'sendMessage', { chat_id: c.chatId, text, disable_web_page_preview: true })
}

async function refreshStatus($: EngineInterface) {
  $.ui.status((await read($, modeAtom)) === 'off' ? undefined : STATUS)
}

async function setMode($: EngineInterface, mode: Mode) {
  await update($, modeAtom, () => mode)
  await $.store.set('always', mode === 'always')
  await refreshStatus($)
}

async function openSetup($: EngineInterface) {
  return $.ui.open({ id: PANE, title: 'Telegram-уведомления', focus: true, closeOnEscape: true })
}

// Настройка из хранилища: в начале сессии и после /clear, /resume, /branch,
// которые сбрасывают state к значениям по умолчанию.
async function restore($: EngineInterface) {
  const c = await creds($)
  const always = (await $.store.get('always')) === true
  const bot = await $.store.get('bot')
  const chat = await $.store.get('chat')

  await update($, modeAtom, () => (c !== null && always ? 'always' : 'off'))
  await update($, setupAtom, () =>
    c === null
      ? IDLE
      : { ...IDLE, phase: 'connected', bot: typeof bot === 'string' ? bot : null, chat: typeof chat === 'string' ? chat : null },
  )
}

// Живут до перезагрузки модуля; перезагрузка снова вызывает session.start.
let folder = ''
let poll: Timer | undefined
let isPolling = false
let offset: number | null = null

function stopPolling() {
  poll?.cancel()
  poll = undefined
}

async function pollOnce($: EngineInterface) {
  if (isPolling) return
  isPolling = true

  try {
    const s = await read($, setupAtom)
    const token = await $.store.get('token')

    if (s.phase !== 'waiting' || s.code === null || typeof token !== 'string') {
      stopPolling()

      return
    }

    if ((await $.clock.now()) - s.waitingSince > WAIT_LIMIT_MS) {
      stopPolling()
      await update($, setupAtom, () => ({ ...IDLE, error: 'Не дождался нажатия Start за 10 минут. Вставь токен ещё раз.' }))

      return
    }

    const reply = await telegram($, token, 'getUpdates', { ...(offset === null ? {} : { offset }), timeout: 0, allowed_updates: ['message'] })

    if (!reply.ok) {
      // 409: у бота настроен webhook, getUpdates с ним не работает.
      if (reply.status === 409) {
        stopPolling()
        await update($, setupAtom, () => ({ ...IDLE, error: 'У этого бота настроен webhook, getUpdates недоступен. Создай отдельного бота для уведомлений.' }))
      }

      return
    }

    const found = findStart(reply.result, s.code)

    if (found.nextOffset !== null) offset = found.nextOffset
    if (found.chat === null) return

    stopPolling()
    await $.store.set('chatId', found.chat.id)
    await $.store.set('chat', found.chat.name)
    await update($, setupAtom, x => ({ ...x, phase: 'connected', chat: found.chat?.name ?? null, code: null, link: null, error: null }))
    await send($, '✅ Claude Code подключён. Сюда будут приходить уведомления, когда я закончу работу и буду ждать тебя.')
    $.ui.toast('Telegram подключён')
  } finally {
    isPolling = false
  }
}

function startPolling($: EngineInterface) {
  stopPolling()
  offset = null
  poll = $.clock.every(POLL_MS, () => void pollOnce($))
}

async function verify($: EngineInterface, token: string) {
  const reply = await telegram($, token, 'getMe')
  const bot = reply.ok ? botName(reply.result) : null

  if (!reply.ok || bot === null) {
    const error = !reply.ok && (reply.status === 401 || reply.status === 404)
      ? 'Telegram не принял токен. Скопируй его целиком из сообщения @BotFather.'
      : `Не удалось проверить токен: ${reply.ok ? 'непонятный ответ Telegram' : reply.error}`
    await update($, setupAtom, () => ({ ...IDLE, error }))

    return
  }

  const code = makeCode()

  // Новый токен: старый чат больше не годится, уведомления ждут нового Start.
  await $.store.set('token', token)
  await $.store.set('bot', bot)
  await $.store.delete('chatId')
  await $.store.delete('chat')
  if ((await read($, modeAtom)) !== 'off') await setMode($, 'off')

  const now = await $.clock.now()
  await update($, setupAtom, () => ({
    ...IDLE,
    phase: 'waiting',
    bot,
    code,
    link: `https://t.me/${bot}?start=${code}`,
    waitingSince: now,
  }))
  startPolling($)
}

async function disconnect($: EngineInterface) {
  stopPolling()
  for (const key of ['token', 'chatId', 'chat', 'bot', 'always']) await $.store.delete(key)
  await update($, modeAtom, () => 'off')
  await update($, setupAtom, () => IDLE)
  await refreshStatus($)
}

async function deliver($: EngineInterface, text: string) {
  const reply = await send($, text)

  if (!reply.ok) $.ui.toast(`Telegram: не удалось отправить уведомление (${reply.error})`)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    folder = folderName(e.cwd)
    await $.command.register({
      name: 'notify',
      description: 'Уведомление в Telegram, когда закончу и буду ждать тебя',
      argumentHint: '[always | off | test | setup]',
      immediate: true,
    })

    // session.start приходит и при перезагрузке мода: state тогда уже на месте.
    const held = await $.state.get({ plugin: 'telegram-notify', key: 'mode' })

    if (held.version === 0) {
      await restore($)
    }

    const s = await read($, setupAtom)

    if (s.phase === 'waiting') startPolling($)
    if (s.phase === 'checking') await update($, setupAtom, () => IDLE)

    await refreshStatus($)

    return next(e)
  })

  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    await restore($)
    await refreshStatus($)

    return next(e)
  })

  on('command.run', { command: 'notify' }, async ($, e) => {
    const verb = parseVerb(e.args)

    if (verb === 'unknown') return { text: USAGE }

    if (verb === 'setup') {
      await openSetup($)

      return {}
    }

    if (verb === 'off') {
      await setMode($, 'off')

      return { text: '🔕 Уведомления в Telegram выключены.' }
    }

    if ((await creds($)) === null) {
      await openSetup($)

      return { text: 'Telegram ещё не подключён: открыл настройку. Вставь токен бота в панели «Telegram-уведомления».' }
    }

    if (verb === 'test') {
      const reply = await send($, `🔔 Тестовое сообщение от Claude Code${folder ? ` (📁 ${folder})` : ''}. Всё работает.`)

      return { text: reply.ok ? '📨 Пробное сообщение отправлено в Telegram.' : `Не удалось отправить: ${reply.error}` }
    }

    await setMode($, verb)

    return {
      text:
        verb === 'once'
          ? '🔔 Напишу в Telegram, когда закончу и буду ждать тебя. После этого уведомления выключатся сами.'
          : '🔔 Буду писать в Telegram после каждой задачи. Выключить: /notify off.',
    }
  })

  on('prompt.submit', async ($, e, next) => {
    const result = await next(e)

    if (result.drop === undefined && TYPED.has(e.origin.kind) && e.turnId === undefined && !/^\s*\/notify\b/.test(result.text)) {
      const now = await $.clock.now()
      await update($, taskAtom, () => ({ text: previewPrompt(result.text), startedAt: now }))
    }

    return result
  })

  // Ход без набранного промпта (например, после /clear) всё равно даёт задаче имя.
  on('turn.start', async ($, e, next) => {
    if ((await read($, taskAtom)) === null) {
      const now = await $.clock.now()
      await update($, taskAtom, () => ({ text: previewPrompt(e.text), startedAt: now }))
    }

    return next(e)
  })

  // Пока работает фоновый агент, Claude ещё не ждёт тебя: его отчёт начнёт новый ход.
  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    const id = started.agentId

    if (e.background && id !== undefined) {
      await update($, backgroundAtom, list => [...list.filter(x => x !== id), id])
    }

    return started
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    const agentId = e.agentId

    if (agentId !== undefined) {
      await update($, backgroundAtom, list => list.filter(x => x !== agentId))

      return done
    }

    const mode = await read($, modeAtom)

    // Прерывание (Esc) значит, что ты и так у экрана.
    if (mode === 'off' || e.reason === 'aborted' || (await read($, backgroundAtom)).length > 0) {
      return done
    }

    const task = await read($, taskAtom)
    const now = await $.clock.now()
    const text = buildMessage({
      reason: e.reason,
      task: task?.text ?? '',
      durationMs: task === null ? e.durationMs : now - task.startedAt,
      folder,
      answer: e.answer,
    })

    await update($, taskAtom, () => null)
    if (mode === 'once') await setMode($, 'off')

    // Отправка в отдельном вызове таймера, чтобы конец хода её не ждал.
    $.clock.after(1, () => void deliver($, text))

    return done
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)

    if (e.surface === 'mobile' || !('Input' in ui) || !('Link' in ui)) {
      return <ui.Text>Настройка Telegram-уведомлений открывается в терминале или в десктопном приложении.</ui.Text>
    }

    const { Box, Text, Button, Input, Link } = ui
    const s: Setup = await read($, setupAtom)
    const mode = await read($, modeAtom)
    const modeLabel = mode === 'off' ? 'выключены' : mode === 'once' ? 'один раз' : 'всегда'

    const submit = (value: string) => {
      const token = value.trim()

      if (!isTokenLike(token)) {
        void update($, setupAtom, () => ({ ...IDLE, error: 'Это не похоже на токен бота. Он выглядит так: 123456789:AAH… (цифры, двоеточие и длинный код).' }))

        return
      }

      void update($, setupAtom, () => ({ ...IDLE, phase: 'checking' }))
      // Проверка идёт в своём вызове таймера: работа, начатая нажатием, обрывается с его концом.
      $.clock.after(1, () => void verify($, token))
    }

    const body =
      s.phase === 'connected' ? (
        <Box flexDirection="column" rowGap={1}>
          <Text color="success" bold>
            ✅ Подключено
          </Text>
          <Text>{`Бот @${s.bot ?? '?'} пишет в чат «${s.chat ?? '?'}». Уведомления: ${modeLabel}.`}</Text>
          <Box columnGap={2} flexWrap="wrap">
            <Button
              key="test"
              hotkey="t"
              variant="primary"
              label="Пробное сообщение"
              onPress={() =>
                void send($, `🔔 Тестовое сообщение от Claude Code${folder ? ` (📁 ${folder})` : ''}. Всё работает.`).then(reply =>
                  $.ui.toast(reply.ok ? 'Отправлено в Telegram' : `Не удалось отправить: ${reply.error}`),
                )
              }
            />
            <Button key="reconnect" hotkey="r" label="Другой бот" onPress={() => void update($, setupAtom, () => IDLE)} />
            <Button key="disconnect" hotkey="d" label="Отключить" onPress={() => void disconnect($)} />
          </Box>
          <Text dimColor>/notify — один раз · /notify always — всегда · /notify off — выключить</Text>
        </Box>
      ) : s.phase === 'checking' ? (
        <Text>Проверяю токен…</Text>
      ) : s.phase === 'waiting' ? (
        <Box flexDirection="column" rowGap={1}>
          <Text color="success">{`Бот @${s.bot ?? '?'} найден ✓`}</Text>
          <Text>Открой ссылку в Telegram и нажми Start:</Text>
          <Link href={s.link ?? 'https://t.me'} label={`t.me/${s.bot ?? ''}`} />
          <Text dimColor>{`Если ссылка не открывается, найди бота и отправь ему: /start ${s.code ?? ''}`}</Text>
          <Text>⏳ Жду нажатия Start…</Text>
          <Box>
            <Button
              key="cancel"
              label="Отмена"
              onPress={() => {
                stopPolling()
                void update($, setupAtom, () => IDLE)
              }}
            />
          </Box>
        </Box>
      ) : (
        <Box flexDirection="column" rowGap={1}>
          <Text>1. В Telegram открой @BotFather, отправь /newbot и скопируй токен, который он пришлёт.</Text>
          <Link href="https://t.me/BotFather" label="Открыть @BotFather" />
          <Text>2. Вставь токен сюда и нажми Enter:</Text>
          <Input key="token" label="Токен бота" placeholder="123456789:AAH…" submitLabel="проверить" value="" autoFocus onSubmit={submit} />
          {s.error === null ? null : <Text color="error">{s.error}</Text>}
          <Text dimColor>Токен хранится в хранилище мода и не попадает ни в чат, ни в код.</Text>
        </Box>
      )

    return (
      <Box flexDirection="column" paddingX={1} width={Math.max(30, e.props.bodyColumns - 2)}>
        <Text bold>Telegram-уведомления</Text>
        <Box marginTop={1} flexDirection="column">
          {body}
        </Box>
      </Box>
    )
  })
}
