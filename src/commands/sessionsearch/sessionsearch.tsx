/**
 * /sessionsearch <query> — search past conversations by keyword.
 *
 * Scans every .jsonl in ~/.claude/projects/ with term-frequency scoring
 * and recency weighting. Returns top 10 matches with snippets.
 */

import * as React from 'react'
import { Box, Text } from '../../ink.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import { searchSessions, formatMatches } from '../../services/sessionSearch/sessionSearch.js'

function SessionSearchResult({
  lines,
  onReady,
}: {
  lines: string[]
  onReady: () => void
}): React.ReactNode {
  React.useEffect(() => {
    const id = setTimeout(onReady, 0)
    return () => clearTimeout(id)
  }, [onReady])

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color="#6366f1">{'◆ Session Search'}</Text>
      <Box flexDirection="column" marginLeft={2}>
        {lines.map((line, i) => (
          <Text key={i} dimColor={line.startsWith('  ')}>{line}</Text>
        ))}
      </Box>
    </Box>
  )
}

export const call: LocalJSXCommandCall = async (onDone, _context, args) => {
  const query = args?.trim() ?? ''
  if (!query) {
    return (
      <SessionSearchResult
        lines={[
          'Usage: /sessionsearch <query>',
          'Example: /sessionsearch auth token storage',
        ]}
        onReady={() => onDone(undefined)}
      />
    )
  }

  const matches = await searchSessions(query, 10)
  const text = formatMatches(matches)
  return <SessionSearchResult lines={text.split('\n')} onReady={() => onDone(undefined)} />
}
