/**
 * /summarize-sessions [limit] — LLM-summarize past sessions into a
 * searchable index under ~/.claude/session-summaries/.
 *
 * Only un-summarized (or stale-summary) sessions are processed. Defaults
 * to 20 per invocation so large backlogs can be worked through across
 * multiple runs.
 */

import * as React from 'react'
import { Box, Text } from '../../ink.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import { summarizeAllPending } from '../../services/sessionSearch/sessionSummarize.js'

function Result({
  lines,
  color,
  onReady,
}: {
  lines: string[]
  color: string
  onReady: () => void
}): React.ReactNode {
  React.useEffect(() => {
    const id = setTimeout(onReady, 0)
    return () => clearTimeout(id)
  }, [onReady])

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color={color}>{'◆ Summarize Sessions'}</Text>
      <Box flexDirection="column" marginLeft={2}>
        {lines.map((line, i) => (
          <Text key={i} dimColor={line.startsWith('  ')}>{line}</Text>
        ))}
      </Box>
    </Box>
  )
}

export const call: LocalJSXCommandCall = async (onDone, _context, args) => {
  const limit = parseInt((args ?? '').trim(), 10) || 20

  const result = await summarizeAllPending(limit)
  const lines: string[] = []
  lines.push(`Summarized: ${result.summarized}`)
  lines.push(`Skipped:    ${result.skipped}`)
  if (result.summarized === 0 && result.skipped === 0) {
    lines.push('')
    lines.push('No pending sessions. Run after accumulating more conversation history.')
  }
  if (result.skipped > 0) {
    lines.push('')
    lines.push('Skips usually mean the local LLM rejected or timed out on a session.')
  }
  lines.push('')
  lines.push('Summaries stored at: ~/.claude/session-summaries/')

  return (
    <Result
      lines={lines}
      color={result.summarized > 0 ? 'green' : 'yellow'}
      onReady={() => onDone(undefined)}
    />
  )
}
