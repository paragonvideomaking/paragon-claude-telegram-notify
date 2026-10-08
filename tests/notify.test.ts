import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import { buildMessage, findStart, fmtDuration, isTokenLike, parseVerb, previewPrompt, readReply, scrub } from '../hooks/core'

// Вымышленные токены только для тестов: настоящий Telegram их не примет.
// Собраны из частей, чтобы сканеры секретов не принимали их за настоящие.
const TOKEN = ['123456789', 'AAFakeTokenForTests_abcdefghijklmnopq'].join(':')
const OTHER = ['987654321', 'AAAnotherFakeToken_zyxwvutsrqponmlkj'].join(':')
const BOT = 'paragon_test_bot'
const PANE = 'telegram-notify-setup'
const START = 1_000_000

type Sent = { chat_id: number; text: string }
type Update = { update_id: number; message: { text: string; chat: { id: number; first_name: string } } }

// Всё, что под модом: часы, хранилище, Telegram, строка состояния, тосты, команды.
function world(on: On, store: Record<string, unknown> = {}) {
  const clock = mock.clock(on, { now: START })
  // Своё хранилище в памяти, чтобы тест видел, что мод туда положил.
  const mem: Record<string, unknown> = { ...store }
  on('store.get', ($, e) => ({ value: mem[e.key] }))
  on('store.set', ($, e) => {
    mem[e.key] = JSON.parse(JSON.stringify(e.value)) as unknown

    return { value: undefined }
  })
  on('store.delete', ($, e) => {
    delete mem[e.key]

    return { value: undefined }
  })

  const tg = { sent: [] as Sent[], methods: [] as string[], urls: [] as string[], updates: [] as Update[] }
  const reply = (status: number, body: unknown) => ({ value: { status, ok: status < 300, headers: {}, text: JSON.stringify(body) } })

  on('http.fetch', async ($, e) => {
    tg.urls.push(e.url)
    const m = /^https:\/\/api\.telegram\.org\/bot([^/]+)\/(\w+)$/.exec(e.url)

    if (m === null) return reply(404, { ok: false, description: 'Not Found' })

    const [, token, method] = m
    tg.methods.push(method ?? '')
    const body = JSON.parse(e.init?.body ?? '{}') as { offset?: number; chat_id?: number; text?: string }

    if (token !== TOKEN) return reply(401, { ok: false, error_code: 401, description: 'Unauthorized' })
    if (method === 'getMe') return reply(200, { ok: true, result: { id: 1, is_bot: true, first_name: 'Paragon', username: BOT } })
    if (method === 'getUpdates') return reply(200, { ok: true, result: tg.updates.filter(u => u.update_id >= (body.offset ?? 0)) })
    if (method === 'sendMessage') {
      tg.sent.push({ chat_id: body.chat_id ?? 0, text: body.text ?? '' })

      return reply(200, { ok: true, result: { message_id: tg.sent.length } })
    }

    return reply(404, { ok: false, description: 'Not Found' })
  })

  const ui = { status: undefined as string | undefined, toasts: [] as string[], opened: [] as string[] }
  on('ui.status', ($, e) => {
    ui.status = e.text

    return { value: undefined }
  })
  on('ui.toast', ($, e) => {
    ui.toasts.push(e.text)

    return { value: undefined }
  })
  on('ui.open', ($, e) => {
    ui.opened.push(e.id)

    return { value: { isPlaced: true as const } }
  })
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('prompt.submit', ($, e) => ({ text: e.text, origin: e.origin }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))
  on('agent.spawn', () => ({ model: 'claude-opus-5-5', agentId: 'bg-1' }))
  on('classic.SessionStart', () => ({}))

  return { clock, tg, ui, mem }
}

const CONNECTED = { token: TOKEN, chatId: 42, bot: BOT, chat: 'Paragon' }

const start = ($: Engine) => $.session.start({ cwd: '/work/coffee-landing', surface: 'terminal', isInteractive: true })

const notify = ($: Engine, args = '') =>
  $.command.run({ command: 'notify', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 140 } })

