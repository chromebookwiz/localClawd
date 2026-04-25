/**
 * /reindex-sessions — refresh the FTS5 index from session-summaries/.
 *
 * Adds new rows, refreshes rows whose summary file is newer than the
 * indexed copy, removes rows for files that have been deleted. Reports
 * "FTS5 unavailable" when running on Node without `node:sqlite` + FTS5.
 */

import * as React from 'react'
import { Box, Text } from '../../ink.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import { rebuildIndex } from '../../services/sessionSearch/fts5Index.js'

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
      <Text bold color={color}>{'◆ Reindex Sessions'}</Text>
      <Box flexDirection="column" marginLeft={2}>
        {lines.map((line, i) => (
          <Text key={i} dimColor={line.startsWith('  ')}>{line}</Text>
        ))}
      </Box>
    </Box>
  )
}

export const call: LocalJSXCommandCall = async (onDone) => {
  const r = await rebuildIndex()

  if (!r.available) {
    return (
      <Result
        color="yellow"
        lines={[
          'FTS5 not available on this Node build.',
          '',
          'Requires Node 22.5+ with the built-in `node:sqlite` module.',
          '/sessionsearch will continue to work using the term-scoring fallback.',
        ]}
        onReady={() => onDone(undefined)}
      />
    )
  }

  return (
    <Result
      color="green"
      lines={[
        `Added:     ${r.added}`,
        `Refreshed: ${r.refreshed}`,
        `Removed:   ${r.removed}`,
        '',
        'FTS5 index at: ~/.claude/sessions.db',
        '/sessionsearch now uses BM25 ranking when this index is populated.',
      ]}
      onReady={() => onDone(undefined)}
    />
  )
}
