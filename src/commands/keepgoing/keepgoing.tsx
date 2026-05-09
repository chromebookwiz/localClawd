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
import {
  runForkedAgent,
  getLastCacheSafeParams,
} from '../../utils/forkedAgent.js'
import {
  createUserMessage,
  getLastAssistantMessage,
  extractTextContent,
} from '../../utils/messages.js'

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

// Pull the NEXT: line the model writes at the end of each turn.
// Searches bottom-up so the last NEXT: wins if the model writes multiple.
function extractSelfDirective(text: string): string {
  const lines = text.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!.trim()
    const m = line.match(/^\*{0,2}NEXT:\*{0,2}\s*(.+)/i)
    if (!m) continue
    let directive = m[1]!.trim()
    // Collect wrapped continuation lines (non-blank, not a new section header)
    for (let j = i + 1; j < lines.length && j < i + 5; j++) {
      const next = lines[j]!.trim()
      if (!next || /^(SUMMARY:|NEXT:|\*{0,2}[A-Z]{2})/i.test(next)) break
      directive += ' ' + next
    }
    return directive.replace(/\s+/g, ' ').trim().slice(0, 600)
  }
  return ''
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

// ─── Inter-turn synthesis agent ──────────────────────────────────────────────

// Runs a single-turn forked agent using the full conversation context to write
// the next round's directive. The agent sees everything the main model saw.
// Falls back to '' on any error so callers can use NEXT: extraction instead.
async function synthesizeNextDirective(focus: string): Promise<string> {
  try {
    const cacheSafeParams = getLastCacheSafeParams()
    if (!cacheSafeParams) return ''

    const focusLine = focus ? `\nThe overall session focus is: ${focus}` : ''
    const prompt = `You are a task director reviewing an autonomous coding session.${focusLine}

Based on the conversation above, write a precise 2-3 sentence directive for the NEXT round of work.
- Reference specific files, functions, or tests by name
- Build directly on what was just completed or unblocked
- Be concrete: name the exact next action, what to verify, and what "done" looks like

Write ONLY the directive. No preamble, no markdown, no tool calls. Start immediately with the action.`

    const result = await runForkedAgent({
      promptMessages: [createUserMessage({ content: prompt })],
      cacheSafeParams,
      canUseTool: async () => ({
        behavior: 'deny' as const,
        message: 'Synthesis agent is text-only',
        decisionReason: { type: 'other' as const, reason: 'synthesis' },
      }),
      querySource: 'keepgoing_synthesis',
      forkLabel: 'keepgoing_synthesis',
      maxTurns: 1,
      skipTranscript: true,
      skipCacheWrite: true,
    })

    const assistantMsg = getLastAssistantMessage(result.messages)
    if (!assistantMsg || assistantMsg.isApiErrorMessage) return ''
    return extractTextContent(assistantMsg.message.content, '\n').trim().slice(0, 600)
  } catch {
    return ''
  }
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

━━━ OPTIONAL ENDING ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
You may end your response with:

SUMMARY: <1-2 sentences of what you accomplished this round>
NEXT: <your plan for the following round (used as fallback if needed)>

These help with context continuity but are not required.`
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

Proceed.`
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

// Write crash info to ~/.claude/crash.log for diagnosis
function logKgCrash(error: unknown, context: string): void {
  const msg = error instanceof Error ? (error.stack ?? error.message) : String(error)
  try {
    const { appendFileSync, mkdirSync } = require('fs') as typeof import('fs')
    const { homedir } = require('os') as typeof import('os')
    const { join } = require('path') as typeof import('path')
    const dir = join(homedir(), '.claude')
    mkdirSync(dir, { recursive: true })
    appendFileSync(join(dir, 'crash.log'), `[${new Date().toISOString()}] keepgoing ${context}: ${msg}\n`)
  } catch { /* ignore */ }
}

// Safely fire a void send — catches both sync throws and promise rejections
function safeSend(fn: () => Promise<unknown>): void {
  try {
    fn().catch(e => logKgCrash(e, 'send'))
  } catch (e) {
    logKgCrash(e, 'send-sync')
  }
}

export const call: LocalJSXCommandCall = async (onDone, context, args) => {
  try {
    return await callInner(onDone, context, args)
  } catch (error) {
    logKgCrash(error, 'call')
    const msg = error instanceof Error ? error.message : String(error)
    // Re-enqueue so the loop can restart after showing the error
    try {
      enqueue({ value: '/keepgoing', mode: 'prompt', isMeta: true })
    } catch { /* ignore */ }
    onDone(`⚠ keepgoing error (restarting): ${msg}`, { display: 'system' })
    return null
  }
}

async function callInner(
  onDone: Parameters<LocalJSXCommandCall>[0],
  context: Parameters<LocalJSXCommandCall>[1],
  args: Parameters<LocalJSXCommandCall>[2],
): Promise<ReturnType<LocalJSXCommandCall>> {
  const rawArgs = args?.trim() ?? ''
  const { extractChain } =
    await import('../../utils/commandChaining.js')
  const { ownArgs: chainedArgs } = extractChain(rawArgs)
  const requestedFocus = parseFocus(chainedArgs)
  const focus = requestedFocus || sessionFocus

  if (sessionRound === 0 && !focus) {
    onDone('What should I keep going on?', {
      display: 'system',
      nextInput: '/keepgoing ',
    })
    return null
  }

  const isNewSession = sessionRound === 0 || (requestedFocus && requestedFocus !== sessionFocus)
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
  try {
    context.setMessages(prev => {
      lastText = extractLastAssistantText(
        prev as Array<{ role: string; content: unknown }>,
      )
      return prev
    })
  } catch (e) {
    logKgCrash(e, 'extractLastAssistantText')
  }

  // Context compacted: model returned nothing (overflow or compaction event)
  const contextCompacted = lastText === NO_CONTENT_MESSAGE || lastText.trim() === ''

  // Update self-directive using synthesis agent (primary) or NEXT: extraction (fallback).
  // Synthesis runs a single-turn forked agent against the full conversation to produce
  // a contextually accurate directive. Falls back gracefully on any error.
  if (!contextCompacted) {
    const extracted = extractSelfDirective(lastText)
    const synthesized = lastText.trim() && sessionRound >= 1
      ? await synthesizeNextDirective(focus)
      : ''
    if (synthesized) {
      sessionSelfDirective = synthesized
    } else if (extracted) {
      sessionSelfDirective = extracted
    } else if (sessionRound >= 1) {
      const preview = lastText.slice(0, 300).replace(/\n/g, ' ').trim()
      sessionSelfDirective = preview
        ? `Continue from where you left off: ${preview.slice(0, 200)}`
        : 'Continue with the next most important task.'
    }
  } else {
    // After compaction the directive may be stale — clear it so we re-onboard
    sessionSelfDirective = ''
  }

  // ── Forward to chat bridges ──────────────────────────────────────────────
  if (lastText.trim() && lastText !== NO_CONTENT_MESSAGE) {
    const preview = lastText.slice(0, 1200)
    const suffix = lastText.length > 1200 ? '\n…(truncated)' : ''
    const header = `🤖 *Round ${sessionRound}*\n${preview}${suffix}`
    if (isTelegramActive()) safeSend(() => sendTelegramMessage(header))
    if (isSlackActive()) safeSend(() => sendSlackMessage(header))
    if (isDiscordActive()) safeSend(() => sendDiscordMessage(header))
    if (isSignalActive()) safeSend(() => sendSignalMessage(header))
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
    if (isTelegramActive()) safeSend(() => sendTelegramMessage(stopMsg))
    if (isSlackActive()) safeSend(() => sendSlackMessage(stopMsg))
    if (isDiscordActive()) safeSend(() => sendDiscordMessage(stopMsg))
    if (isSignalActive()) safeSend(() => sendSignalMessage(stopMsg))
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

  const nextCmd = '/keepgoing'

  const handleReady = () => {
    try {
      // Enqueue BEFORE onDone so the command is in the queue while the model
      // runs. isMeta: true hides it from the input preview (prevents the text
      // from appearing as a "pasted prompt" in the UI). ESC still clears it
      // because useCancelRequest calls clearCommandQueue() on abort, which
      // removes all queued commands including isMeta ones.
      enqueue({ value: nextCmd, mode: 'prompt', isMeta: true })
      onDone(undefined, {
        display: 'system',
        shouldQuery: true,
        metaMessages: [prompt],
      })
    } catch (e) {
      logKgCrash(e, 'handleReady')
      try { onDone(`⚠ keepgoing recovered from internal error`, { display: 'system' }) } catch { /* ignore */ }
    }
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
