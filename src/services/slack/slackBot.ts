/**
 * Slack Bot Service — two-way bridge between Slack and localclawd.
 *
 * Configured via environment variables or ~/.claude/slack.json:
 *   SLACK_BOT_TOKEN      — xoxb-... bot token from your Slack app
 *   SLACK_CHANNEL_ID     — channel (C...) or DM (D...) to operate in
 *   SLACK_USER_ID        — (optional) restrict to messages from this user
 *
 * Uses conversations.history polling — no public webhook required.
 * Messages are queued for /director to consume; the agent posts status
 * updates via sendSlackMessage().
 *
 * Security: If SLACK_USER_ID is set, only messages from that user are
 * accepted. Otherwise, bot's own messages are filtered by bot_id.
 */

import { logForDebugging } from '../../utils/debug.js'
import { globalStopSignal } from '../telegram/telegramSignals.js'
import { killAllIncludingSelf } from '../telegram/telegramKill.js'

// ─── Types ────────────────────────────────────────────────────────────────────

interface SlackFile {
  id: string
  name?: string
  mimetype?: string
  url_private?: string
  url_private_download?: string
}

interface SlackMessage {
  ts: string
  user?: string
  bot_id?: string
  text?: string
  subtype?: string
  files?: SlackFile[]
}

interface SlackResponse {
  ok: boolean
  error?: string
  warning?: string
}

interface AuthTestResponse extends SlackResponse {
  user_id?: string
  user?: string
  team?: string
  bot_id?: string
}

interface ConversationsHistoryResponse extends SlackResponse {
  messages?: SlackMessage[]
  has_more?: boolean
}

// ─── Module state ─────────────────────────────────────────────────────────────

let _token = ''
let _channelId = ''
let _userId = ''          // optional — restrict to this user
let _botUserId = ''       // our own bot user ID (to filter self-messages)
let _polling = false
let _lastTs = '0'         // Slack timestamp cursor for polling
const _queue: string[] = []
const _listeners: Array<(msg: string) => void> = []

const POLL_INTERVAL_MS = 3000

// ─── API helpers ─────────────────────────────────────────────────────────────

async function slackApi<T extends SlackResponse>(
  method: string,
  params: Record<string, unknown> = {},
  httpMethod: 'GET' | 'POST' = 'POST',
): Promise<T> {
  const url = `https://slack.com/api/${method}`
  const opts: RequestInit = {
    method: httpMethod,
    headers: {
      Authorization: `Bearer ${_token}`,
      'Content-Type': httpMethod === 'POST' ? 'application/json; charset=utf-8' : 'application/x-www-form-urlencoded',
    },
    signal: AbortSignal.timeout(30_000),
  }
  let finalUrl = url
  if (httpMethod === 'POST') {
    opts.body = JSON.stringify(params)
  } else {
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) qs.set(k, String(v))
    }
    finalUrl = qs.toString() ? `${url}?${qs.toString()}` : url
  }
  const res = await fetch(finalUrl, opts)
  return res.json() as Promise<T>
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function isSlackConfigured(): boolean {
  return Boolean(process.env.SLACK_BOT_TOKEN && process.env.SLACK_CHANNEL_ID)
}

export function isSlackActive(): boolean {
  return _polling
}

export function getSlackChannelId(): string {
  return _channelId
}

/**
 * Send a message to the configured Slack channel. Chunks long messages
 * (Slack accepts up to ~40k chars but we chunk at 3500 for readability).
 */
export async function sendSlackMessage(text: string): Promise<void> {
  if (!_polling || !_channelId) return
  const chunks = chunkText(text, 3500)
  for (const chunk of chunks) {
    try {
      const resp = await slackApi<SlackResponse>('chat.postMessage', {
        channel: _channelId,
        text: chunk,
        mrkdwn: true,
      })
      if (!resp.ok) {
        logForDebugging(`[slack] postMessage failed: ${resp.error}`, { level: 'warn' })
      }
    } catch (e) {
      logForDebugging(`[slack] sendMessage error: ${e}`, { level: 'warn' })
    }
  }
}

