/**
 * /keepgoing — persistent autonomous mode.
 *
 * Runs indefinitely with all tool permissions bypassed.
 * Only the USER can stop it: Ctrl+C, or /stop via Telegram/Slack.
 *
 * Self-directed prompts: after round 1 the model writes its own
 * NEXT: <directive> at the end of each response. That directive
 * becomes the sole prompt for the next round, keeping things fresh
 * and contextually relevant rather than repeating boilerplate.
 *
 * Context: auto-compact fires transparently when the window fills.
 * If the model returns (no content) the loop detects it and sends
 * a re-orient prompt so the model can continue from the summary.
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
// The model writes NEXT: <text> at the end of each response.
// That text becomes the directive for the following round.
let sessionSelfDirective = ''

function resetSession(focus: string, originalMode: PermissionMode): void {
  sessionRound = 0
  sessionFocus = focus
  sessionOriginalMode = originalMode
  sessionSelfDirective = ''
}

function incrementRound(): number {
  sessionRound += 1
  return sessionRound
}

// ─── Self-directive extraction ───────────────────────────────────────────────

// Pull the NEXT: paragraph the model writes at the end of each turn.
// Accept NEXT: at the start of a line, possibly preceded by a separator.
function extractSelfDirective(text: string): string {
  // Match "NEXT:" (with optional markdown like "**NEXT:**") followed by content
  const match = text.match(/\*{0,2}NEXT:\*{0,2}\s*(.+?)(?=\n\n|\n(?:[A-Z*─━]|\d+\.)|\s*$)/s)
  if (!match) return ''
  // Collapse whitespace and cap length — this is a planning note, not a novel
  return match[1].replace(/\s+/g, ' ').trim().slice(0, 600)
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseFocus(args: string): string {
  return args.trim()
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

// ─── Prompt builders ─────────────────────────────────────────────────────────

// Sent on round 1 (or whenever we have no self-directive, e.g. after compact).
// Explains the setup once and asks the model to start writing NEXT: directives.
function buildOnboardingPrompt(
  round: number,
  focus: string,
  externalMsg: string | null,
  contextCompacted: boolean,
): string {
  const modeTag = isThinkHarderMode ? ' · 🧠 THINK HARDER' : ''
  const focusLine = focus ? `\nFocus: ${focus}\n` : ''
  const compactNote = contextCompacted
    ? `\n⚠ Context was compacted. Re-orient: read key files you were working on, then continue.\n`
    : ''
  const telegramSection = externalMsg
    ? `\n━━━ MESSAGE FROM USER ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n${externalMsg}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`
    : ''
  const thinkHarder = isThinkHarderMode ? `\n${THINKHARDER_ROUND_PROMPT}\n` : ''

  return `\
[KEEP GOING — Round ${round}${modeTag}]
${focusLine}${compactNote}${telegramSection}${thinkHarder}
You are in fully autonomous mode — all tool permissions bypassed.
This loop runs indefinitely. Only the user can stop it (Ctrl+C or /stop).
You are the only one deciding what to work on next.

━━━ TOOLS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Read, Write, Edit, MultiEdit · Bash · Glob, Grep · WebFetch, WebSearch
Agent (spawn subagents for parallel or complex sub-tasks)
TodoCreate, TodoUpdate

━━━ RULES ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
· Proceed with every action without asking for permission
· Commit after each logical unit of work
· Run builds/tests after significant changes
· If genuinely blocked: state the blocker clearly, spawn a subagent to research it, or try an alternative approach — do NOT stall

━━━ REQUIRED ENDING ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
At the END of every response, write exactly these two lines:

SUMMARY: <1-2 sentences of what you accomplished this round>
NEXT: <1–3 sentences describing your specific plan for the next round>

Both lines are required every round without exception.
NEXT: becomes your only prompt next round — be precise about files,
actions, and outcomes to verify.`
}

// Sent on rounds 2+ when the model has written a NEXT: directive.
// Lightweight — just shows the directive and asks the model to continue.
function buildSelfDirectedPrompt(
  round: number,
  directive: string,
  focus: string,
  externalMsg: string | null,
): string {
  const modeTag = isThinkHarderMode ? ' · 🧠 THINK HARDER' : ''
  const focusNote = focus ? `\nFocus: ${focus}` : ''
  const telegramSection = externalMsg
    ? `\n━━━ MESSAGE FROM USER ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n${externalMsg}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`
    : ''
  const thinkHarder = isThinkHarderMode ? `\n${THINKHARDER_ROUND_PROMPT}\n` : ''

  return `\
[KEEP GOING — Round ${round}${modeTag}]${focusNote}
${telegramSection}${thinkHarder}
DIRECTIVE:
${directive}

Proceed. End your response with:
SUMMARY: <what you accomplished this round>
NEXT: <your plan for the following round>`
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
          <Text dimColor>{'   The agent will run indefinitely. Ctrl+C or /stop to halt.'}</Text>
        </Box>
      )}
      <Text bold color="cyan">
        {`◆ Keep Going  [round ${round}]${badgeStr}`}
      </Text>
      {focus ? (
        <Text dimColor color="cyan">{`  ↳ ${focus}`}</Text>
      ) : (
        <Text dimColor>{'  ↳ self-directed · Ctrl+C or /stop to halt'}</Text>
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

  // ── Activate bypass permissions ──────────────────────────────────────────
  context.setAppState(prev => ({
    ...prev,
    toolPermissionContext: {
      ...prev.toolPermissionContext,
      mode: 'bypassPermissions' as PermissionMode,
    },
  }))

  // ── Extract last assistant response ──────────────────────────────────────
  let lastText = ''
  context.setMessages(prev => {
    lastText = extractLastAssistantText(
      prev as Array<{ role: string; content: unknown }>,
    )
    return prev
  })

  // Context compacted: model returned nothing (overflow or compaction event)
  const contextCompacted = lastText === NO_CONTENT_MESSAGE || lastText.trim() === ''

  // Update self-directive from the model's last response
  if (!contextCompacted) {
    const newDirective = extractSelfDirective(lastText)
    if (newDirective) sessionSelfDirective = newDirective
  } else {
    // After compaction the directive may be stale — clear it so we re-onboard
    sessionSelfDirective = ''
  }

  // ── Forward to chat bridges ──────────────────────────────────────────────
  if (lastText.trim() && lastText !== NO_CONTENT_MESSAGE) {
    const preview = lastText.slice(0, 1200)
    const suffix = lastText.length > 1200 ? '\n…(truncated)' : ''
    const header = `🤖 *Round ${sessionRound}*\n${preview}${suffix}`
    if (isTelegramActive()) void sendTelegramMessage(header)
    if (isSlackActive()) void sendSlackMessage(header)
    if (isDiscordActive()) void sendDiscordMessage(header)
    if (isSignalActive()) void sendSignalMessage(header)
  }

  // ── Only the user can stop the loop ──────────────────────────────────────
  if (globalStopSignal.get()) {
    globalStopSignal.reset()
    const finalRound = sessionRound
    const savedMode = sessionOriginalMode
    resetSession('', 'default')
    context.setAppState(prev => ({
      ...prev,
      toolPermissionContext: { ...prev.toolPermissionContext, mode: savedMode },
    }))
    const stopMsg = `✅ *keepgoing stopped*\nRound ${finalRound} · stopped via /stop`
    if (isTelegramActive()) void sendTelegramMessage(stopMsg)
    if (isSlackActive()) void sendSlackMessage(stopMsg)
    if (isDiscordActive()) void sendDiscordMessage(stopMsg)
    if (isSignalActive()) void sendSignalMessage(stopMsg)
    return (
      <KeepGoingDone
        round={finalRound}
        reason="stopped via /stop"
        onReady={() => onDone(undefined)}
      />
    )
  }

  // ── Increment round ───────────────────────────────────────────────────────
  const round = incrementRound()
  const showBypassWarning = round === 1

  // ── Check for incoming chat bridge message ────────────────────────────────
  const externalMsg =
    getPendingTelegramMessage() ??
    getPendingSlackMessage() ??
    getPendingDiscordMessage() ??
    getPendingSignalMessage()

  // ── Choose prompt ─────────────────────────────────────────────────────────
  // Round 1 (or after compaction / missing directive) → full onboarding.
  // Round 2+ with a model-written directive → lightweight self-directed prompt.
  const useOnboarding = round === 1 || contextCompacted || !sessionSelfDirective
  const prompt = useOnboarding
    ? buildOnboardingPrompt(round, focus, externalMsg, contextCompacted)
    : buildSelfDirectedPrompt(round, sessionSelfDirective, focus, externalMsg)

  const nextCmd = focus ? `/keepgoing ${focus}` : '/keepgoing'

  const handleReady = () => {
    enqueue({ value: nextCmd, mode: 'prompt', isMeta: true })
    onDone(undefined, {
      display: 'system',
      shouldQuery: true,
      metaMessages: [prompt],
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
