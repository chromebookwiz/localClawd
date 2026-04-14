/**
 * /keepgoing — ultimate persistent autonomous mode.
 *
 * Works standalone or combined with /thinkharder:
 *   /thinkharder → /keepgoing   Each round uses the full 4-layer cognition
 *                               loop + 5-phase pipeline. The model primes
 *                               memory, verifies invariants, and writes only
 *                               after formal verification on every iteration.
 *
 * Telegram bridge: if TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID are set, the
 * agent sends a status update after each round and any messages you send
 * from Telegram are injected as the next round's focus.
 *
 * Stop signals (any in the last assistant message ends the loop):
 *   TASK COMPLETE:   TASK_COMPLETE:   NEEDS INPUT:   NEEDS_INPUT:
 *   FINISHED         ALL DONE         WORK COMPLETE:
 *
 * Round cap: default 50. Override: /keepgoing 100  or  /keepgoing unlimited
 */

import * as React from 'react'
import { Box, Text } from '../../ink.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import { isThinkHarderMode, THINKHARDER_ROUND_PROMPT } from '../thinkharder/thinkharder.js'
import {
  getPendingTelegramMessage,
  isTelegramActive,
  sendTelegramMessage,
} from '../../services/telegram/telegramBot.js'
import { globalStopSignal } from '../../services/telegram/telegramSignals.js'

// ─── Module-level loop state ─────────────────────────────────────────────────

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

function extractLastAssistantText(
  messages: Array<{ role: string; content: unknown }>,
): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]!
    if (msg.role !== 'assistant') continue
    const blocks = Array.isArray(msg.content) ? msg.content : []
    return (blocks as Array<{ type: string; text?: string }>)
      .filter(b => b.type === 'text')
      .map(b => b.text ?? '')
      .join('\n')
  }
  return ''
}

// ─── Continuation prompt ──────────────────────────────────────────────────────

function buildContinuationPrompt(
  round: number,
  maxRounds: number,
  focus: string,
  telegramMsg: string | null,
): string {
  const roundInfo = isFinite(maxRounds)
    ? `Round ${round} of ${maxRounds}`
    : `Round ${round} (unlimited)`

  const modeTag = isThinkHarderMode
    ? ' · 🧠 THINK HARDER'
    : ''

  const focusLine = focus
    ? `\nCurrent focus: ${focus}\n`
    : ''

  const telegramSection = telegramMsg
    ? `\n━━━ 📱 TELEGRAM MESSAGE FROM USER ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n${telegramMsg}\n━━━ (respond to this, then continue autonomous work) ━━━━━━━━━━━━━━\n`
    : ''

  const thinkHarderSection = isThinkHarderMode
    ? `\n${THINKHARDER_ROUND_PROMPT}\n`
    : ''

  return `\
[KEEP GOING — AUTONOMOUS OPERATION — ${roundInfo}${modeTag}]
${focusLine}${telegramSection}${thinkHarderSection}
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
  thinkHarder,
  telegram,
  onReady,
}: {
  round: number
  maxRounds: number
  focus: string
  thinkHarder: boolean
  telegram: boolean
  onReady: () => void
}): React.ReactNode {
  React.useEffect(() => {
    const id = setTimeout(onReady, 0)
    return () => clearTimeout(id)
  }, [onReady])

  const roundDisplay = isFinite(maxRounds)
    ? `${round}/${maxRounds}`
    : `${round}/∞`

  const badges: string[] = []
  if (thinkHarder) badges.push('🧠 ThinkHarder')
  if (telegram) badges.push('📱 Telegram')
  const badgeStr = badges.length > 0 ? `  ${badges.join(' · ')}` : ''

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color="cyan">
        {`◆ Keep Going  [round ${roundDisplay}]${badgeStr}`}
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
  const { extractChain, validateCommandChain, parseCommandChain, chainWarning } =
    await import('../../utils/commandChaining.js')
  const { ownArgs: chainedArgs, nextCmd: _nextCmdFromChain } = extractChain(rawArgs)
  // keepgoing is a loop — it absorbs all chain commands as part of the loop context
  // and warns if an incompatible command follows it
  const { maxRounds, focus } = parseMaxRounds(chainedArgs)

  if (sessionRound === 0 || (focus && focus !== sessionFocus)) {
    resetSession(focus)
  }

  // ── Detect stop signal from the last model response ──────────────────────
  let stopReason: string | null = null
  let lastText = ''
  context.setMessages(prev => {
    lastText = extractLastAssistantText(
      prev as Array<{ role: string; content: unknown }>,
    )
    stopReason = detectStopSignal(lastText)
    return prev
  })

  // ── Send last response to Telegram (fire-and-forget) ─────────────────────
  if (isTelegramActive() && lastText.trim()) {
    const preview = lastText.slice(0, 1200)
    const suffix = lastText.length > 1200 ? '\n…(truncated)' : ''
    void sendTelegramMessage(`🤖 *Round ${sessionRound}*\n${preview}${suffix}`)
  }

  // Check global stop signal (from Telegram /stop)
  if (globalStopSignal.get()) {
    globalStopSignal.reset()
    stopReason = 'stopped via Telegram /stop'
  }

  if (stopReason !== null) {
    const finalRound = sessionRound
    resetSession('')
    if (isTelegramActive()) {
      void sendTelegramMessage(`✅ *keepgoing stopped*\nRound ${finalRound} · ${stopReason}`)
    }
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
    if (isTelegramActive()) {
      void sendTelegramMessage(`⏸ *keepgoing paused*\nRound cap ${finalRound}/${maxRounds} reached.`)
    }
    return (
      <KeepGoingCapReached
        round={finalRound}
        maxRounds={maxRounds}
        focus={focus}
        onReady={() => onDone(undefined)}
      />
    )
  }

  // ── Check for incoming Telegram message to inject ─────────────────────────
  const telegramMsg = getPendingTelegramMessage()

  // ── Build prompt + re-queue ───────────────────────────────────────────────
  const prompt = buildContinuationPrompt(round, maxRounds, focus, telegramMsg)

  const nextArgs: string[] = []
  if (!isFinite(maxRounds)) nextArgs.push('unlimited')
  else if (maxRounds !== DEFAULT_MAX_ROUNDS) nextArgs.push(String(maxRounds))
  if (focus) nextArgs.push(focus)
  const nextCmd = `/keepgoing${nextArgs.length ? ' ' + nextArgs.join(' ') : ''}`

  const metaMessages = [prompt]

  const handleReady = () => {
    onDone(undefined, {
      display: 'system',
      shouldQuery: true,
      metaMessages,
      nextInput: nextCmd,
      submitNextInput: true,
    })
  }

  return (
    <KeepGoingBanner
      round={round}
      maxRounds={maxRounds}
      focus={focus}
      thinkHarder={isThinkHarderMode}
      telegram={isTelegramActive()}
      onReady={handleReady}
    />
  )
}
