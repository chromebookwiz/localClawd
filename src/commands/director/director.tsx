/**
 * /director — Supervised autonomous operation with persistent memory.
 *
 * The director manages localclawd instances with a review loop:
 *   1. Receives a task (from CLI or Telegram)
 *   2. Loads project context from persistent memory
 *   3. Submits a context-rich prompt to the model
 *   4. Reviews each round's output, re-prompts if incomplete
 *   5. Records outcomes and updates memory when done
 *
 * Usage:
 *   /director <task>   — start a new task in the current directory
 *   /director          — show status (registered projects, recent tasks)
 *   /dir <task>        — alias
 *
 * Combined with Telegram: messages route through the director.
 * The director supports /stop (via Telegram) to halt the current task.
 */

import * as React from 'react'
import { Box, Text } from '../../ink.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import {
  startDirectorTask,
  reviewAndContinue,
  getDirectorStatus,
  getDirectorRound,
  getDirectorTask,
  isDirectorActive,
  resetDirector,
  getChangeSummary,
  sendDirectorNotification,
  getNotifyMedium,
  type NotifyMedium,
} from '../../services/director/directorEngine.js'
import {
  getPendingTelegramMessage,
  isTelegramActive,
  startTypingIndicator,
  stopTypingIndicator,
} from '../../services/telegram/telegramBot.js'
import { globalStopSignal } from '../../services/telegram/telegramSignals.js'
import { getOriginalCwd } from '../../bootstrap/state.js'

// ─── UI Components ───────────────────────────────────────────────────────────

function DirectorBanner({
  round,
  maxRounds,
  task,
  telegram,
  onReady,
}: {
  round: number
  maxRounds: number
  task: string
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
  if (telegram) badges.push('Telegram')
  const badgeStr = badges.length > 0 ? `  ${badges.join(' · ')}` : ''

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color="#818cf8">
        {`◆ Director  [round ${roundDisplay}]${badgeStr}`}
      </Text>
      <Text dimColor color="#818cf8">{`  ↳ Task: ${task.slice(0, 80)}${task.length > 80 ? '...' : ''}`}</Text>
    </Box>
  )
}

function DirectorDone({
  round,
  reason,
  changeSummary,
  onReady,
}: {
  round: number
  reason: string
  changeSummary: string
  onReady: () => void
}): React.ReactNode {
  React.useEffect(() => {
    const id = setTimeout(onReady, 0)
    return () => clearTimeout(id)
  }, [onReady])

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color="green">
        {`◆ Director — completed after ${round} rounds`}
      </Text>
      <Text dimColor>{`  Reason: ${reason}`}</Text>
      {changeSummary ? (
        <Box flexDirection="column" marginTop={1} marginLeft={2}>
          <Text bold>{'Changes:'}</Text>
          {changeSummary.split('\n').map((line, i) => (
            <Text key={i} dimColor>{`  ${line}`}</Text>
          ))}
        </Box>
      ) : null}
    </Box>
  )
}

function DirectorStatus({
  statusText,
  onReady,
}: {
  statusText: string
  onReady: () => void
}): React.ReactNode {
  React.useEffect(() => {
    const id = setTimeout(onReady, 0)
    return () => clearTimeout(id)
  }, [onReady])

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color="#818cf8">{'◆ Director Status'}</Text>
      <Box flexDirection="column" marginLeft={2}>
        {statusText.split('\n').map((line, i) => (
          <Text key={i} dimColor={line.startsWith('  ')}>{line}</Text>
        ))}
      </Box>
    </Box>
  )
}

// ─── Extract last assistant text ─────────────────────────────────────────────

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

// ─── Command entry point ─────────────────────────────────────────────────────

const DEFAULT_MAX_ROUNDS = 20

