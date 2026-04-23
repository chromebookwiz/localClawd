/**
 * Signal Bot Service — two-way bridge via signal-cli.
 *
 * Unlike Telegram/Slack/Discord, Signal has no public API for third
 * parties. We shell out to `signal-cli` (https://github.com/AsamK/signal-cli)
 * in JSON-RPC mode, which the user must install separately.
 *
 * Config:
 *   SIGNAL_NUMBER        — the registered Signal phone number (E.164, e.g. +15551234567)
 *   SIGNAL_RECIPIENT     — the other party's number (messages are sent to them)
 *   SIGNAL_CLI_PATH      — (optional) path to signal-cli binary, default "signal-cli"
 *
 * Once the user has run `signal-cli -u +XXXXXXXXXXX register` and verified,
 * this bridge polls `receive` periodically and forwards messages to the agent.
 */

import { spawn, spawnSync } from 'child_process'
import { logForDebugging } from '../../utils/debug.js'
import { globalStopSignal } from '../telegram/telegramSignals.js'
import { killAllIncludingSelf } from '../telegram/telegramKill.js'

let _number = ''
let _recipient = ''
let _binary = 'signal-cli'
let _polling = false
const _queue: string[] = []

const POLL_INTERVAL_MS = 5000

// ─── Public API ──────────────────────────────────────────────────────────────

export function isSignalConfigured(): boolean {
  return Boolean(process.env.SIGNAL_NUMBER && process.env.SIGNAL_RECIPIENT)
}

export function isSignalActive(): boolean {
  return _polling
}

export function getSignalRecipient(): string {
  return _recipient
}

/** Check whether signal-cli is on PATH (or at SIGNAL_CLI_PATH). */
export function isSignalCliAvailable(): boolean {
  try {
    const binary = process.env.SIGNAL_CLI_PATH ?? 'signal-cli'
    const result = spawnSync(binary, ['--version'], { encoding: 'utf-8', timeout: 5000 })
    return result.status === 0
  } catch {
    return false
  }
}

export async function sendSignalMessage(text: string): Promise<void> {
  if (!_polling || !_recipient) return
  const chunks = chunkText(text, 2000)
  for (const chunk of chunks) {
    await runSignalCli(['-u', _number, 'send', '-m', chunk, _recipient]).catch(e => {
      logForDebugging(`[signal] send failed: ${e}`, { level: 'warn' })
    })
  }
}

export function getPendingSignalMessage(): string | null {
  return _queue.shift() ?? null
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

export async function initSignal(): Promise<void> {
  const number = process.env.SIGNAL_NUMBER
  const recipient = process.env.SIGNAL_RECIPIENT
  if (!number || !recipient) return

  if (!isSignalCliAvailable()) {
    logForDebugging('[signal] signal-cli not found on PATH — install from https://github.com/AsamK/signal-cli', { level: 'warn' })
    return
  }

  _number = number
  _recipient = recipient
  _binary = process.env.SIGNAL_CLI_PATH ?? 'signal-cli'
  _polling = true
  logForDebugging(`[signal] Connected as ${_number} → ${_recipient}`)
  void pollLoop()
  void sendSignalMessage('localclawd online. Ready to receive tasks.')
}

export function stopSignal(): void {
  _polling = false
}

// ─── signal-cli wrapper ──────────────────────────────────────────────────────

interface SignalCliResult { ok: boolean; stdout: string; stderr: string }

function runSignalCli(args: string[], timeoutMs: number = 30_000): Promise<SignalCliResult> {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    const child = spawn(_binary, args, { shell: false })
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs)
    child.stdout.on('data', (c: Buffer) => { stdout += c.toString('utf-8') })
    child.stderr.on('data', (c: Buffer) => { stderr += c.toString('utf-8') })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ ok: code === 0, stdout, stderr })
    })
    child.on('error', () => {
      clearTimeout(timer)
      resolve({ ok: false, stdout, stderr: 'spawn error' })
    })
  })
}

// ─── Poll loop ───────────────────────────────────────────────────────────────

interface SignalEnvelope {
  envelope?: {
    source?: string
    sourceNumber?: string
    dataMessage?: {
      message?: string
      timestamp?: number
    }
  }
}

async function pollLoop(): Promise<void> {
  while (_polling) {
    try {
      // `receive --json` prints one envelope per line
      const res = await runSignalCli(['-u', _number, 'receive', '--json', '-t', '3'], 20_000)
      if (res.ok && res.stdout) {
        const lines = res.stdout.split('\n').filter(l => l.trim())
        for (const line of lines) {
          try {
            const env = JSON.parse(line) as SignalEnvelope
            await handleEnvelope(env)
          } catch { /* non-JSON line, skip */ }
        }
      }
    } catch (e) {
      if (_polling) logForDebugging(`[signal] poll error: ${e}`, { level: 'warn' })
    }
    await sleep(POLL_INTERVAL_MS)
  }
}

async function handleEnvelope(env: SignalEnvelope): Promise<void> {
  const source = env.envelope?.sourceNumber ?? env.envelope?.source
  const text = env.envelope?.dataMessage?.message?.trim()
  if (!text || !source) return

  // Security: only accept messages from the configured recipient
  if (source !== _recipient) {
    logForDebugging(`[signal] ignored message from ${source}`)
    return
  }

  if (text.startsWith('/')) {
    if (text === '/stop') {
      globalStopSignal.set(true)
      void sendSignalMessage('Stopping current task...')
      return
    }
    if (text === '/kill') {
      void sendSignalMessage('Killing ALL localclawd instances...').then(async () => {
        const killed = await killAllIncludingSelf()
        void sendSignalMessage(`Killed ${killed} instance(s). Self-terminating.`)
      })
      return
    }
    if (text === '/help' || text === '/start') {
      void sendSignalMessage(
        'localclawd commands:\n' +
        '/stop — stop current task\n' +
        '/kill — kill all instances\n' +
        '/status — project status\n' +
        '/schedules — list scheduled jobs',
      )
      return
    }
    if (text === '/status') {
      const { getProjectStatus } = await import('../project/projectMemory.js')
      const status = await getProjectStatus()
      void sendSignalMessage(`Status\n${status}`)
      return
    }
    if (text === '/schedule' || text === '/schedules') {
      const { listSchedules } = await import('../schedule/scheduler.js')
      const t = await listSchedules()
      void sendSignalMessage(`Schedules\n${t}`)
      return
    }
    void sendSignalMessage(`Unknown command: ${text}\n\nAvailable: /stop /kill /status /schedules /help`)
    return
  }

  try {
    const { enqueue } = await import('../../utils/messageQueueManager.js')
    enqueue({ value: text, mode: 'prompt', priority: 'now' })
  } catch {
    _queue.push(text)
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
