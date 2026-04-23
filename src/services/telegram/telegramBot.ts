/**
 * Telegram Bot Service — two-way bridge between your phone and localclawd.
 *
 * Configured via environment variables:
 *   TELEGRAM_BOT_TOKEN   — Bot token from @BotFather
 *   TELEGRAM_CHAT_ID     — Your personal chat ID (get via @userinfobot)
 *
 * The bot runs a long-poll loop in the background. Messages from your
 * Telegram chat are queued and can be consumed by the REPL or /keepgoing.
 * The agent can send status updates back via sendTelegramMessage().
 *
 * Security: Only messages from TELEGRAM_CHAT_ID are accepted.
 */

import { logForDebugging } from '../../utils/debug.js'
import { globalStopSignal } from './telegramSignals.js'
import { killAllIncludingSelf } from './telegramKill.js'

// ─── Types ────────────────────────────────────────────────────────────────────

interface TelegramFile {
  file_id: string
  file_unique_id: string
  duration?: number
  mime_type?: string
  file_size?: number
}

interface TelegramUpdate {
  update_id: number
  message?: {
    message_id: number
    from?: { id: number; username?: string; first_name?: string }
    chat: { id: number }
    text?: string
    caption?: string
    voice?: TelegramFile
    audio?: TelegramFile
    video_note?: TelegramFile
    date: number
  }
}

interface TelegramResponse<T> {
  ok: boolean
  result: T
  description?: string
}

// ─── Module state ─────────────────────────────────────────────────────────────

let _token = ''
let _chatId = 0
let _polling = false
let _lastUpdateId = 0
const _queue: string[] = []
const _listeners: Array<(msg: string) => void> = []

// ─── API helpers ─────────────────────────────────────────────────────────────

async function api<T>(
  method: string,
  body: Record<string, unknown> = {},
): Promise<TelegramResponse<T>> {
  const url = `https://api.telegram.org/bot${_token}/${method}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  })
  return res.json() as Promise<TelegramResponse<T>>
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function isTelegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID)
}

export function isTelegramActive(): boolean {
  return _polling
}

export async function sendTelegramMessage(text: string): Promise<void> {
  if (!_polling || !_chatId) return
  // Telegram has a 4096-char limit; chunk if needed
  const chunks = chunkText(text, 4000)
  for (const chunk of chunks) {
    try {
      await api('sendMessage', {
        chat_id: _chatId,
        text: chunk,
        parse_mode: 'Markdown',
      })
    } catch (e) {
      // Try without markdown if it fails (often due to unescaped special chars)
      try {
        await api('sendMessage', { chat_id: _chatId, text: chunk })
      } catch {
        logForDebugging(`[telegram] sendMessage failed: ${e}`, { level: 'warn' })
      }
    }
  }
}

/** Send typing indicator — shows "typing..." in the chat. Expires after 5s. */
export async function sendTypingIndicator(): Promise<void> {
  if (!_polling || !_chatId) return
  try {
    await api('sendChatAction', { chat_id: _chatId, action: 'typing' })
  } catch {
    // Non-critical — ignore failures
  }
}

let _typingInterval: ReturnType<typeof setInterval> | null = null

/** Start sending typing indicators every 4s. Call stopTypingIndicator() when done. */
export function startTypingIndicator(): void {
  if (_typingInterval) return
  void sendTypingIndicator()
  _typingInterval = setInterval(() => void sendTypingIndicator(), 4000)
}

/** Stop the periodic typing indicator. */
export function stopTypingIndicator(): void {
  if (_typingInterval) {
    clearInterval(_typingInterval)
    _typingInterval = null
  }
}

/** Consume the next queued message from Telegram, or null if none. */
export function getPendingTelegramMessage(): string | null {
  return _queue.shift() ?? null
}

/** Register a callback for incoming Telegram messages. Returns unsubscribe fn. */
export function onTelegramMessage(cb: (msg: string) => void): () => void {
  _listeners.push(cb)
  return () => {
    const i = _listeners.indexOf(cb)
    if (i !== -1) _listeners.splice(i, 1)
  }
}

export function getTelegramChatId(): number {
  return _chatId
}

// ─── Bot lifecycle ────────────────────────────────────────────────────────────

/**
 * Validate a Telegram bot token by calling getMe.
 * Returns the bot username on success, or an error string on failure.
 */
export async function validateTelegramToken(
  token: string,
): Promise<{ ok: true; username: string } | { ok: false; error: string }> {
  const url = `https://api.telegram.org/bot${token}/getMe`
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(15_000),
    })
    const data = (await res.json()) as TelegramResponse<{ username: string; first_name: string }>
    if (!data.ok) return { ok: false, error: data.description ?? 'Invalid token' }
    return { ok: true, username: data.result.username }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

