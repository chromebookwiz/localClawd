/**
 * Lightweight cron scheduler — runs inside localclawd and fires scheduled
 * prompts into the message queue (and optionally broadcasts results to
 * any active chat bridge).
 *
 * Schedules persist at ~/.claude/schedules.json. Supports 5-field cron
 * expressions (min hour dom mon dow) plus shorthand:
 *   @hourly @daily @weekly @monthly
 *   every Nm | every Nh | every Nd
 */

import { mkdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'
import { logForDebugging } from '../../utils/debug.js'

export interface ScheduleEntry {
  id: string
  name: string
  schedule: string      // cron expression or shorthand
  prompt: string        // what to send to the agent
  enabled: boolean
  lastRun: number       // epoch ms (0 = never)
  nextRun: number       // epoch ms
  deliverTo: 'cli' | 'telegram' | 'slack' | 'discord' | 'auto'
}

interface ScheduleFile {
  version: 1
  schedules: ScheduleEntry[]
}

const SCHEDULES_PATH = join(homedir(), '.claude', 'schedules.json')
const TICK_INTERVAL_MS = 30_000

let _tickTimer: ReturnType<typeof setInterval> | null = null

// ─── I/O ─────────────────────────────────────────────────────────────────────

async function loadSchedules(): Promise<ScheduleFile> {
  try {
    const raw = await readFile(SCHEDULES_PATH, 'utf-8')
    const parsed = JSON.parse(raw) as ScheduleFile
    if (parsed.version !== 1) return { version: 1, schedules: [] }
    return parsed
  } catch {
    return { version: 1, schedules: [] }
  }
}

async function saveSchedules(file: ScheduleFile): Promise<void> {
  await mkdir(join(homedir(), '.claude'), { recursive: true })
  await writeFile(SCHEDULES_PATH, JSON.stringify(file, null, 2), 'utf-8')
}

// ─── Cron parsing ────────────────────────────────────────────────────────────

function nextRunTime(expr: string, from: number = Date.now()): number {
  const trimmed = expr.trim().toLowerCase()

  // Shorthand
  if (trimmed === '@hourly') return from + 60 * 60 * 1000
  if (trimmed === '@daily' || trimmed === '@midnight') {
    const d = new Date(from)
    d.setDate(d.getDate() + 1)
    d.setHours(0, 0, 0, 0)
    return d.getTime()
  }
  if (trimmed === '@weekly') {
    const d = new Date(from)
    d.setDate(d.getDate() + (7 - d.getDay()))
    d.setHours(0, 0, 0, 0)
    return d.getTime()
  }
  if (trimmed === '@monthly') {
    const d = new Date(from)
    d.setMonth(d.getMonth() + 1)
    d.setDate(1)
    d.setHours(0, 0, 0, 0)
    return d.getTime()
  }

  // "every Nm|h|d"
  const everyMatch = trimmed.match(/^every\s+(\d+)\s*([mhd])$/)
  if (everyMatch) {
    const n = parseInt(everyMatch[1]!, 10)
    const unit = everyMatch[2]!
    const ms = unit === 'm' ? n * 60_000 : unit === 'h' ? n * 3_600_000 : n * 86_400_000
    return from + ms
  }

  // 5-field cron: minute hour dom month dow
  const fields = trimmed.split(/\s+/)
  if (fields.length !== 5) return from + 60_000 // fallback: one minute

  const [minF, hourF, domF, , dowF] = fields as [string, string, string, string, string]

  // Scan up to 7 days ahead minute-by-minute
  for (let minutes = 1; minutes < 60 * 24 * 7; minutes++) {
    const t = from + minutes * 60_000
    const d = new Date(t)
    if (
      matchesField(d.getMinutes(), minF, 0, 59) &&
      matchesField(d.getHours(), hourF, 0, 23) &&
      matchesField(d.getDate(), domF, 1, 31) &&
      matchesField(d.getDay(), dowF, 0, 6)
    ) {
      // Round to start of minute
      d.setSeconds(0, 0)
      return d.getTime()
    }
  }
  return from + 60_000
}

function matchesField(
  value: number,
  field: string,
  min: number,
  max: number,
): boolean {
  if (field === '*') return true

  // a,b,c
  if (field.includes(',')) {
    return field.split(',').some(f => matchesField(value, f.trim(), min, max))
  }

  // */N
  const stepMatch = field.match(/^\*\/(\d+)$/)
  if (stepMatch) {
    const step = parseInt(stepMatch[1]!, 10)
    return step > 0 && (value - min) % step === 0
  }

  // a-b
  const rangeMatch = field.match(/^(\d+)-(\d+)$/)
  if (rangeMatch) {
    const a = parseInt(rangeMatch[1]!, 10)
    const b = parseInt(rangeMatch[2]!, 10)
    return value >= a && value <= b
  }

  // literal
  const n = parseInt(field, 10)
  return !isNaN(n) && n === value
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function addSchedule(
  name: string,
  schedule: string,
  prompt: string,
  deliverTo: ScheduleEntry['deliverTo'] = 'auto',
): Promise<ScheduleEntry> {
  const file = await loadSchedules()
  const entry: ScheduleEntry = {
    id: `sched-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    schedule,
    prompt,
    enabled: true,
    lastRun: 0,
    nextRun: nextRunTime(schedule),
    deliverTo,
  }
  file.schedules.push(entry)
  await saveSchedules(file)
  return entry
}

export async function removeSchedule(id: string): Promise<boolean> {
  const file = await loadSchedules()
  const before = file.schedules.length
  file.schedules = file.schedules.filter(s => s.id !== id && s.name !== id)
  await saveSchedules(file)
  return file.schedules.length < before
}

export async function toggleSchedule(id: string, enabled: boolean): Promise<boolean> {
  const file = await loadSchedules()
  const s = file.schedules.find(s => s.id === id || s.name === id)
  if (!s) return false
  s.enabled = enabled
  await saveSchedules(file)
  return true
}

export async function listSchedules(): Promise<string> {
  const file = await loadSchedules()
  if (file.schedules.length === 0) return 'No schedules configured.'
  const lines: string[] = []
  for (const s of file.schedules) {
    const status = s.enabled ? '●' : '○'
    const next = s.nextRun ? new Date(s.nextRun).toISOString().slice(0, 16).replace('T', ' ') : 'n/a'
    lines.push(`${status} ${s.name} [${s.schedule}] → ${next}`)
    lines.push(`   ${s.prompt.slice(0, 80)}${s.prompt.length > 80 ? '…' : ''}`)
  }
  return lines.join('\n')
}

export async function getSchedules(): Promise<ScheduleEntry[]> {
  const file = await loadSchedules()
  return file.schedules
}

// ─── Tick loop ───────────────────────────────────────────────────────────────

export function startScheduler(): void {
  if (_tickTimer) return
  _tickTimer = setInterval(() => void tick(), TICK_INTERVAL_MS)
  // Run an initial tick shortly after startup
  setTimeout(() => void tick(), 5_000)
}

export function stopScheduler(): void {
  if (_tickTimer) {
    clearInterval(_tickTimer)
    _tickTimer = null
  }
}

async function tick(): Promise<void> {
  try {
    const file = await loadSchedules()
    const now = Date.now()
    let changed = false

    for (const s of file.schedules) {
      if (!s.enabled) continue
      if (s.nextRun > now) continue
      await fireSchedule(s)
      s.lastRun = now
      s.nextRun = nextRunTime(s.schedule, now)
      changed = true
    }

    if (changed) await saveSchedules(file)
  } catch (e) {
    logForDebugging(`[scheduler] tick error: ${e}`)
  }
}

async function fireSchedule(s: ScheduleEntry): Promise<void> {
  logForDebugging(`[scheduler] firing ${s.name}: ${s.prompt.slice(0, 60)}`)

  // Deliver to active chat bridge if requested
  try {
    if (s.deliverTo === 'telegram' || s.deliverTo === 'auto') {
      const { isTelegramActive, sendTelegramMessage } = await import('../telegram/telegramBot.js')
      if (isTelegramActive()) {
        void sendTelegramMessage(`⏰ *Scheduled: ${s.name}*\n${s.prompt.slice(0, 200)}`)
      }
    }
    if (s.deliverTo === 'slack' || s.deliverTo === 'auto') {
      const { isSlackActive, sendSlackMessage } = await import('../slack/slackBot.js')
      if (isSlackActive()) {
        void sendSlackMessage(`⏰ *Scheduled: ${s.name}*\n${s.prompt.slice(0, 200)}`)
      }
    }
    if (s.deliverTo === 'discord' || s.deliverTo === 'auto') {
      const { isDiscordActive, sendDiscordMessage } = await import('../discord/discordBot.js')
      if (isDiscordActive()) {
        void sendDiscordMessage(`⏰ **Scheduled: ${s.name}**\n${s.prompt.slice(0, 200)}`)
      }
    }
  } catch { /* bridge modules optional */ }

  // Queue prompt into the agent
  try {
    const { enqueue } = await import('../../utils/messageQueueManager.js')
    enqueue({ value: s.prompt, mode: 'prompt', priority: 'now' })
  } catch (e) {
    logForDebugging(`[scheduler] failed to enqueue ${s.name}: ${e}`)
  }
}

/** Exported for use by the `/schedule` command's validation. */
export function validateScheduleExpression(expr: string): { ok: true } | { ok: false; error: string } {
  const trimmed = expr.trim().toLowerCase()
  if (/^@(hourly|daily|midnight|weekly|monthly)$/.test(trimmed)) return { ok: true }
  if (/^every\s+\d+\s*[mhd]$/.test(trimmed)) return { ok: true }
  const fields = trimmed.split(/\s+/)
  if (fields.length !== 5) {
    return { ok: false, error: 'Must be 5-field cron, @hourly/@daily/@weekly/@monthly, or "every Nm/Nh/Nd"' }
  }
  return { ok: true }
}