/**
 * Slack has no native "typing" indicator for bots. We simulate one by
 * posting + deleting a placeholder message, but the UX is noisy, so
 * instead we react to the most recent user message with an hourglass emoji.
 */
let _workingReactionTs = ''

export async function startSlackWorkingIndicator(): Promise<void> {
  if (!_polling || !_channelId || !_workingReactionTs) return
  try {
    await slackApi<SlackResponse>('reactions.add', {
      channel: _channelId,
      name: 'hourglass_flowing_sand',
      timestamp: _workingReactionTs,
    })
  } catch {
    // Non-critical
  }
}

export async function stopSlackWorkingIndicator(): Promise<void> {
  if (!_polling || !_channelId || !_workingReactionTs) return
  try {
    await slackApi<SlackResponse>('reactions.remove', {
      channel: _channelId,
      name: 'hourglass_flowing_sand',
      timestamp: _workingReactionTs,
    })
  } catch {
    // Non-critical — reaction may not exist
  }
}

/** Consume the next queued message from Slack, or null if none. */
export function getPendingSlackMessage(): string | null {
  return _queue.shift() ?? null
}

/** Register a callback for incoming Slack messages. Returns unsubscribe fn. */
export function onSlackMessage(cb: (msg: string) => void): () => void {
  _listeners.push(cb)
  return () => {
    const i = _listeners.indexOf(cb)
    if (i !== -1) _listeners.splice(i, 1)
  }
}

// ─── Validation / Lifecycle ──────────────────────────────────────────────────

/**
 * Validate a Slack bot token via auth.test. Returns bot identity on success.
 */
export async function validateSlackToken(
  token: string,
): Promise<
  | { ok: true; botUserId: string; teamName: string; botName: string }
  | { ok: false; error: string }
> {
  const savedToken = _token
  _token = token
  try {
    const res = await slackApi<AuthTestResponse>('auth.test', {}, 'POST')
    if (!res.ok) return { ok: false, error: res.error ?? 'auth.test failed' }
    return {
      ok: true,
      botUserId: res.user_id ?? '',
      teamName: res.team ?? '',
      botName: res.user ?? '',
    }
  } catch (e) {
    return { ok: false, error: String(e) }
  } finally {
    _token = savedToken
  }
}

/**
 * Verify the bot can access the given channel (conversations.info).
 */
export async function validateSlackChannel(
  token: string,
  channelId: string,
): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
  const savedToken = _token
  _token = token
  try {
    const res = await slackApi<SlackResponse & { channel?: { name?: string; is_im?: boolean } }>(
      'conversations.info',
      { channel: channelId },
      'GET',
    )
    if (!res.ok) return { ok: false, error: res.error ?? 'conversations.info failed' }
    const name = res.channel?.is_im ? '(direct message)' : (res.channel?.name ?? channelId)
    return { ok: true, name }
  } catch (e) {
    return { ok: false, error: String(e) }
  } finally {
    _token = savedToken
  }
}

/**
 * Initialize Slack with explicit credentials (for interactive setup).
 */
