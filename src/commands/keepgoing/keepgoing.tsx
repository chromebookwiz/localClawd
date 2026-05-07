/**
 * /keepgoing — ultimate persistent autonomous mode.
 *
 * Runs fully autonomously with all tool permissions bypassed.
 * A warning is shown on entry. Permissions are restored when the loop ends.
 *
 * Works standalone or combined with /thinkharder:
 *   /thinkharder → /keepgoing   Each round uses the full 5-phase verification pipeline.
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
import type { PermissionMode } from '../../types/permissions.js'
import { NO_CONTENT_MESSAGE } from '../../constants/messages.js'
import { isThinkHarderMode, THINKHARDER_ROUND_PROMPT } from '../thinkharder/thinkharder.js'
import {
  getPendingTelegramMessage,
  isTelegramActive,
  sendTelegramMessage,
} from '../../services/telegram/telegramBot.js'
import {
  getPendingSlackMessage,
  isSlackActive,
  sendSlackMessage,
} from '../../services/slack/slackBot.js'
import {
  getPendingDiscordMessage,
  isDiscordActive,
  sendDiscordMessage,
} from '../../services/discord/discordBot.js'
import {
  getPendingSignalMessage,
  isSignalActive,
  sendSignalMessage,
} from '../../services/signal/signalBot.js'
import { globalStopSignal } from '../../services/telegram/telegramSignals.js'
import { enqueue } from '../../utils/messageQueueManager.js'

// ─── Module-level loop state ─────────────────────────────────────────────────

let sessionRound = 0
let sessionFocus = ''
let sessionOriginalMode: PermissionMode = 'default'

function resetSession(focus: string, originalMode: PermissionMode): void {
  sessionRound = 0
  sessionFocus = focus
  sessionOriginalMode = originalMode
}

function incrementRound(): number {
  sessionRound += 1
  return sessionRound
}

// ─── Configuration ────────────────────────────────────────────────────────────

// keepgoing never stops due to a round count — only user stop signals, Ctrl+C,
// or model-emitted TASK COMPLETE / NEEDS INPUT / FINISHED end the loop.
function parseFocus(args: string): string {
  return args.trim()
}

// ─── Stop signal detection ────────────────────────────────────────────────────

const STOP_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /TASK[_ ]COMPLETE:/i,  label: 'task complete' },
  { pattern: /NEEDS[_ ]INPUT:/i,    label: 'paused — needs input' },
  { pattern: /\bFINISHED\b/i,       label: 'finished' },
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
  focus: string,
  telegramMsg: string | null,
  contextCompacted: boolean,
): string {
  const roundInfo = `Round ${round}`

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

  const compactedSection = contextCompacted
    ? `\n⚠ CONTEXT NOTE: The conversation was automatically compacted to free up context. Re-orient by reading key files, then continue the task.\n`
    : ''

  const continueInstruction = contextCompacted
    ? `The conversation was compacted. Re-read any files you were working on and continue.`
    : `Pick up exactly where you left off. Do not re-explain what was already done.\nProceed directly with the next action.`

  return `\
[KEEP GOING — AUTONOMOUS OPERATION — ${roundInfo}${modeTag}]
${focusLine}${compactedSection}${telegramSection}${thinkHarderSection}
You are in full autonomous mode with all permissions bypassed. Work continuously until all tasks are done.

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
1. ALL PERMISSIONS ARE BYPASSED — proceed with every tool use without asking
2. After completing a major milestone, state: "Completed: <what was done>"
3. After significant changes, run tests/builds to verify correctness
4. Use git commits after each logical unit of work
5. If you encounter a blocker you cannot resolve autonomously, emit:
     NEEDS INPUT: <specific question>
   Then stop and wait — do NOT guess or assume critical details
6. When ALL work is truly complete, emit:
     TASK COMPLETE: <one-sentence summary of everything accomplished>

━━━ CONTINUE NOW ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${continueInstruction}`
}

// ─── UI Components ────────────────────────────────────────────────────────────

function KeepGoingBanner({
  round,
  focus,
  thinkHarder,
  telegram,
  showBypassWarning,
  onReady,
}: {
  round: number
  focus: string
  thinkHarder: boolean
  telegram: boolean
  showBypassWarning: boolean
  onReady: () => void
}): React.ReactNode {
  React.useEffect(() => {
    const id = setTimeout(onReady, 0)
    return () => clearTimeout(id)
  }, [onReady])

  const badges: string[] = []
  if (thinkHarder) badges.push('🧠 ThinkHarder')
  if (telegram) badges.push('📱 Telegram')
  const badgeStr = badges.length > 0 ? `  ${badges.join(' · ')}` : ''

  return (
    <Box flexDirection="column" marginTop={1}>
      {showBypassWarning && (
        <Box flexDirection="column" marginBottom={1} borderStyle="round" borderColor="yellow" paddingX={1}>
          <Text bold color="yellow">{'⚠  Keep Going — Autonomous Mode'}</Text>
          <Text color="yellow">{'   All tool permissions are bypassed for this session.'}</Text>
          <Text dimColor>{'   The agent will execute Bash, file writes, and all other tools'}</Text>
          <Text dimColor>{'   without asking. Press Ctrl+C at any time to interrupt.'}</Text>
        </Box>
      )}
      <Text bold color="cyan">
        {`◆ Keep Going  [round ${round}]${badgeStr}`}
      </Text>
      {focus ? (
        <Text dimColor color="cyan">{`  ↳ Focus: ${focus}`}</Text>
      ) : (
        <Text dimColor>{'  ↳ All permissions bypassed · Ctrl+C to interrupt'}</Text>
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
      <Text dimColor>{'  Permissions restored to previous mode.'}</Text>
    </Box>
  )
}

// ─── Command entry point ──────────────────────────────────────────────────────

export const call: LocalJSXCommandCall = async (onDone, context, args) => {
  const rawArgs = args?.trim() ?? ''
  const { extractChain } =
    await import('../../utils/commandChaining.js')
  const { ownArgs: chainedArgs } = extractChain(rawArgs)
  const focus = parseFocus(chainedArgs)

  if (sessionRound === 0 && !focus) {
    onDone('What should I keep going on?', {
      display: 'system',
      nextInput: '/keepgoing ',
    })
    return null
  }

  const isNewSession = sessionRound === 0 || (focus && focus !== sessionFocus)
  if (isNewSession) {
    const currentMode = context.getAppState().toolPermissionContext.mode
    resetSession(focus, currentMode)
  }

  // ── Activate bypass permissions mode for this session ───────────────────
  context.setAppState(prev => ({
    ...prev,
    toolPermissionContext: {
      ...prev.toolPermissionContext,
      mode: 'bypassPermissions' as PermissionMode,
    },
  }))

  // ── Detect stop signal from the last model response ──────────────────────
  let stopReason: string | null = null
  let lastText = ''
  context.setMessages(prev => {
    lastText = extractLastAssistantText(
      prev as Array<{ role: string; content: unknown }>,
    )
    // (no content) means the model had nothing to say (tool-call-only turn or
    // context overflow). Never treat it as a stop signal — just continue.
    if (lastText !== NO_CONTENT_MESSAGE && lastText.trim() !== '') {
      stopReason = detectStopSignal(lastText)
    }
    return prev
  })
  // Detect whether this turn was context-compacted (empty/no-content response)
  const contextCompacted = lastText === NO_CONTENT_MESSAGE || lastText.trim() === ''

  // ── Send last response to active chat bridge (fire-and-forget) ───────────
  if (lastText.trim()) {
    const preview = lastText.slice(0, 1200)
    const suffix = lastText.length > 1200 ? '\n…(truncated)' : ''
    const header = `🤖 *Round ${sessionRound}*\n${preview}${suffix}`
    if (isTelegramActive()) void sendTelegramMessage(header)
    if (isSlackActive()) void sendSlackMessage(header)
    if (isDiscordActive()) void sendDiscordMessage(header)
    if (isSignalActive()) void sendSignalMessage(header)
  }

  // Check global stop signal (from Telegram/Slack /stop)
  if (globalStopSignal.get()) {
    globalStopSignal.reset()
    stopReason = 'stopped via /stop'
  }

  if (stopReason !== null) {
    const finalRound = sessionRound
    const savedMode = sessionOriginalMode
    resetSession('', 'default')
    // Restore original permission mode
    context.setAppState(prev => ({
      ...prev,
      toolPermissionContext: { ...prev.toolPermissionContext, mode: savedMode },
    }))
    const stopMsg = `✅ *keepgoing stopped*\nRound ${finalRound} · ${stopReason}`
    if (isTelegramActive()) void sendTelegramMessage(stopMsg)
    if (isSlackActive()) void sendSlackMessage(stopMsg)
    if (isDiscordActive()) void sendDiscordMessage(stopMsg)
    if (isSignalActive()) void sendSignalMessage(stopMsg)
    return (
      <KeepGoingDone
        round={finalRound}
        reason={stopReason}
        onReady={() => onDone(undefined)}
      />
    )
  }

  // ── Increment round ───────────────────────────────────────────────────────
  const round = incrementRound()
  const showBypassWarning = round === 1

  // ── Check for incoming message from any chat bridge to inject ────────────
  const externalMsg =
    getPendingTelegramMessage() ??
    getPendingSlackMessage() ??
    getPendingDiscordMessage() ??
    getPendingSignalMessage()

  // ── Build prompt + re-queue ───────────────────────────────────────────────
  const prompt = buildContinuationPrompt(round, focus, externalMsg, contextCompacted)
  const nextCmd = focus ? `/keepgoing ${focus}` : '/keepgoing'

  const metaMessages = [prompt]

  const handleReady = () => {
    enqueue({ value: nextCmd, mode: 'prompt', isMeta: true })
    onDone(undefined, {
      display: 'system',
      shouldQuery: true,
      metaMessages,
    })
  }

  return (
    <KeepGoingBanner
      round={round}
      focus={focus}
      thinkHarder={isThinkHarderMode}
      telegram={isTelegramActive()}
      showBypassWarning={showBypassWarning}
      onReady={handleReady}
    />
  )
}
