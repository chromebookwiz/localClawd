/**
 * Discord Bot Service — two-way bridge via Discord REST API polling.
 *
 * Uses the REST API (no Gateway/WebSocket). A bot token + channel ID
 * is all that's needed. Messages are polled every few seconds. This is
 * simpler than Gateway — it trades some realtime fidelity for zero
 * extra deps.
 *
 * Config:
 *   DISCORD_BOT_TOKEN     — from https://discord.com/developers/applications
 *   DISCORD_CHANNEL_ID    — target channel
 *   DISCORD_USER_ID       — (optional) restrict to messages from this user
 */

import { logForDebugging } from '../../utils/debug.js'
import { globalStopSignal } from '../telegram/telegramSignals.js'
import { killAllIncludingSelf } from '../telegram/telegramKill.js'

interface DiscordMessage {
  id: string
  channel_id: string
  author: { id: string; username: string; bot?: boolean }
  content: string
  timestamp: string
  type: number
}

const DISCORD_API = 'https://discord.com/api/v10'
const POLL_INTERVAL_MS = 3000

let _token = ''
let _channelId = ''
let _userId = ''
let _botUserId = ''
let _polling = false
let _lastMessageId = ''
const _queue: string[] = []

// ─── API ─────────────────────────────────────────────────────────────────────

