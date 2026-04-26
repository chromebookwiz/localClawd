/**
 * /memory-prune [--force] [--capacity=N]
 *
 * Run a pruning pass over the effectiveness-graded memory store.
 * Items with the lowest composite score (effectiveness × recency ×
 * usefulness) are evicted. The user's curated memory/*.md files are
 * never auto-deleted.
 */

import * as React from 'react'
import { Box, Text } from '../../ink.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import { prune, getPrunerState } from '../../services/memory/memoryPruner.js'
import { AutoDone } from '../../components/AutoDone.js'

function parseArgs(input: string): { force: boolean; capacity?: number } {
  const force = /\s--force\b|^--force\b/.test(' ' + input)
  const capMatch = input.match(/--capacity[=\s]+(\d+)/)
  const capacity = capMatch ? parseInt(capMatch[1]!, 10) : undefined
  return { force, capacity }
}

function Result({
  lines, color, onReady,
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
      <Text bold color={color}>{'◆ Memory Prune'}</Text>
      <Box flexDirection="column" marginLeft={2}>
        {lines.map((line, i) => (
          <Text key={i} dimColor={line.startsWith('  ')}>{line}</Text>
        ))}
      </Box>
    </Box>
  )
}

export const call: LocalJSXCommandCall = async (onDone, _ctx, args) => {
  const opts = parseArgs((args ?? '').trim())
  const before = await getPrunerState()
  const result = await prune(opts)
  const after = await getPrunerState()

  const lines: string[] = [
    `Pruned:        ${result.pruned}`,
    `Kept:          ${result.kept}`,
    `Reason:        ${result.reason}`,
    '',
    `Indexed memories: ${after.indexed}  (was ${before.indexed})`,
    `Graded items:     ${after.graded}  (was ${before.graded})`,
    `Total pruned (lifetime): ${after.totalPruned}`,
  ]

  return (
    <AutoDone onDone={onDone}>
      <Result
        lines={lines}
        color={result.pruned > 0 ? 'green' : 'yellow'}
        onReady={() => {}}
      />
    </AutoDone>
  )
}
