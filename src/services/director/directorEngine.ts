/**
 * Director Engine — the review loop that supervises autonomous work.
 *
 * The director:
 *   1. Loads persistent memory (projects, file index, task history)
 *   2. Builds a context-rich prompt for the current task
 *   3. After each round, reviews the model's output
 *   4. Re-prompts if work is incomplete
 *   5. Records outcomes and updates memory when done
 *
 * Operates within the same localclawd instance using the onDone →
 * metaMessages → nextInput loop pattern from /keepgoing.
 */

import {
  loadDirectorState,
  saveDirectorState,
  registerProject,
  boostProject,
  indexProjectFiles,
  recordTask,
  pruneMemory,
  shouldPrune,
  getProjectContext,
} from './directorMemoryOps.js'
import {
  buildDirectorTaskPrompt,
  buildDirectorReviewPrompt,
  buildDirectorStatusText,
} from './directorPrompts.js'
import type { DirectorMemoryState } from './directorMemory.js'
import { logForDebugging } from '../../utils/debug.js'
import {
  isTelegramActive,
  sendTelegramMessage,
} from '../telegram/telegramBot.js'

// ─── Module-level state ──────────────────────────────────────────────────────

let _round = 0
let _task = ''
let _projectId = ''
let _maxRounds = 20
let _startGitRef = ''
let _projectPath = ''
let _heartbeatTimer: ReturnType<typeof setInterval> | null = null
let _taskStartTime = 0

export function getDirectorRound(): number { return _round }
export function getDirectorTask(): string { return _task }
export function isDirectorActive(): boolean { return _task !== '' }

export function resetDirector(): void {
  _round = 0
  _task = ''
  _projectId = ''
  _startGitRef = ''
  _projectPath = ''
  _taskStartTime = 0
  stopHeartbeat()
}

// ─── Stop signal detection (shared with keepgoing) ──────────────────────────

const STOP_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /TASK[_ ]COMPLETE:/i,  label: 'task complete' },
  { pattern: /NEEDS[_ ]INPUT:/i,    label: 'needs input' },
  { pattern: /\bFINISHED\b/i,       label: 'finished' },
  { pattern: /ALL[_ ]DONE\b/i,      label: 'all done' },
  { pattern: /WORK[_ ]COMPLETE:/i,  label: 'work complete' },
]

export function detectStopSignal(text: string): string | null {
  for (const { pattern, label } of STOP_PATTERNS)
    if (pattern.test(text)) return label
  return null
}

// ─── Core operations ─────────────────────────────────────────────────────────

/**
 * Start a new director task. Returns the first prompt to send to the model.
 */
export async function startDirectorTask(
  task: string,
  projectPath: string,
  maxRounds?: number,
): Promise<{ prompt: string; projectId: string }> {
  const state = await loadDirectorState()

  // Auto-prune if due
  if (shouldPrune(state)) {
    pruneMemory(state)
  }

  // Register/boost project
  const project = await registerProject(state, projectPath)
  boostProject(state, project.id)

  // Index project files (lazy refresh)
  await indexProjectFiles(state, project.id, projectPath)

  await saveDirectorState(state)

  _round = 1
  _task = task
  _projectId = project.id
  _maxRounds = maxRounds ?? 20
  _projectPath = projectPath

  // Capture git ref for change summary at completion
  _startGitRef = await captureGitRef(projectPath)

  // Start 30-minute heartbeat timer
  startHeartbeat()

  const context = getProjectContext(state, project.id)
  const prompt = buildDirectorTaskPrompt(task, context, _round, _maxRounds)

  logForDebugging(`[director] Starting task in ${project.id}: ${task.slice(0, 80)}`)
  return { prompt, projectId: project.id }
}

/**
 * Review the model's response and decide whether to continue.
 * Returns null if the task is done, or a continuation prompt.
 */
export async function reviewAndContinue(
  lastAssistantText: string,
  telegramMsg: string | null,
): Promise<{
  done: boolean
  reason?: string
  prompt?: string
}> {
  const stopReason = detectStopSignal(lastAssistantText)

  if (stopReason) {
    // Task is done — record to memory
    await recordTaskOutcome(
      stopReason === 'needs input' ? 'blocked' : 'success',
      lastAssistantText,
    )
    return { done: true, reason: stopReason }
  }

  // Not done — continue with review
  _round++

  if (isFinite(_maxRounds) && _round > _maxRounds) {
    await recordTaskOutcome('partial', 'Round cap reached')
    return { done: true, reason: `round cap reached (${_maxRounds})` }
  }

  const reviewNotes = buildReviewNotes(lastAssistantText)
  const prompt = buildDirectorReviewPrompt(_round, _maxRounds, reviewNotes, telegramMsg)

  return { done: false, prompt }
}

/**
 * Get a status summary for display when /director is called with no args.
 */
export async function getDirectorStatus(): Promise<string> {
  const state = await loadDirectorState()
  return buildDirectorStatusText(state.projects, state.taskHistory)
}

// ─── Internal helpers ────────────────────────────────────────────────────────

function buildReviewNotes(lastText: string): string {
  // Extract completed items
  const completedLines = lastText
    .split('\n')
    .filter(l => /^Completed:/i.test(l.trim()))
    .map(l => l.trim())

  if (completedLines.length > 0) {
    return `Progress noted:\n${completedLines.map(l => `  ${l}`).join('\n')}\n\nThe task is not yet fully complete. Continue with remaining work.`
  }

  return 'The director did not detect a completion signal. Continue working toward the task goal.'
}

