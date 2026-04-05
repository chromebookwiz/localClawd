/**
 * /keepgoing — ultimate persistent autonomous mode.
 *
 * The model works continuously until it explicitly signals completion.
 * After each response the command re-queues itself via nextInput, creating
 * an unbroken loop. The only exits are:
 *
 *   a) Model emits a STOP SIGNAL (see list below)
 *   b) User presses Ctrl+C or types a new message (interrupts the loop)
 *   c) Round cap is reached (default: 50, override with /keepgoing 100 or
 *      /keepgoing unlimited)
 *
 * STOP SIGNALS (any of these in the last assistant message ends the loop):
 *   TASK COMPLETE:   — all work is done
 *   TASK_COMPLETE:   — underscore variant
 *   NEEDS INPUT:     — blocked, requires user clarification
 *   NEEDS_INPUT:     — underscore variant
 *   FINISHED:        — simple completion marker
 *   ALL DONE:        — natural language variant
 *   WORK COMPLETE:   — work complete variant
 *
 * SUBAGENT SUPPORT
 * The continuation prompt explicitly tells the model it may spawn subagents
 * for parallel or complex work using the Agent tool. Sub-tasks that are
 * independent should run in parallel. The model is reminded of all available
 * tools on every round so it does not forget capabilities.
 *
 * ROUND COUNTER
 * The banner shows which round the loop is on so the user has visibility into
 * how much autonomous work has been done.
 */

import * as React from 'react'
import { Box, Text } from '../../ink.js'
import type { LocalJSXCommandCall } from '../../types/command.js'

// ─── Module-level loop state (per process) ───────────────────────────────────

let sessionRound = 0
let sessionFocus = ''

function resetSession(focus: string): void {
  sessionRound = 0
  sessionFocus = focus
}

function incrementRound(): number {
  sessionRound += 1
  return sessionRound
}

// ─── Configuration ────────────────────────────────────────────────────────────

const DEFAULT_MAX_ROUNDS = 50

function parseMaxRounds(args: string): { maxRounds: number; focus: string } {
  const parts = args.trim().split(/\s+/)
  let maxRounds = DEFAULT_MAX_ROUNDS
  const focusParts: string[] = []

  for (const part of parts) {
    if (part === 'unlimited' || part === '0') {
      maxRounds = Infinity
    } else if (/^\d+$/.test(part)) {
      maxRounds = parseInt(part, 10)
    } else if (part) {
      focusParts.push(part)
    }
  }

  return { maxRounds, focus: focusParts.join(' ') }
}

// ─── Stop signal detection ────────────────────────────────────────────────────

const STOP_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /TASK[_ ]COMPLETE:/i,  label: 'task complete' },
  { pattern: /NEEDS[_ ]INPUT:/i,    label: 'paused — needs input' },
  { pattern: /\bFINISHED\b/,        label: 'finished' },
  { pattern: /ALL[_ ]DONE\b/i,      label: 'all done' },
  { pattern: /WORK[_ ]COMPLETE:/i,  label: 'work complete' },
]

function detectStopSignal(text: string): string | null {
  for (const { pattern, label } of STOP_PATTERNS)
    if (pattern.test(text)) return label
  return null
}

// ─── Continuation prompt ──────────────────────────────────────────────────────

function buildContinuationPrompt(round: number, maxRounds: number, focus: string): string {
  const roundInfo = isFinite(maxRounds)
    ? `Round ${round} of ${maxRounds}`
    : `Round ${round} (unlimited)`

  const focusLine = focus
    ? `\nCurrent focus: ${focus}\n`
    : ''

  return `\
[KEEP GOING — AUTONOMOUS OPERATION — ${roundInfo}]
${focusLine}
You are in full autonomous mode. Work continuously until all tasks are done.

━━━ CAPABILITIES ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
You have access to ALL tools:
  • Read, Write, Edit, MultiEdit   — file operations
  • Bash                           — run commands, builds, tests, git
  • Glob, Grep                     — search codebase
  • WebFetch, WebSearch            — internet access
  • Agent                          — SPAWN SUBAGENTS for parallel/complex work
  • TodoCreate, TodoUpdate         — task tracking

SPAWN SUBAGENTS when:
  → A sub-task is independent of current work (run in parallel)
  → A task is complex enough to benefit from a fresh context
  → You need specialized work done concurrently (e.g., research + implement)

━━━ AUTONOMOUS RULES ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. DO NOT ask for confirmation between steps — proceed immediately
2. After completing a major milestone, state: "Completed: <what was done>"
3. After significant changes, run tests/builds to verify correctness
4. Use git commits after each logical unit of work
5. If you encounter a blocker you cannot resolve autonomously, emit:
     NEEDS INPUT: <specific question>
   Then stop and wait — do NOT guess or assume critical details
6. When ALL work is truly complete, emit:
     TASK COMPLETE: <one-sentence summary of everything accomplished>

━━━ CONTINUE NOW ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Pick up exactly where you left off. Do not re-explain what was already done.
Proceed directly with the next action.`
}

