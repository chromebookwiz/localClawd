/**
 * /heartbeat <minutes> — Recurring autonomous mode.
 *
 * Unlike /keepgoing, heartbeat NEVER stops on its own — only the human
 * can stop it (Ctrl+C). The agent wakes every N minutes, does whatever
 * it sees fit, and goes back to sleep. If a task is given, the agent
 * works on it; otherwise it reflects, explores, and acts freely.
 *
 * /thinkharder is automatically activated when heartbeat starts.
 *
 * Telegram integration: status pings are sent after each beat.
 */

import * as React from 'react'
import { Box, Text } from '../../ink.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import {
  isThinkHarderMode,
  setThinkHarderMode,
  THINKHARDER_ROUND_PROMPT,
} from '../thinkharder/thinkharder.js'
import {
  getPendingTelegramMessage,
  isTelegramActive,
  sendTelegramMessage,
} from '../../services/telegram/telegramBot.js'

// ─── Module-level heartbeat state ────────────────────────────────────────────

let heartbeatInterval = 5 // minutes
let heartbeatBeat = 0
let heartbeatTask = ''
let heartbeatActive = false

export function isHeartbeatActive(): boolean {
  return heartbeatActive
}

// ─── Prompt builder ───────────────────────────────────────────────────────────

const HEARTBEAT_FREE_ROAM = `\
You have no assigned task. Act as a curious, autonomous agent:
  • Review recent code changes and assess quality
  • Check git log for loose ends or TODO comments
  • Look for quick wins: small bugs, missing tests, stale docs
  • Write notes to memory files about important patterns you notice
  • Explore anything that interests you and might be useful
  • Send a Telegram update about what you found / did`

