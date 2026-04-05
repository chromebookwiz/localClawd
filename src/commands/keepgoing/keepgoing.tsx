/**
 * /keepgoing — autonomous task continuation loop.
 *
 * Sends a structured continuation prompt to the model and instructs it to
 * work through all outstanding steps using available tools, stopping only when:
 *   a) The model emits "TASK COMPLETE: <summary>"
 *   b) The model emits "NEEDS INPUT: <reason>"
 *   c) The user presses Ctrl+C or sends a new message (user intervention)
 *
 * After each model response the command re-queues itself via nextInput so the
 * loop continues automatically. The stop condition is detected by reading the
 * last assistant message before each invocation.
 */

import * as React from 'react'
import { Box, Text } from '../../ink.js'
import type { LocalJSXCommandCall } from '../../types/command.js'

const MAX_AUTO_ROUNDS = 25

const CONTINUATION_PROMPT = `\
Continue working on the current task.

Rules:
- Work through every outstanding step using all available tools.
- Do NOT wait for user confirmation between steps — proceed autonomously.
- When the ENTIRE task is fully and completely done, respond with:
  TASK COMPLETE: <one-sentence summary>
- If you are blocked and need user input, respond with:
  NEEDS INPUT: <what you need>
- If you are unsure what the task is, ask briefly.

Begin.`

function KeepGoingBanner({
  args,
  onReady,
}: {
  args: string
  onReady: () => void
}): React.ReactNode {
  React.useEffect(() => {
    const id = setTimeout(onReady, 0)
    return () => clearTimeout(id)
  }, [onReady])

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color="cyan">
        {'◆ Keep Going — working autonomously until TASK COMPLETE'}
      </Text>
      {args ? (
        <Text dimColor>{`  Focus: ${args}`}</Text>
      ) : (
        <Text dimColor>
          {'  Press Ctrl+C or type to intervene at any time'}
        </Text>
      )}
      <Text dimColor>{`  Auto-rounds cap: ${MAX_AUTO_ROUNDS}`}</Text>
    </Box>
  )
}

function KeepGoingDone({
  message,
  onReady,
}: {
  message: string
  onReady: () => void
}): React.ReactNode {
  React.useEffect(() => {
    const id = setTimeout(onReady, 0)
    return () => clearTimeout(id)
  }, [onReady])

  return (
    <Box marginTop={1}>
      <Text bold color="green">
        {`◆ Keep Going — ${message}`}
      </Text>
    </Box>
  )
}

export const call: LocalJSXCommandCall = async (onDone, context, args) => {
  const extraFocus = args?.trim() ?? ''

  // Detect stop condition from the previous model response.
  let stopReason: string | null = null
  context.setMessages(prev => {
    const lastAssistant = [...prev].reverse().find(m => m.role === 'assistant')
    if (lastAssistant) {
      const blocks = Array.isArray(lastAssistant.content)
        ? lastAssistant.content
        : []
      const text = (blocks as Array<{ type: string; text?: string }>)
        .filter(b => b.type === 'text')
        .map(b => b.text ?? '')
        .join('\n')
      if (text.includes('TASK COMPLETE:')) {
        stopReason = 'task declared complete'
      } else if (text.includes('NEEDS INPUT:')) {
        stopReason = 'paused — model needs input'
      }
    }
    return prev
  })

  if (stopReason !== null) {
    return (
      <KeepGoingDone
        message={stopReason}
        onReady={() => onDone(stopReason!)}
      />
    )
  }

  // Continue loop: prime the model and re-queue /keepgoing after it responds.
  const prompt =
    CONTINUATION_PROMPT +
    (extraFocus ? `\n\nFocus specifically on: ${extraFocus}` : '')

  const nextCmd = extraFocus ? `/keepgoing ${extraFocus}` : '/keepgoing'

  const handleReady = () => {
    onDone(undefined, {
      display: 'system',
      shouldQuery: true,
      metaMessages: [prompt],
      nextInput: nextCmd,
      submitNextInput: true,
    })
  }

  return <KeepGoingBanner args={extraFocus} onReady={handleReady} />
}