// ─── UI Components ────────────────────────────────────────────────────────────

function KeepGoingBanner({
  round,
  maxRounds,
  focus,
  onReady,
}: {
  round: number
  maxRounds: number
  focus: string
  onReady: () => void
}): React.ReactNode {
  React.useEffect(() => {
    const id = setTimeout(onReady, 0)
    return () => clearTimeout(id)
  }, [onReady])

  const roundDisplay = isFinite(maxRounds)
    ? `${round}/${maxRounds}`
    : `${round}/∞`

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color="cyan">
        {`◆ Keep Going  [round ${roundDisplay}]`}
      </Text>
      {focus ? (
        <Text dimColor color="cyan">{`  ↳ Focus: ${focus}`}</Text>
      ) : (
        <Text dimColor>{'  ↳ Press Ctrl+C or type to intervene at any time'}</Text>
      )}
    </Box>
  )
}

function KeepGoingDone({
  round,
  reason,
  onReady,
}: {
  round: number
  reason: string
  onReady: () => void
}): React.ReactNode {
  React.useEffect(() => {
    const id = setTimeout(onReady, 0)
    return () => clearTimeout(id)
  }, [onReady])

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color="green">
        {`◆ Keep Going — stopped after ${round} rounds`}
      </Text>
      <Text dimColor>{`  Reason: ${reason}`}</Text>
    </Box>
  )
}

function KeepGoingCapReached({
  round,
  maxRounds,
  focus,
  onReady,
}: {
  round: number
  maxRounds: number
  focus: string
  onReady: () => void
}): React.ReactNode {
  React.useEffect(() => {
    const id = setTimeout(onReady, 0)
    return () => clearTimeout(id)
  }, [onReady])

  const resumeCmd = focus ? `/keepgoing ${focus}` : '/keepgoing'

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color="yellow">
        {`◆ Keep Going — round cap reached (${round}/${maxRounds})`}
      </Text>
      <Text dimColor>{`  Type ${resumeCmd} to continue for another ${maxRounds} rounds.`}</Text>
    </Box>
  )
}

// ─── Command entry point ──────────────────────────────────────────────────────

export const call: LocalJSXCommandCall = async (onDone, context, args) => {
  const rawArgs = args?.trim() ?? ''

  // On first invocation (round 0), initialize session state.
  // Subsequent invocations (round > 0) detect this because sessionRound > 0
  // AND the focus matches. If focus changed, reset.
  const { maxRounds, focus } = parseMaxRounds(rawArgs)

  // Reset if the user started a new /keepgoing session with different args,
  // or if this is the first call.
  if (sessionRound === 0 || (focus && focus !== sessionFocus)) {
    resetSession(focus)
  }

  // ── Detect stop signal from the last model response ──────────────────────
  let stopReason: string | null = null
  context.setMessages(prev => {
    if (prev.length === 0) return prev
    // Scan backwards for the last assistant message
    for (let i = prev.length - 1; i >= 0; i--) {
      const msg = prev[i]!
      if (msg.role !== 'assistant') continue
      const blocks = Array.isArray(msg.content) ? msg.content : []
      const text = (blocks as Array<{ type: string; text?: string }>)
        .filter(b => b.type === 'text')
        .map(b => b.text ?? '')
        .join('\n')
      stopReason = detectStopSignal(text)
      break
    }
    return prev
  })

  if (stopReason !== null) {
    const finalRound = sessionRound
    resetSession('')
    return (
      <KeepGoingDone
        round={finalRound}
        reason={stopReason}
        onReady={() => onDone(undefined)}
      />
    )
  }

  // ── Increment round and check cap ────────────────────────────────────────
  const round = incrementRound()

  if (isFinite(maxRounds) && round > maxRounds) {
    const finalRound = sessionRound
    resetSession('')
    return (
      <KeepGoingCapReached
        round={finalRound}
        maxRounds={maxRounds}
        focus={focus}
        onReady={() => onDone(undefined)}
      />
    )
  }

  // ── Continue: prime model and re-queue ────────────────────────────────────
  const prompt = buildContinuationPrompt(round, maxRounds, focus)

  // Reconstruct the next-input command preserving any flags the user set
  const nextArgs: string[] = []
  if (!isFinite(maxRounds)) nextArgs.push('unlimited')
  else if (maxRounds !== DEFAULT_MAX_ROUNDS) nextArgs.push(String(maxRounds))
  if (focus) nextArgs.push(focus)
  const nextCmd = `/keepgoing${nextArgs.length ? ' ' + nextArgs.join(' ') : ''}`

  const handleReady = () => {
    onDone(undefined, {
      display: 'system',
      shouldQuery: true,
      metaMessages: [prompt],
      nextInput: nextCmd,
      submitNextInput: true,
    })
  }

  return (
    <KeepGoingBanner
      round={round}
      maxRounds={maxRounds}
      focus={focus}
      onReady={handleReady}
    />
  )
}