/**
 * Initialize Telegram with explicit credentials (for interactive setup).
 * Sets env vars so future calls to initTelegram() also work.
 */
export async function initTelegramWithCredentials(
  token: string,
  chatId: number,
): Promise<{ ok: true; username: string } | { ok: false; error: string }> {
  _token = token
  _chatId = chatId

  try {
    const me = await api<{ username: string; first_name: string }>('getMe')
    if (!me.ok) {
      return { ok: false, error: me.description ?? 'getMe failed' }
    }
    // Set env vars so they persist for the session
    process.env.TELEGRAM_BOT_TOKEN = token
    process.env.TELEGRAM_CHAT_ID = String(chatId)

    logForDebugging(`[telegram] Connected as @${me.result.username} (${me.result.first_name})`)
    _polling = true
    void pollLoop()
    void sendTelegramMessage(`*localclawd online*\nReady to receive commands.`)
    return { ok: true, username: me.result.username }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

export async function initTelegram(): Promise<void> {
  let token = process.env.TELEGRAM_BOT_TOKEN
  let chatIdStr = process.env.TELEGRAM_CHAT_ID

  // Fallback: load from ~/.claude/telegram.json if env vars are not set
  if (!token || !chatIdStr) {
    try {
      const { readFile } = await import('fs/promises')
      const { join } = await import('path')
      const { homedir } = await import('os')
      const configPath = join(homedir(), '.claude', 'telegram.json')
      const raw = await readFile(configPath, 'utf-8')
      const config = JSON.parse(raw) as { token?: string; chatId?: number }
      if (config.token && config.chatId) {
        token = config.token
        chatIdStr = String(config.chatId)
        // Set env vars so other code can check isTelegramConfigured()
        process.env.TELEGRAM_BOT_TOKEN = token
        process.env.TELEGRAM_CHAT_ID = chatIdStr
        logForDebugging('[telegram] Loaded credentials from ~/.claude/telegram.json')
      }
    } catch {
      // No saved config — that's fine
    }
  }

  if (!token || !chatIdStr) return

  _token = token
  _chatId = parseInt(chatIdStr, 10)
  if (isNaN(_chatId)) {
    logForDebugging('[telegram] Invalid TELEGRAM_CHAT_ID — must be a number', { level: 'warn' })
    return
  }

  // Verify token + get bot info
  try {
    const me = await api<{ username: string; first_name: string }>('getMe')
    if (!me.ok) {
      logForDebugging(`[telegram] getMe failed: ${me.description}`, { level: 'warn' })
      return
    }
    logForDebugging(`[telegram] Connected as @${me.result.username} (${me.result.first_name})`)
    _polling = true
    void pollLoop()
    // Send startup notification
    void sendTelegramMessage(`*localclawd online*\nReady to receive commands.`)
  } catch (e) {
    logForDebugging(`[telegram] Init failed: ${e}`, { level: 'warn' })
  }
}

export function stopTelegram(): void {
  _polling = false
}

// ─── Long-poll loop ───────────────────────────────────────────────────────────

async function pollLoop(): Promise<void> {
  while (_polling) {
    try {
      const resp = await api<TelegramUpdate[]>('getUpdates', {
        offset: _lastUpdateId + 1,
        timeout: 25,
        allowed_updates: ['message'],
      })

      if (!resp.ok || !Array.isArray(resp.result)) {
        await sleep(5000)
        continue
      }

      for (const update of resp.result) {
        _lastUpdateId = Math.max(_lastUpdateId, update.update_id)
        await handleUpdate(update)
      }
    } catch (e) {
      if (_polling) {
        logForDebugging(`[telegram] Poll error: ${e}`, { level: 'warn' })
        await sleep(5000)
      }
    }
  }
}

async function handleUpdate(update: TelegramUpdate): Promise<void> {
  const msg = update.message
  if (!msg) return

  // Security: only accept messages from the configured chat
  if (msg.chat.id !== _chatId) {
    logForDebugging(`[telegram] Ignored message from unauthorized chat ${msg.chat.id}`)
    return
  }

  const sender = msg.from?.username ?? msg.from?.first_name ?? 'user'
  let text = msg.text?.trim() ?? ''

  // Voice / audio / video_note — transcribe and treat as text
  const audioFile = msg.voice ?? msg.audio ?? msg.video_note
  if (!text && audioFile) {
    const transcribed = await transcribeTelegramAudio(audioFile)
    if (transcribed) {
      text = transcribed
      if (msg.caption) text = `${msg.caption}\n${text}`
      void sendTelegramMessage(`🎙 _transcribed:_ ${text.slice(0, 200)}${text.length > 200 ? '…' : ''}`)
    } else {
      void sendTelegramMessage(
        '🎙 Voice received, but transcription is not configured.\n' +
        'Set one of: `STT_BASE_URL` + `STT_API_KEY`, `GROQ_API_KEY`, or `OPENAI_API_KEY`.',
      )
      return
    }
  }

  if (!text) return

  logForDebugging(`[telegram] Message from ${sender}: ${text.slice(0, 80)}`)

  // Handle Telegram bot commands
  if (text.startsWith('/')) {
    if (text === '/stop') {
      globalStopSignal.set(true)
      void sendTelegramMessage('Stopping current task...')
      return
    }
    if (text === '/kill') {
      void sendTelegramMessage('Killing ALL localclawd instances...').then(async () => {
        const killed = await killAllIncludingSelf()
        void sendTelegramMessage(`Killed ${killed} instance(s). Self-terminating.`)
      })
      return
    }
    if (text === '/start') {
      void sendTelegramMessage('*localclawd ready*\nSend me a task and I\'ll start working on it.\n\nCommands:\n/stop — stop current task\n/kill — kill all instances\n/status — show current status')
      return
    }
    if (text === '/status') {
      const { getProjectStatus } = await import('../project/projectMemory.js')
      const status = await getProjectStatus()
      void sendTelegramMessage(`*Status*\n${status}`)
      return
    }
    if (text === '/schedule' || text === '/schedules') {
      const { listSchedules } = await import('../schedule/scheduler.js')
      const text2 = await listSchedules()
      void sendTelegramMessage(`*Schedules*\n${text2}`)
      return
    }
    if (text === '/help') {
      void sendTelegramMessage(
        '*localclawd commands*\n' +
        '/stop — stop current task\n' +
        '/kill — kill all instances\n' +
        '/status — project status\n' +
        '/schedules — list scheduled jobs\n' +
        '/help — this message\n\n' +
        'Any other message is forwarded to the agent.',
      )
      return
    }
    // Unknown bot command
    void sendTelegramMessage(`Unknown command: ${text}\n\nAvailable: /stop /kill /status /schedules /help`)
    return
  }

  // Plain message — queue it as a prompt. The agent on the CLI side picks it up.
  void sendTypingIndicator()
  try {
    const { enqueue } = await import('../../utils/messageQueueManager.js')
    enqueue({ value: text, mode: 'prompt', priority: 'now' })
  } catch (e) {
    _queue.push(text)
    logForDebugging(`[telegram] Failed to enqueue message: ${e}`)
  }

  for (const cb of _listeners) {
    try { cb(text) } catch { /* ignore listener errors */ }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function transcribeTelegramAudio(file: TelegramFile): Promise<string | null> {
  try {
    const info = await api<{ file_path?: string }>('getFile', { file_id: file.file_id })
    if (!info.ok || !info.result.file_path) return null
    const url = `https://api.telegram.org/file/bot${_token}/${info.result.file_path}`
    const { transcribeFromUrl } = await import('../voice/transcribeAudio.js')
    const filename = info.result.file_path.split('/').pop() ?? 'voice.ogg'
    return await transcribeFromUrl(url, filename)
  } catch (e) {
    logForDebugging(`[telegram] voice transcription failed: ${e}`)
    return null
  }
}

function chunkText(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text]
  const chunks: string[] = []
  let start = 0
  while (start < text.length) {
    // Try to break at a newline
    let end = Math.min(start + maxLen, text.length)
    if (end < text.length) {
      const nl = text.lastIndexOf('\n', end)
      if (nl > start) end = nl + 1
    }
    chunks.push(text.slice(start, end))
    start = end
  }
  return chunks
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