export async function initSlackWithCredentials(
  token: string,
  channelId: string,
  userId?: string,
): Promise<{ ok: true; botUserId: string } | { ok: false; error: string }> {
  _token = token
  _channelId = channelId
  _userId = userId ?? ''

  try {
    const auth = await slackApi<AuthTestResponse>('auth.test')
    if (!auth.ok) return { ok: false, error: auth.error ?? 'auth.test failed' }
    _botUserId = auth.user_id ?? ''

    process.env.SLACK_BOT_TOKEN = token
    process.env.SLACK_CHANNEL_ID = channelId
    if (userId) process.env.SLACK_USER_ID = userId

    // Seed cursor to "now" so we don't replay old messages
    _lastTs = (Date.now() / 1000).toFixed(6)

    logForDebugging(`[slack] Connected as ${auth.user} in team ${auth.team}`)
    _polling = true
    void pollLoop()
    void sendSlackMessage(`*localclawd online*\nReady to receive tasks.`)
    return { ok: true, botUserId: _botUserId }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

/**
 * Load credentials from env vars or ~/.claude/slack.json and start polling.
 */
export async function initSlack(): Promise<void> {
  let token = process.env.SLACK_BOT_TOKEN
  let channelId = process.env.SLACK_CHANNEL_ID
  let userId = process.env.SLACK_USER_ID

  if (!token || !channelId) {
    try {
      const { readFile } = await import('fs/promises')
      const { join } = await import('path')
      const { homedir } = await import('os')
      const { getClaudeConfigHomeDir } = await import('../../utils/envUtils.js')
      const newPath = join(getClaudeConfigHomeDir(), 'slack.json')
      const legacyPath = join(homedir(), '.claude', 'slack.json')
      let configPath = newPath
      try { await (await import('fs/promises')).stat(newPath) } catch { configPath = legacyPath }
      const raw = await readFile(configPath, 'utf-8')
      const config = JSON.parse(raw) as {
        token?: string
        channelId?: string
        userId?: string
      }
      if (config.token && config.channelId) {
        token = config.token
        channelId = config.channelId
        userId = config.userId
        process.env.SLACK_BOT_TOKEN = token
        process.env.SLACK_CHANNEL_ID = channelId
        if (userId) process.env.SLACK_USER_ID = userId
        logForDebugging('[slack] Loaded credentials from ~/.claude/slack.json')
      }
    } catch {
      // No saved config — fine
    }
  }

  if (!token || !channelId) return

  _token = token
  _channelId = channelId
  _userId = userId ?? ''

  try {
    const auth = await slackApi<AuthTestResponse>('auth.test')
    if (!auth.ok) {
      logForDebugging(`[slack] auth.test failed: ${auth.error}`, { level: 'warn' })
      return
    }
    _botUserId = auth.user_id ?? ''
    _lastTs = (Date.now() / 1000).toFixed(6)
    logForDebugging(`[slack] Connected as ${auth.user} in team ${auth.team}`)
    _polling = true
    void pollLoop()
    void sendSlackMessage(`*localclawd online*\nReady to receive tasks.`)
  } catch (e) {
    logForDebugging(`[slack] Init failed: ${e}`, { level: 'warn' })
  }
}

export function stopSlack(): void {
  _polling = false
}

// ─── Polling loop ────────────────────────────────────────────────────────────

async function pollLoop(): Promise<void> {
  while (_polling) {
    try {
      const resp = await slackApi<ConversationsHistoryResponse>(
        'conversations.history',
        { channel: _channelId, oldest: _lastTs, limit: 50 },
        'GET',
      )

      if (!resp.ok) {
        logForDebugging(`[slack] history failed: ${resp.error}`, { level: 'warn' })
        await sleep(5000)
        continue
      }

      // conversations.history returns newest first; reverse for chronological order
      const messages = (resp.messages ?? []).slice().reverse()
      for (const m of messages) {
        if (parseFloat(m.ts) > parseFloat(_lastTs)) {
          _lastTs = m.ts
        }
        await handleMessage(m)
      }
    } catch (e) {
      if (_polling) {
        logForDebugging(`[slack] Poll error: ${e}`, { level: 'warn' })
        await sleep(5000)
        continue
      }
    }
    await sleep(POLL_INTERVAL_MS)
  }
}

async function handleMessage(m: SlackMessage): Promise<void> {
  // Skip bot messages (including our own)
  if (m.bot_id) return
  if (m.subtype && m.subtype !== 'thread_broadcast' && m.subtype !== 'file_share') return
  if (_botUserId && m.user === _botUserId) return

  // User filter
  if (_userId && m.user !== _userId) {
    logForDebugging(`[slack] Ignored message from unauthorized user ${m.user}`)
    return
  }

  // Voice / audio attachment — transcribe and treat as text
  const audioFile = m.files?.find(f => f.mimetype?.startsWith('audio/'))
  if (!m.text && audioFile?.url_private_download) {
    const transcribed = await transcribeSlackAudio(audioFile)
    if (transcribed) {
      m = { ...m, text: m.text ? `${m.text}\n${transcribed}` : transcribed }
      void sendSlackMessage(`🎙 _transcribed:_ ${transcribed.slice(0, 200)}${transcribed.length > 200 ? '…' : ''}`)
    } else {
      void sendSlackMessage(
        '🎙 Voice received, but transcription is not configured.\n' +
        'Set one of: `STT_BASE_URL`+`STT_API_KEY`, `GROQ_API_KEY`, or `OPENAI_API_KEY`.',
      )
      return
    }
  }

  if (!m.text) return

  // Strip <@BOTID> prefix if user @-mentioned us
  let text = m.text.trim()
  if (_botUserId) {
    const mentionRe = new RegExp(`^<@${_botUserId}>\\s*`)
    text = text.replace(mentionRe, '').trim()
  }
  if (!text) return

  logForDebugging(`[slack] Message from ${m.user}: ${text.slice(0, 80)}`)

  // Track this message's ts for working-indicator reactions
  _workingReactionTs = m.ts

  // Bot commands
  if (text.startsWith('/')) {
    if (text === '/stop') {
      globalStopSignal.set(true)
      void sendSlackMessage('Stopping current task...')
      return
    }
    if (text === '/kill') {
      void sendSlackMessage('Killing ALL localclawd instances...').then(async () => {
        const killed = await killAllIncludingSelf()
        void sendSlackMessage(`Killed ${killed} instance(s). Self-terminating.`)
      })
      return
    }
    if (text === '/start' || text === '/help') {
      void sendSlackMessage(
        '*localclawd ready*\nSend a task and I\'ll start working on it.\n\n' +
        'Commands:\n' +
        '`/stop` — stop current task\n' +
        '`/kill` — kill all instances\n' +
        '`/status` — show current status',
      )
      return
    }
    if (text === '/status') {
      const { getProjectStatus } = await import('../project/projectMemory.js')
      const status = await getProjectStatus()
      void sendSlackMessage(`*Status*\n${status}`)
      return
    }
    if (text === '/schedule' || text === '/schedules') {
      const { listSchedules } = await import('../schedule/scheduler.js')
      const t = await listSchedules()
      void sendSlackMessage(`*Schedules*\n${t}`)
      return
    }
    void sendSlackMessage(
      `Unknown command: ${text}\n\nAvailable: /stop /kill /status /schedules /help`,
    )
    return
  }

  // Plain message — queue as a prompt for the agent.
  void startSlackWorkingIndicator()
  try {
    const { enqueue } = await import('../../utils/messageQueueManager.js')
    enqueue({ value: text, mode: 'prompt', priority: 'now' })
  } catch (e) {
    _queue.push(text)
    logForDebugging(`[slack] Failed to enqueue: ${e}`)
  }

  for (const cb of _listeners) {
    try { cb(text) } catch { /* ignore */ }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function transcribeSlackAudio(file: SlackFile): Promise<string | null> {
  const url = file.url_private_download ?? file.url_private
  if (!url) return null
  try {
    const { transcribeFromUrl } = await import('../voice/transcribeAudio.js')
    const filename = file.name ?? 'voice.m4a'
    return await transcribeFromUrl(url, filename, `Bearer ${_token}`)
  } catch (e) {
    logForDebugging(`[slack] voice transcription failed: ${e}`)
    return null
  }
}

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