function buildHeartbeatPrompt(beat: number, task: string, telegramMsg: string | null): string {
  const taskSection = task
    ? `\nAssigned task: ${task}\n`
    : `\n${HEARTBEAT_FREE_ROAM}\n`

  const telegramSection = telegramMsg
    ? `\n━━━ 📱 TELEGRAM FROM HUMAN ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n${telegramMsg}\n━━━ (handle this, then continue your work) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`
    : ''

  return `\
[HEARTBEAT — BEAT ${beat} — localClawd autonomous pulse]
${taskSection}${telegramSection}
${THINKHARDER_ROUND_PROMPT}

━━━ HEARTBEAT RULES ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
You are localClawd running in heartbeat mode. You wake on a timer.
• The human cannot stop you — only Ctrl+C ends heartbeat mode
• Do your best work, then sleep until the next beat
• You do NOT need to emit TASK COMPLETE — just finish and wait
• Use all tools freely: read files, run code, search, write
• After acting, send a brief Telegram update if the bridge is active
• End your response with: HEARTBEAT_DONE (so the scheduler knows you finished)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
}

// ─── UI Components ────────────────────────────────────────────────────────────

function HeartbeatBanner({
  beat,
  intervalMins,
  task,
  onReady,
}: {
  beat: number
  intervalMins: number
  task: string
  onReady: () => void
}): React.ReactNode {
  React.useEffect(() => {
    const id = setTimeout(onReady, 0)
    return () => clearTimeout(id)
  }, [onReady])

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color="magenta">
        {`♥ Heartbeat  [beat ${beat}]  every ${intervalMins}m  🧠 ThinkHarder${isTelegramActive() ? '  📱 Telegram' : ''}`}
      </Text>
      {task ? (
        <Text dimColor color="magenta">{`  ↳ Task: ${task}`}</Text>
      ) : (
        <Text dimColor>{`  ↳ Free-roaming — agent acts autonomously. Ctrl+C to stop.`}</Text>
      )}
    </Box>
  )
}

function HeartbeatSleeping({
  beat,
  intervalMins,
  onReady,
}: {
  beat: number
  intervalMins: number
  onReady: () => void
}): React.ReactNode {
  React.useEffect(() => {
    const id = setTimeout(onReady, intervalMins * 60 * 1000)
    return () => clearTimeout(id)
  }, [onReady, intervalMins])

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text dimColor color="magenta">
        {`♥ Heartbeat  [sleeping ${intervalMins}m before beat ${beat + 1}]  Ctrl+C to stop`}
      </Text>
    </Box>
  )
}

// ─── Command entry point ──────────────────────────────────────────────────────

export const call: LocalJSXCommandCall = async (onDone, context, args) => {
  const rawArgs = args?.trim() ?? ''

  // Parse args: first number token = interval, rest = task
  const parts = rawArgs.split(/\s+/)
  const firstNum = parts[0] && /^\d+(\.\d+)?$/.test(parts[0]) ? parseFloat(parts[0]) : null

  if (firstNum !== null) {
    heartbeatInterval = Math.max(0.5, firstNum)
    heartbeatTask = parts.slice(1).join(' ')
    heartbeatBeat = 0
    heartbeatActive = true
  } else if (rawArgs) {
    heartbeatTask = rawArgs
    heartbeatBeat = 0
    heartbeatActive = true
  }

  // Auto-enable thinkharder
  if (!isThinkHarderMode) {
    setThinkHarderMode(true)
  }

  // Detect HEARTBEAT_DONE in last model response
  let lastText = ''
  context.setMessages(prev => {
    const msgs = prev as Array<{ role: string; content: unknown }>
    for (let i = msgs.length - 1; i >= 0; i--) {
      const msg = msgs[i]!
      if (msg.role !== 'assistant') continue
      const blocks = Array.isArray(msg.content) ? msg.content : []
      lastText = (blocks as Array<{ type: string; text?: string }>)
        .filter(b => b.type === 'text')
        .map(b => b.text ?? '')
        .join('\n')
      break
    }
    return prev
  })

  const justFinishedBeat = lastText.includes('HEARTBEAT_DONE')

  if (justFinishedBeat) {
    // Send Telegram update
    if (isTelegramActive() && lastText.trim()) {
      const preview = lastText.replace(/HEARTBEAT_DONE/g, '').trim().slice(0, 1000)
      void sendTelegramMessage(`♥ *Beat ${heartbeatBeat} done*\n${preview}`)
    }

    // Sleep phase — show sleeping banner, then re-trigger the command
    const sleepBeat = heartbeatBeat
    const sleepInterval = heartbeatInterval
    const handleSleepDone = () => {
      onDone(undefined, {
        display: 'system',
        shouldQuery: false,
        nextInput: `/heartbeat`,
        submitNextInput: true,
      })
    }

    return (
      <HeartbeatSleeping
        beat={sleepBeat}
        intervalMins={sleepInterval}
        onReady={handleSleepDone}
      />
    )
  }

  // Active beat
  heartbeatBeat += 1
  const currentBeat = heartbeatBeat
  const currentInterval = heartbeatInterval
  const currentTask = heartbeatTask

  const telegramMsg = getPendingTelegramMessage()
  if (telegramMsg) {
    // If telegram has a task, update our task
    heartbeatTask = telegramMsg.trim()
  }

  const prompt = buildHeartbeatPrompt(currentBeat, currentTask, telegramMsg)

  if (currentBeat === 1 && isTelegramActive()) {
    void sendTelegramMessage(
      `♥ *localClawd heartbeat started*\nInterval: ${currentInterval}m\n${currentTask ? `Task: ${currentTask}` : 'Free-roaming mode'}`,
    )
  }

  const handleReady = () => {
    onDone(undefined, {
      display: 'system',
      shouldQuery: true,
      metaMessages: [prompt],
      nextInput: `/heartbeat`,
      submitNextInput: true,
    })
  }

  return (
    <HeartbeatBanner
      beat={currentBeat}
      intervalMins={currentInterval}
      task={currentTask}
      onReady={handleReady}
    />
  )
}
