// Чистые функции: разбор команд, текст уведомления, ответы Telegram. Ничего здесь не
// трогает `$`, поэтому всё проверяется тестами напрямую.
import type { Setup } from '../types'

export const IDLE: Setup = { phase: 'idle', bot: null, chat: null, link: null, code: null, error: null, waitingSince: 0 }

// Токен бота от @BotFather: числовой id, двоеточие, секрет.
const TOKEN = /^\d{5,}:[A-Za-z0-9_-]{30,}$/

export const isTokenLike = (text: string) => TOKEN.test(text.trim())

export type Verb = 'once' | 'always' | 'off' | 'test' | 'setup' | 'unknown'

export function parseVerb(args: string): Verb {
  const word = args.trim().toLowerCase()

  if (word === '' || word === 'once' || word === 'on') return 'once'
  if (word === 'always' || word === 'off' || word === 'test' || word === 'setup') return word

  return 'unknown'
}

export const USAGE = [
  '/notify — одно уведомление в Telegram, когда закончу и буду ждать тебя',
  '/notify always — уведомлять после каждой задачи',
  '/notify off — выключить',
  '/notify test — пробное сообщение',
  '/notify setup — подключить бота',
].join('\n')

// Первые слова промпта: без тегов и переносов, не длиннее `max` символов.
export function previewPrompt(text: string, words = 10, max = 90): string {
  const plain = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  const head = plain.split(' ').slice(0, words).join(' ')
  const cut = head.length > max ? `${head.slice(0, max - 1).trimEnd()}…` : head

  return cut.length < plain.length && !cut.endsWith('…') ? `${cut}…` : cut
}

export function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))

  if (s < 60) return `${s} с`

  const m = Math.floor(s / 60)

  if (m < 60) return `${m} мин ${s % 60} с`

  return `${Math.floor(m / 60)} ч ${String(m % 60).padStart(2, '0')} мин`
}

// Первая содержательная строка ответа, без разметки markdown.
export function answerLine(answer: string, max = 200): string {
  const line =
    answer
      .split('\n')
      .map(l => l.replace(/\*\*|__|`/g, '').replace(/^[#>*\s|-]+/, '').trim())
      .find(l => l !== '') ?? ''

  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line
}

export type Outcome = 'answer' | 'error' | 'refusal' | 'aborted'

const HEADLINES: Record<Outcome, string> = {
  answer: '✅ Готово, жду тебя',
  error: '⚠️ Остановился из-за ошибки, жду тебя',
  refusal: '⛔ Модель отказалась продолжать, жду тебя',
  aborted: '⏹ Задача прервана',
}

export function buildMessage(n: { reason: Outcome; task: string; durationMs: number; folder: string; answer: string }): string {
  const summary = answerLine(n.answer)

  return [
    HEADLINES[n.reason],
    n.folder ? `📁 ${n.folder}` : null,
    `📝 ${n.task || '(задача без текста)'}`,
    `⏱ ${fmtDuration(n.durationMs)}`,
    summary ? `💬 ${summary}` : null,
  ]
    .filter((line): line is string => line !== null)
    .join('\n')
}

export const folderName = (cwd: string) => cwd.split(/[\\/]/).filter(Boolean).pop() ?? ''

// Код в ссылке t.me/<bot>?start=<код>: связывает нажатие Start с этой настройкой,
// чтобы бот не подключился к чужому чату, написавшему ему /start.
export function makeCode(): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789'
  const bytes = new Uint8Array(10)

  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256)
  }

  return Array.from(bytes, b => alphabet[b % alphabet.length]).join('')
}

export type Reply = { ok: true; result: unknown } | { ok: false; status: number; error: string }

// Ответ Bot API: `{ ok, result }` или `{ ok: false, description }`.
export function readReply(status: number, text: string): Reply {
  let body: unknown = null

  try {
    body = JSON.parse(text)
  } catch {
    body = null
  }

  const data = (typeof body === 'object' && body !== null ? body : {}) as { ok?: unknown; result?: unknown; description?: unknown }

  if (data.ok === true) return { ok: true, result: data.result }

  return { ok: false, status, error: typeof data.description === 'string' ? data.description : `HTTP ${status}` }
}

export function botName(result: unknown): string | null {
  const name = (result as { username?: unknown } | null)?.username

  return typeof name === 'string' && /^[A-Za-z0-9_]{3,64}$/.test(name) ? name : null
}

type Update = { update_id?: unknown; message?: { text?: unknown; chat?: { id?: unknown; first_name?: unknown; username?: unknown; title?: unknown } } }

// Ищет в getUpdates сообщение `/start <код>`; возвращает чат и следующий offset.
export function findStart(result: unknown, code: string): { chat: { id: number; name: string } | null; nextOffset: number | null } {
  const updates = Array.isArray(result) ? (result as Update[]) : []
  let last: number | null = null
  let chat: { id: number; name: string } | null = null
  const wanted = new RegExp(`^/start(?:@\\w+)?\\s+${code}$`)

  for (const u of updates) {
    if (typeof u.update_id === 'number') last = Math.max(last ?? u.update_id, u.update_id)

    const text = u.message?.text
    const c = u.message?.chat

    if (chat === null && typeof text === 'string' && wanted.test(text.trim()) && typeof c?.id === 'number') {
      const name = [c.first_name, c.title, c.username].find((v): v is string => typeof v === 'string' && v !== '')
      chat = { id: c.id, name: name ?? String(c.id) }
    }
  }

  return { chat, nextOffset: last === null ? null : last + 1 }
}

// Описание ошибки Telegram на всякий случай очищается от токена.
export const scrub = (text: string, token: string) => (token ? text.split(token).join('•••') : text)
