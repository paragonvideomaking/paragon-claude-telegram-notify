// off: молчим. once: одно уведомление, потом off. always: после каждой задачи.
export type Mode = 'off' | 'once' | 'always'

// Этапы настройки в панели. idle: ждём токен; checking: проверяем его через getMe;
// waiting: бот найден, ждём /start с кодом; connected: chat_id известен.
export type Phase = 'idle' | 'checking' | 'waiting' | 'connected'

export type Setup = {
  phase: Phase
  bot: string | null
  chat: string | null
  link: string | null
  code: string | null
  error: string | null
  waitingSince: number
}

// Задача, о которой придёт уведомление: начало промпта и когда его отправили.
export type Task = { text: string; startedAt: number }

declare module 'claude-code' {
  interface PluginState {
    'telegram-notify': {
      mode: Mode
      setup: Setup
      task: Task | null
      background: string[]
    }
  }
}