async function task($: Engine, w: ReturnType<typeof world>, prompt: string, o: { ms?: number; answer?: string; reason?: 'answer' | 'aborted' | 'error' } = {}) {
  await $.prompt.submit({ text: prompt, wait: false, origin: { kind: 'composer' } })
  await $.turn.start({ text: prompt, turnId: 't' })
  await w.clock.advance(o.ms ?? 1000)
  const reason = o.reason ?? 'answer'
  await $.turn.complete({ answer: o.answer ?? 'Готово.', durationMs: o.ms ?? 1000, isAborted: reason === 'aborted', turnId: 't', reason })
  await w.clock.advance(1)
}

const PANE_PROPS = {
  title: 'Telegram-уведомления',
  isFocused: true,
  bodyColumns: 80,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 30 },
  view: {},
} as const

describe('core', () => {
  test('узнаёт токен по виду', () => {
    expect(isTokenLike(TOKEN)).toBe(true)
    expect(isTokenLike(`  ${TOKEN}\n`)).toBe(true)
    expect(isTokenLike('привет')).toBe(false)
    expect(isTokenLike('123:short')).toBe(false)
  })

  test('разбирает аргументы /notify', () => {
    expect(parseVerb('')).toBe('once')
    expect(parseVerb(' Always ')).toBe('always')
    expect(parseVerb('off')).toBe('off')
    expect(parseVerb('test')).toBe('test')
    expect(parseVerb('setup')).toBe('setup')
    expect(parseVerb('что-то')).toBe('unknown')
  })

  test('берёт первые слова промпта', () => {
    expect(previewPrompt('Почини  баг\nв форме входа')).toBe('Почини баг в форме входа')
    expect(previewPrompt('раз два три четыре пять шесть семь восемь девять десять одиннадцать')).toBe(
      'раз два три четыре пять шесть семь восемь девять десять…',
    )
    expect(previewPrompt('<command-name>/review</command-name> PR 12')).toBe('/review PR 12')
  })

  test('пишет длительность по-русски', () => {
    expect(fmtDuration(42_400)).toBe('42 с')
    expect(fmtDuration(252_000)).toBe('4 мин 12 с')
    expect(fmtDuration(3_900_000)).toBe('1 ч 05 мин')
  })

  test('собирает текст уведомления', () => {
    const text = buildMessage({ reason: 'error', task: 'Собери лендинг', durationMs: 65_000, folder: 'coffee', answer: '\n## **Итог**: всё упало' })
    expect(text).toBe('⚠️ Остановился из-за ошибки, жду тебя\n📁 coffee\n📝 Собери лендинг\n⏱ 1 мин 5 с\n💬 Итог: всё упало')
  })

  test('находит /start с нужным кодом и следующий offset', () => {
    const updates = [
      { update_id: 7, message: { text: '/start', chat: { id: 1, first_name: 'Кто-то' } } },
      { update_id: 8, message: { text: '/start abc', chat: { id: 2, first_name: 'Чужой' } } },
      { update_id: 9, message: { text: '/start code42', chat: { id: 3, first_name: 'Paragon' } } },
    ]
    expect(findStart(updates, 'code42')).toEqual({ chat: { id: 3, name: 'Paragon' }, nextOffset: 10 })
    expect(findStart(updates, 'nope')).toEqual({ chat: null, nextOffset: 10 })
    expect(findStart('мусор', 'x')).toEqual({ chat: null, nextOffset: null })
  })

  test('читает ответы Bot API и прячет токен', () => {
    expect(readReply(200, '{"ok":true,"result":5}')).toEqual({ ok: true, result: 5 })
    expect(readReply(401, '{"ok":false,"description":"Unauthorized"}')).toEqual({ ok: false, status: 401, error: 'Unauthorized' })
    expect(readReply(502, '<html>')).toEqual({ ok: false, status: 502, error: 'HTTP 502' })
    expect(scrub(`bad ${TOKEN}`, TOKEN)).toBe('bad •••')
  })
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`настройка в панели (${surface}): токен, ссылка, Start, «Подключено»`, async ($, on) => {
    const w = world(on)
    await start($)
    const pane = await $.ui.mount({ plugin: 'telegram-notify', surface, component: 'Pane', requestId: PANE, props: PANE_PROPS })

    // Не токен: ошибка, в сеть не ходим.
    await pane.input({ key: 'token', text: 'просто текст' })
    expect((await pane.find({ type: 'Text', text: /не похоже на токен/ }))?.text).toBeDefined()
    expect(w.tg.methods).toHaveLength(0)

    // Похожий, но неверный токен: Telegram отвечает 401.
    await pane.input({ key: 'token', text: OTHER })
    await w.clock.advance(1)
    expect((await pane.find({ type: 'Text', text: /не принял токен/ }))?.text).toBeDefined()

    // Настоящий (для фейкового Telegram) токен.
    await pane.input({ key: 'token', text: TOKEN })
    await w.clock.advance(1)
    const link = await pane.find({ type: 'Link', text: `t.me/${BOT}` })
    const href = String(link?.props.href ?? '')
    expect(href).toStartWith(`https://t.me/${BOT}?start=`)
    const code = href.split('start=')[1] ?? ''
    expect(code.length).toBeGreaterThan(5)
    expect(w.mem.token).toBe(TOKEN)
    expect(w.mem.chatId).toBeUndefined()

    // Чужой /start без кода не подключается, наш с кодом подключается.
    w.tg.updates.push({ update_id: 100, message: { text: '/start', chat: { id: 666, first_name: 'Чужой' } } })
    await w.clock.advance(2000)
    expect(await pane.find({ type: 'Text', text: /Подключено/ })).toBeUndefined()

    w.tg.updates.push({ update_id: 101, message: { text: `/start ${code}`, chat: { id: 42, first_name: 'Paragon' } } })
    await w.clock.advance(2000)
    expect((await pane.find({ type: 'Text', text: /✅ Подключено/ }))?.text).toBeDefined()
    expect(w.mem.chatId).toBe(42)
    expect(w.tg.sent).toEqual([{ chat_id: 42, text: expect.stringContaining('Claude Code подключён') }])
    expect(w.ui.toasts).toContain('Telegram подключён')

    // Токен не виден ни в одной отрисовке панели.
    expect(JSON.stringify(await pane.drawn())).not.toContain(TOKEN)

    // Опрос остановился: дальше getUpdates не зовётся.
    const polls = w.tg.methods.filter(m => m === 'getUpdates').length
    await w.clock.advance(10_000)
    expect(w.tg.methods.filter(m => m === 'getUpdates').length).toBe(polls)

    // Кнопка пробного сообщения.
    await pane.press({ key: 'test' })
    expect(w.tg.sent.at(-1)?.text).toContain('Тестовое сообщение')
    expect(w.ui.toasts).toContain('Отправлено в Telegram')
  })
}