export const call: LocalJSXCommandCall = async (onDone, context, args) => {
  const task = args?.trim() ?? ''

  // ── /director with no args — show status ──────────────────────────────
  if (!task && !isDirectorActive()) {
    const statusText = await getDirectorStatus()
    return <DirectorStatus statusText={statusText} onReady={() => onDone(undefined)} />
  }

  // ── Starting a new task ───────────────────────────────────────────────
  if (task && !isDirectorActive()) {
    const cwd = getOriginalCwd()
    // Determine notification medium: Telegram if active, else desktop
    const medium: NotifyMedium = isTelegramActive() ? 'telegram' : 'desktop'
    const { prompt } = await startDirectorTask(task, cwd, DEFAULT_MAX_ROUNDS, medium)

    void sendDirectorNotification('Director', `Starting task:\n${task.slice(0, 200)}`)

    // Start typing indicator so Telegram shows "typing..." while model works
    if (isTelegramActive()) startTypingIndicator()

    return (
      <DirectorBanner
        round={1}
        maxRounds={DEFAULT_MAX_ROUNDS}
        task={task}
        telegram={isTelegramActive()}
        onReady={() =>
          onDone(undefined, {
            display: 'system',
            shouldQuery: true,
            metaMessages: [prompt],
            nextInput: '/director',
            submitNextInput: true,
          })
        }
      />
    )
  }

  // ── Continuation round (director is active) ───────────────────────────

  // Model just finished generating — stop typing indicator
  if (isTelegramActive()) stopTypingIndicator()

  // Check global stop signal
  if (globalStopSignal.get()) {
    globalStopSignal.reset()
    const round = getDirectorRound()
    const changeSummary = await getChangeSummary()
    const summaryMsg = changeSummary ? `\n\nChanges:\n${changeSummary}` : ''
    void sendDirectorNotification('Director — Stopped', `Stopped via /stop after ${round} rounds${summaryMsg}`)
    resetDirector()
    return (
      <DirectorDone
        round={round}
        reason="stopped via /stop"
        changeSummary={changeSummary}
        onReady={() => onDone(undefined)}
      />
    )
  }

  // Get last assistant response for review
  let lastText = ''
  context.setMessages(prev => {
    lastText = extractLastAssistantText(
      prev as Array<{ role: string; content: unknown }>,
    )
    return prev
  })

  // Send round progress update via correct medium
  if (lastText.trim()) {
    const round = getDirectorRound()
    const preview = lastText.slice(0, 1200)
    const suffix = lastText.length > 1200 ? '\n...(truncated)' : ''
    if (getNotifyMedium() === 'telegram' && isTelegramActive()) {
      // Full round output to Telegram (user wants to see progress)
      const { sendTelegramMessage } = await import('../../services/telegram/telegramBot.js')
      void sendTelegramMessage(`Director round ${round}:\n${preview}${suffix}`)
    }
  }

  // Check for incoming Telegram message
  const telegramMsg = getPendingTelegramMessage()

  // Review and decide — director re-prompts every turn until task is done
  const result = await reviewAndContinue(lastText, telegramMsg)

  if (result.done) {
    if (isTelegramActive()) stopTypingIndicator()
    const round = getDirectorRound()
    const reason = result.reason ?? 'completed'
    const changeSummary = await getChangeSummary()
    const summaryMsg = changeSummary ? `\n\nChanges:\n${changeSummary}` : ''
    void sendDirectorNotification('Director — Complete', `Finished: ${reason} (${round} rounds)${summaryMsg}`)
    resetDirector()
    return (
      <DirectorDone
        round={round}
        reason={reason}
        changeSummary={changeSummary}
        onReady={() => onDone(undefined)}
      />
    )
  }

  // Continue with review prompt — this re-prompt keeps the loop going
  const round = getDirectorRound()
  const currentTask = getDirectorTask()

  // Resume typing indicator for next model turn
  if (isTelegramActive()) startTypingIndicator()

  return (
    <DirectorBanner
      round={round}
      maxRounds={DEFAULT_MAX_ROUNDS}
      task={currentTask}
      telegram={isTelegramActive()}
      onReady={() =>
        onDone(undefined, {
          display: 'system',
          shouldQuery: true,
          metaMessages: [result.prompt!],
          nextInput: '/director',
          submitNextInput: true,
        })
      }
    />
  )
}