async function recordTaskOutcome(
  outcome: 'success' | 'partial' | 'failed' | 'blocked',
  summary: string,
): Promise<void> {
  try {
    const state = await loadDirectorState()
    recordTask(state, _projectId, _task, outcome, summary.slice(0, 500), _round)
    await saveDirectorState(state)
    logForDebugging(`[director] Task recorded: ${outcome} after ${_round} rounds`)
  } catch (e) {
    logForDebugging(`[director] Failed to record task: ${e}`)
  }
}

// ─── Heartbeat (30-minute updates) ──────────────────────────────────────────

const HEARTBEAT_INTERVAL_MS = 30 * 60 * 1000 // 30 minutes

function startHeartbeat(): void {
  stopHeartbeat()
  _taskStartTime = Date.now()
  _heartbeatTimer = setInterval(() => {
    void sendHeartbeatUpdate()
  }, HEARTBEAT_INTERVAL_MS)
}

function stopHeartbeat(): void {
  if (_heartbeatTimer) {
    clearInterval(_heartbeatTimer)
    _heartbeatTimer = null
  }
}

async function sendHeartbeatUpdate(): Promise<void> {
  const elapsed = Math.round((Date.now() - _taskStartTime) / (1000 * 60))
  const msg = `Director heartbeat — still working\nTask: ${_task.slice(0, 100)}\nRound: ${_round}/${isFinite(_maxRounds) ? _maxRounds : '∞'}\nElapsed: ${elapsed} min`

  if (isTelegramActive()) {
    void sendTelegramMessage(msg)
  }
  // Desktop notification (cross-platform, no React needed)
  void sendDesktopNotification('localclawd Director', msg)
  logForDebugging(`[director] Heartbeat sent at ${elapsed}min`)
}

async function sendDesktopNotification(title: string, message: string): Promise<void> {
  try {
    const { execFile } = await import('child_process')
    const platform = process.platform
    const flatMsg = message.replace(/\n/g, ' ')
    if (platform === 'win32') {
      // PowerShell toast — use -EncodedCommand to avoid injection
      const script = `
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml("<toast><visual><binding template='ToastText02'><text id='1'>$([Security.SecurityElement]::Escape('${title}'))</text><text id='2'>$([Security.SecurityElement]::Escape('${flatMsg}'))</text></binding></visual></toast>")
$toast = New-Object Windows.UI.Notifications.ToastNotification($xml)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('localclawd').Show($toast)
`
      const encoded = Buffer.from(script, 'utf16le').toString('base64')
      execFile('powershell', ['-NoProfile', '-EncodedCommand', encoded])
    } else if (platform === 'darwin') {
      // osascript — pass as argument array, no shell interpolation
      execFile('osascript', ['-e', `display notification "${flatMsg}" with title "${title}"`])
    } else {
      // Linux — notify-send with argument array
      execFile('notify-send', [title, flatMsg])
    }
  } catch {
    // Best-effort — don't crash if notifications fail
  }
}

// ─── Git diff summary for completion reports ────────────────────────────────

async function captureGitRef(projectPath: string): Promise<string> {
  try {
    const { execSync } = await import('child_process')
    const ref = execSync('git rev-parse HEAD', {
      cwd: projectPath,
      encoding: 'utf-8',
      timeout: 5000,
    }).trim()
    return ref
  } catch {
    return ''
  }
}

export async function getChangeSummary(): Promise<string> {
  if (!_startGitRef || !_projectPath) return ''
  try {
    const { execSync } = await import('child_process')

    // Get diff stat from start ref to current HEAD
    const currentRef = execSync('git rev-parse HEAD', {
      cwd: _projectPath, encoding: 'utf-8', timeout: 5000,
    }).trim()

    if (currentRef === _startGitRef) {
      // Check for uncommitted changes
      const status = execSync('git diff --stat', {
        cwd: _projectPath, encoding: 'utf-8', timeout: 5000,
      }).trim()
      if (status) return `Uncommitted changes:\n${status}`
      return 'No changes detected.'
    }

    const diffStat = execSync(`git diff --stat ${_startGitRef}..HEAD`, {
      cwd: _projectPath, encoding: 'utf-8', timeout: 10000,
    }).trim()

    const nameStatus = execSync(`git diff --name-status ${_startGitRef}..HEAD`, {
      cwd: _projectPath, encoding: 'utf-8', timeout: 10000,
    }).trim()

    const commitLog = execSync(`git log --oneline ${_startGitRef}..HEAD`, {
      cwd: _projectPath, encoding: 'utf-8', timeout: 5000,
    }).trim()

    const lines: string[] = []
    if (commitLog) {
      lines.push('Commits:')
      lines.push(commitLog)
      lines.push('')
    }
    if (nameStatus) {
      lines.push('Files changed:')
      lines.push(nameStatus)
      lines.push('')
    }
    if (diffStat) {
      lines.push(diffStat)
    }

    // Also check for uncommitted changes
    const uncommitted = execSync('git diff --stat', {
      cwd: _projectPath, encoding: 'utf-8', timeout: 5000,
    }).trim()
    if (uncommitted) {
      lines.push('')
      lines.push('Uncommitted changes:')
      lines.push(uncommitted)
    }

    return lines.join('\n') || 'No changes detected.'
  } catch (e) {
    logForDebugging(`[director] Failed to get change summary: ${e}`)
    return 'Unable to generate change summary.'
  }
}