test('ожидание Start кончается через 10 минут', async ($, on) => {
  const w = world(on)
  await start($)
  const pane = await $.ui.mount({ plugin: 'telegram-notify', surface: 'terminal', component: 'Pane', requestId: PANE, props: PANE_PROPS })
  await pane.input({ key: 'token', text: TOKEN })
  await w.clock.advance(1)
  await w.clock.advance(10 * 60_000 + 4000)
  expect((await pane.find({ type: 'Text', text: /Не дождался/ }))?.text).toBeDefined()
  expect(await pane.find({ type: 'Input', key: 'token' })).toBeDefined()
})

test('/notify без подключения открывает настройку и не включается', async ($, on) => {
  const w = world(on)
  await start($)
  const out = await notify($)
  expect(out.text).toContain('не подключён')
  expect(w.ui.opened).toEqual([PANE])
  expect(w.ui.status).toBeUndefined()
})

test('/notify: одно уведомление с задачей, временем и итогом, потом выключается', async ($, on) => {
  const w = world(on, CONNECTED)
  await start($)
  expect(w.ui.status).toBeUndefined()

  const out = await notify($)
  expect(out.text).toContain('Напишу в Telegram')
  expect(w.ui.status).toBe('🔔 Telegram')

  await task($, w, 'Сделай лендинг кофейни Paragon Coffee с меню и контактами, пожалуйста, и проверь вёрстку', {
    ms: 125_000,
    answer: '**Готово:** собрал index.html и style.css.\n\nПодробности ниже.',
  })

  expect(w.tg.sent).toHaveLength(1)
  expect(w.tg.sent[0]).toEqual({
    chat_id: 42,
    text: '✅ Готово, жду тебя\n📁 coffee-landing\n📝 Сделай лендинг кофейни Paragon Coffee с меню и контактами, пожалуйста,…\n⏱ 2 мин 5 с\n💬 Готово: собрал index.html и style.css.',
  })
  expect(w.ui.status).toBeUndefined()

  await task($, w, 'Ещё одна задача')
  expect(w.tg.sent).toHaveLength(1)
})

