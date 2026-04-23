/**
 * /compress-sessions [limit] — compress past .jsonl sessions into
 * compact trajectories stored at ~/.claude/trajectories/.
 *
 * Strips cache metadata, merges consecutive same-role messages,
 * truncates oversized tool results. Useful for training-data export
 * or just reclaiming disk.
 */

import * as React from 'react'
import { Box, Text } from '../../ink.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import { compressAllPending } from '../../services/sessionSearch/trajectoryCompress.js'

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
      <Text bold color={color}>{'◆ Compress Sessions'}</Text>
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
  const r = await compressAllPending(limit)

  const lines: string[] = []
  lines.push(`Compressed: ${r.compressed}`)
  lines.push(`Skipped:    ${r.skipped}`)
  if (r.compressed > 0) {
    lines.push(`Ratio:      ${(r.totalRatio * 100).toFixed(1)}% of original size`)
  }
  lines.push('')
  lines.push('Stored at: ~/.claude/trajectories/')

  return (
    <Result
      lines={lines}
      color={r.compressed > 0 ? 'green' : 'yellow'}
      onReady={() => onDone(undefined)}
    />
  )
}