async function discordApi<T>(
  path: string,
  opts: { method?: 'GET' | 'POST' | 'DELETE'; body?: unknown; token?: string } = {},
): Promise<{ ok: true; data: T } | { ok: false; error: string; status: number }> {
  const token = opts.token ?? _token
  try {
    const res = await fetch(`${DISCORD_API}${path}`, {
      method: opts.method ?? 'GET',
      headers: {
        Authorization: `Bot ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'localclawd (github.com/localclawd, 1.0)',
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      return { ok: false, error: errText || res.statusText, status: res.status }
    }
    if (res.status === 204) return { ok: true, data: undefined as T }
    return { ok: true, data: (await res.json()) as T }
  } catch (e) {
    return { ok: false, error: String(e), status: 0 }
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function isDiscordConfigured(): boolean {
  return Boolean(process.env.DISCORD_BOT_TOKEN && process.env.DISCORD_CHANNEL_ID)
}

export function isDiscordActive(): boolean {
  return _polling
}

export function getDiscordChannelId(): string {
  return _channelId
}

export async function sendDiscordMessage(content: string): Promise<void> {
  if (!_polling || !_channelId) return
  // Discord message limit: 2000 chars
  const chunks = chunkText(content, 1900)
  for (const chunk of chunks) {
    const resp = await discordApi<DiscordMessage>(
      `/channels/${_channelId}/messages`,
      { method: 'POST', body: { content: chunk } },
    )
    if (!resp.ok) {
      logForDebugging(`[discord] sendMessage failed: ${resp.error}`, { level: 'warn' })
    }
  }
}

/** Discord has no typing indicator API we can use sustainably — post a
 *  brief placeholder reaction instead. This is best-effort. */
let _reactionTargetId = ''

export async function startDiscordWorkingIndicator(): Promise<void> {
  if (!_polling || !_channelId || !_reactionTargetId) return
  const emoji = encodeURIComponent('⏳')
  await discordApi(
    `/channels/${_channelId}/messages/${_reactionTargetId}/reactions/${emoji}/@me`,
    { method: 'POST' },
  ).catch(() => {})
}

export async function stopDiscordWorkingIndicator(): Promise<void> {
  if (!_polling || !_channelId || !_reactionTargetId) return
  const emoji = encodeURIComponent('⏳')
  await discordApi(
    `/channels/${_channelId}/messages/${_reactionTargetId}/reactions/${emoji}/@me`,
    { method: 'DELETE' },
  ).catch(() => {})
}

export function getPendingDiscordMessage(): string | null {
  return _queue.shift() ?? null
}

// ─── Validation / lifecycle ──────────────────────────────────────────────────

export async function validateDiscordToken(
  token: string,
): Promise<
  | { ok: true; botUserId: string; username: string }
  | { ok: false; error: string }
> {
  const resp = await discordApi<{ id: string; username: string }>(
    '/users/@me',
    { token },
  )
  if (!resp.ok) return { ok: false, error: resp.error }
  return { ok: true, botUserId: resp.data.id, username: resp.data.username }
}

export async function validateDiscordChannel(
  token: string,
  channelId: string,
): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
  const resp = await discordApi<{ id: string; name?: string; type: number }>(
    `/channels/${channelId}`,
    { token },
  )
  if (!resp.ok) return { ok: false, error: resp.error }
  return { ok: true, name: resp.data.name ?? '(DM)' }
}

export async function initDiscordWithCredentials(
  token: string,
  channelId: string,
  userId?: string,
): Promise<{ ok: true; botUserId: string } | { ok: false; error: string }> {
  _token = token
  _channelId = channelId
  _userId = userId ?? ''

  const auth = await discordApi<{ id: string; username: string }>('/users/@me')
  if (!auth.ok) return { ok: false, error: auth.error }
  _botUserId = auth.data.id

  process.env.DISCORD_BOT_TOKEN = token
  process.env.DISCORD_CHANNEL_ID = channelId
  if (userId) process.env.DISCORD_USER_ID = userId

  _polling = true
  void pollLoop()
  void sendDiscordMessage('**localclawd online**\nReady to receive tasks.')
  return { ok: true, botUserId: _botUserId }
}

export async function initDiscord(): Promise<void> {
  let token = process.env.DISCORD_BOT_TOKEN
  let channelId = process.env.DISCORD_CHANNEL_ID
  let userId = process.env.DISCORD_USER_ID

  if (!token || !channelId) {
    try {
      const { readFile } = await import('fs/promises')
      const { join } = await import('path')
      const { homedir } = await import('os')
      const configPath = join(homedir(), '.claude', 'discord.json')
      const raw = await readFile(configPath, 'utf-8')
      const config = JSON.parse(raw) as { token?: string; channelId?: string; userId?: string }
      if (config.token && config.channelId) {
        token = config.token
        channelId = config.channelId
        userId = config.userId
        process.env.DISCORD_BOT_TOKEN = token
        process.env.DISCORD_CHANNEL_ID = channelId
        if (userId) process.env.DISCORD_USER_ID = userId
      }
    } catch { /* no config */ }
  }

  if (!token || !channelId) return

  _token = token
  _channelId = channelId
  _userId = userId ?? ''

  const auth = await discordApi<{ id: string; username: string }>('/users/@me')
  if (!auth.ok) {
    logForDebugging(`[discord] auth failed: ${auth.error}`, { level: 'warn' })
    return
  }
  _botUserId = auth.data.id
  logForDebugging(`[discord] Connected as ${auth.data.username}`)
  _polling = true

  // Seed cursor by fetching the latest message so we don't replay history.
  try {
    const latest = await discordApi<DiscordMessage[]>(
      `/channels/${_channelId}/messages?limit=1`,
    )
    if (latest.ok && latest.data.length > 0) {
      _lastMessageId = latest.data[0]!.id
    }
  } catch { /* ignore */ }

  void pollLoop()
  void sendDiscordMessage('**localclawd online**\nReady to receive tasks.')
}

export function stopDiscord(): void {
  _polling = false
}

// ─── Poll loop ───────────────────────────────────────────────────────────────

async function pollLoop(): Promise<void> {
  while (_polling) {
    try {
      const path = _lastMessageId
        ? `/channels/${_channelId}/messages?after=${_lastMessageId}&limit=50`
        : `/channels/${_channelId}/messages?limit=1`

      const resp = await discordApi<DiscordMessage[]>(path)
      if (!resp.ok) {
        if (resp.status === 401 || resp.status === 403) {
          logForDebugging(`[discord] auth lost: ${resp.error}`, { level: 'warn' })
          _polling = false
          break
        }
        await sleep(5000)
        continue
      }

      // Returned newest-first; reverse for chronological processing
      const messages = resp.data.slice().reverse()
      for (const m of messages) {
        if (BigInt(m.id) > BigInt(_lastMessageId || '0')) {
          _lastMessageId = m.id
        }
        await handleMessage(m)
      }
    } catch (e) {
      if (_polling) logForDebugging(`[discord] poll error: ${e}`, { level: 'warn' })
    }
    await sleep(POLL_INTERVAL_MS)
  }
}

async function handleMessage(m: DiscordMessage): Promise<void> {
  if (m.author.bot) return
  if (m.author.id === _botUserId) return
  if (_userId && m.author.id !== _userId) {
    logForDebugging(`[discord] ignored message from ${m.author.id}`)
    return
  }

  let text = m.content.trim()
  if (_botUserId) {
    const mentionRe = new RegExp(`^<@!?${_botUserId}>\\s*`)
    text = text.replace(mentionRe, '').trim()
  }
  if (!text) return

  _reactionTargetId = m.id

  // Bot commands
  if (text.startsWith('/')) {
    if (text === '/stop') {
      globalStopSignal.set(true)
      void sendDiscordMessage('Stopping current task...')
      return
    }
    if (text === '/kill') {
      void sendDiscordMessage('Killing ALL localclawd instances...').then(async () => {
        const killed = await killAllIncludingSelf()
        void sendDiscordMessage(`Killed ${killed} instance(s). Self-terminating.`)
      })
      return
    }
    if (text === '/start' || text === '/help') {
      void sendDiscordMessage(
        '**localclawd ready**\nSend a task and I\'ll start working.\n\n' +
        '`/stop` — stop current task\n' +
        '`/kill` — stop all instances\n' +
        '`/status` — current status\n' +
        '`/schedules` — list scheduled jobs',
      )
      return
    }
    if (text === '/status') {
      const { getProjectStatus } = await import('../project/projectMemory.js')
      const status = await getProjectStatus()
      void sendDiscordMessage(`**Status**\n${status}`)
      return
    }
    if (text === '/schedule' || text === '/schedules') {
      const { listSchedules } = await import('../schedule/scheduler.js')
      const t = await listSchedules()
      void sendDiscordMessage(`**Schedules**\n${t}`)
      return
    }
    void sendDiscordMessage(`Unknown command: ${text}\n\nAvailable: /stop /kill /status /schedules /help`)
    return
  }

  void startDiscordWorkingIndicator()
  try {
    const { enqueue } = await import('../../utils/messageQueueManager.js')
    enqueue({ value: text, mode: 'prompt', priority: 'now' })
  } catch (e) {
    _queue.push(text)
    logForDebugging(`[discord] failed to enqueue: ${e}`)
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function chunkText(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text]
  const chunks: string[] = []
  let start = 0
  while (start < text.length) {
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
