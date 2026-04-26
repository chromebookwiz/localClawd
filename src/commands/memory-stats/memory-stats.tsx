/**
 * /memory-stats — show the agent's outcome-graded memory and skill
 * scores. The agent uses these scores to rank retrievals: items that
 * have led to TASK COMPLETE drift up; items associated with abandoned
 * or failed work decay slightly.
 */

import * as React from 'react'
import { Box, Text } from '../../ink.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import { listGraded } from '../../services/memory/effectiveness.js'
import { isEmbeddingAvailable, getEmbeddingModel } from '../../services/memory/embedding.js'
import { AutoDone } from '../../components/AutoDone.js'

function pct(score: number): string {
  return `${(score * 100).toFixed(0)}%`
}

function bar(score: number, width: number = 14): string {
  const filled = Math.round(score * width)
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

function timeAgo(ts: number): string {
  if (!ts) return 'never'
  const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  return `${Math.floor(hr / 24)}d ago`
}

function StatsView({
  rows,
  embedAvailable,
  embedModel,
  onReady,
}: {
  rows: Array<{ id: string; kind: string; score: number; retrievals: number; successes: number; failures: number; lastUpdated: number }>
  embedAvailable: boolean
  embedModel: string
  onReady: () => void
}): React.ReactNode {
  React.useEffect(() => {
    const id = setTimeout(onReady, 0)
    return () => clearTimeout(id)
  }, [onReady])

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color="#6366f1">{'◆ Memory Effectiveness'}</Text>
      <Box flexDirection="column" marginLeft={2}>
        <Text dimColor>{'Score = exponential-moving-average of task success after retrieval.'}</Text>
        <Text dimColor>{'Higher score = more likely to be retrieved next time on similar queries.'}</Text>
        <Text>{''}</Text>
        <Text dimColor>{`Embeddings: ${embedAvailable ? `available (model: ${embedModel})` : 'not available — keyword + lattice only'}`}</Text>
      </Box>

      {rows.length === 0 ? (
        <Box marginLeft={2} marginTop={1}>
          <Text dimColor>{'No items graded yet. Scores accrue as you finish tasks (TASK COMPLETE).'}</Text>
        </Box>
      ) : (
        <Box flexDirection="column" marginLeft={2} marginTop={1}>
          <Text bold>{'Top items:'}</Text>
          {rows.slice(0, 20).map((r, i) => (
            <Box key={i}>
              <Text>{`  ${bar(r.score)}  `}</Text>
              <Text color="#10b981">{pct(r.score).padStart(4)}</Text>
              <Text>{`  [${r.kind.padEnd(7)}]  `}</Text>
              <Text>{r.id.length > 36 ? r.id.slice(0, 33) + '…' : r.id.padEnd(36)}</Text>
              <Text dimColor>{`  ${r.successes}✓ ${r.failures}✗  ${timeAgo(r.lastUpdated)}`}</Text>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  )
}

export const call: LocalJSXCommandCall = async (onDone) => {
  const records = await listGraded()
  const embedOk = await isEmbeddingAvailable()
  const embedModel = getEmbeddingModel()
  return (
    <AutoDone onDone={onDone}>
      <StatsView
        rows={records}
        embedAvailable={embedOk}
        embedModel={embedModel}
        onReady={() => {}}
      />
    </AutoDone>
  )
}
