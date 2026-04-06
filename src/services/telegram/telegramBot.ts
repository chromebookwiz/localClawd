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

// ─── Types ────────────────────────────────────────────────────────────────────

interface TelegramUpdate {
  update_id: number
  message?: {
    message_id: number
    from?: { id: number; username?: string; first_name?: string }
    chat: { id: number }
    text?: string
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

export async function initTelegram(): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatIdStr = process.env.TELEGRAM_CHAT_ID

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
    void sendTelegramMessage(`🤖 *localclawd online*\nReady to receive commands.`)
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
        handleUpdate(update)
      }
    } catch (e) {
      if (_polling) {
        logForDebugging(`[telegram] Poll error: ${e}`, { level: 'warn' })
        await sleep(5000)
      }
    }
  }
}

function handleUpdate(update: TelegramUpdate): void {
  const msg = update.message
  if (!msg?.text) return

  // Security: only accept messages from the configured chat
  if (msg.chat.id !== _chatId) {
    logForDebugging(`[telegram] Ignored message from unauthorized chat ${msg.chat.id}`)
    return
  }

  const sender = msg.from?.username ?? msg.from?.first_name ?? 'user'
  const text = msg.text.trim()
  if (!text) return

  logForDebugging(`[telegram] Message from ${sender}: ${text.slice(0, 80)}`)

  // Enqueue and notify listeners
  _queue.push(text)
  for (const cb of _listeners) {
    try { cb(text) } catch { /* ignore listener errors */ }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

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
