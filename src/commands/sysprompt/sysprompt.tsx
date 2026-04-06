/**
 * /sysprompt [text] — Replace the session system prompt.
 *
 * /sysprompt <your text>   — Set a custom system prompt for this session.
 * /sysprompt               — Show current custom prompt (or "default" if none).
 * /sysprompt reset         — Clear the override, restore default.
 */

import * as React from 'react'
import { Box, Text } from '../../ink.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import {
  getSessionSyspromptOverride,
  setSessionSyspromptOverride,
} from '../../services/sysprompt/sessionSysprompt.js'

function SyspromptResult({
  message,
  color,
  onReady,
}: {
  message: string
  color: string
  onReady: () => void
}): React.ReactNode {
  React.useEffect(() => {
    const id = setTimeout(onReady, 0)
    return () => clearTimeout(id)
  }, [onReady])

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color={color as Parameters<typeof Text>[0]['color']}>
        {message}
      </Text>
    </Box>
  )
}

export const call: LocalJSXCommandCall = async (onDone, _context, args) => {
  const trimmed = args?.trim() ?? ''

  // Show current prompt
  if (!trimmed) {
    const current = getSessionSyspromptOverride()
    const handleReady = () => onDone(undefined)
    if (!current) {
      return (
        <SyspromptResult
          message="System prompt: (default — no override set)"
          color="cyan"
          onReady={handleReady}
        />
      )
    }
    const preview = current.length > 200 ? current.slice(0, 200) + '…' : current
    return (
      <SyspromptResult
        message={`System prompt override (${current.length} chars):\n${preview}`}
        color="cyan"
        onReady={handleReady}
      />
    )
  }

  // Reset to default
  if (trimmed === 'reset' || trimmed === 'default') {
    setSessionSyspromptOverride(null)
    return (
      <SyspromptResult
        message="System prompt reset to default."
        color="green"
        onReady={() => onDone(undefined)}
      />
    )
  }

  // Set new override
  setSessionSyspromptOverride(trimmed)
  const preview = trimmed.length > 120 ? trimmed.slice(0, 120) + '…' : trimmed
  return (
    <SyspromptResult
      message={`System prompt set (${trimmed.length} chars):\n${preview}`}
      color="green"
      onReady={() => onDone(undefined)}
    />
  )
}