test('/notify always: каждая задача, ждёт фоновых агентов, молчит при Esc, /notify off', async ($, on) => {
  const w = world(on, CONNECTED)
  await start($)
  await notify($, 'always')
  expect(w.ui.status).toBe('🔔 Telegram')
  expect(w.mem.always).toBe(true)

  // Задача с фоновым агентом: конец первого хода — ещё не конец работы.
  await $.prompt.submit({ text: 'Раздели работу на двух агентов', wait: false, origin: { kind: 'composer' } })
  await $.turn.start({ text: 'Раздели работу на двух агентов', turnId: 't1' })
  await $.agent.spawn({
    prompt: 'пиши тексты',
    description: 'Тексты',
    subagentType: 'general-purpose',
    provider: { kind: 'model' },
    parentModel: 'claude-opus-5-5',
    background: true,
    fork: false,
  } as never)
  await w.clock.advance(30_000)
  await $.turn.complete({ answer: 'Запустил агентов.', durationMs: 30_000, isAborted: false, turnId: 't1', reason: 'answer' })
  await w.clock.advance(1)
  expect(w.tg.sent).toHaveLength(0)

  // Агент закончил, его отчёт открыл новый ход — вот теперь уведомление.
  await $.turn.complete({ answer: 'Тексты готовы.', durationMs: 20_000, isAborted: false, turnId: 'a1', reason: 'answer', agentId: 'bg-1' })
  await $.prompt.submit({ text: '<task-notification>done</task-notification>', wait: false, origin: { kind: 'task-notification' } })
  await $.turn.start({ text: '<task-notification>done</task-notification>', turnId: 't2' })
  await w.clock.advance(15_000)
  await $.turn.complete({ answer: 'Собрал всё вместе.', durationMs: 15_000, isAborted: false, turnId: 't2', reason: 'answer' })
  await w.clock.advance(1)
  expect(w.tg.sent).toHaveLength(1)
  expect(w.tg.sent[0]?.text).toContain('📝 Раздели работу на двух агентов')
  expect(w.tg.sent[0]?.text).toContain('⏱ 45 с')
  expect(w.tg.sent[0]?.text).toContain('💬 Собрал всё вместе.')

  // Esc: ты у экрана, сообщения нет.
  await task($, w, 'Прерванная задача', { reason: 'aborted' })
  expect(w.tg.sent).toHaveLength(1)

  // Ошибка API тоже повод написать.
  await task($, w, 'Задача с ошибкой', { reason: 'error', answer: '' })
  expect(w.tg.sent).toHaveLength(2)
  expect(w.tg.sent[1]?.text).toStartWith('⚠️ Остановился из-за ошибки')
  expect(w.ui.status).toBe('🔔 Telegram')

  const off = await notify($, 'off')
  expect(off.text).toContain('выключены')
  expect(w.ui.status).toBeUndefined()
  expect(w.mem.always).toBe(false)

  await task($, w, 'После выключения')
  expect(w.tg.sent).toHaveLength(2)
})

test('/notify always переживает новую сессию и /clear', async ($, on) => {
  const w = world(on, { ...CONNECTED, always: true })
  await start($)
  expect(w.ui.status).toBe('🔔 Telegram')

  await $.classic.SessionStart({ source: 'clear' } as never)
  expect(w.ui.status).toBe('🔔 Telegram')
})

test('/notify test и справка', async ($, on) => {
  const w = world(on, CONNECTED)
  await start($)
  const out = await notify($, 'test')
  expect(out.text).toContain('Пробное сообщение отправлено')
  expect(w.tg.sent[0]).toEqual({ chat_id: 42, text: expect.stringContaining('Тестовое сообщение от Claude Code (📁 coffee-landing)') })

  const help = await notify($, 'что-нибудь')
  expect(help.text).toContain('/notify always')
  expect(w.ui.status).toBeUndefined()
})

test('токен не попадает ни в ответы команд, ни в тосты', async ($, on) => {
  const w = world(on, CONNECTED)
  await start($)
  const texts = [await notify($), await notify($, 'test'), await notify($, 'always'), await notify($, 'off'), await notify($, 'x')]
  for (const t of [...texts.map(x => x.text ?? ''), ...w.ui.toasts]) expect(t).not.toContain(TOKEN)
  expect(w.tg.urls.every(u => u.startsWith('https://api.telegram.org/bot'))).toBe(true)
})
