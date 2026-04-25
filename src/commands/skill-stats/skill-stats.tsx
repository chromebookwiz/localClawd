/**
 * /skill-stats — show how often each skill has been used.
 *
 * Highlights skills that may be ripe for distillation/refinement.
 */

import * as React from 'react'
import { Box, Text } from '../../ink.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import {
  getSkillUsage,
  shouldNudgeDistillation,
} from '../../services/skills/skillUsage.js'

function timeAgo(ts: number): string {
  if (ts === 0) return 'never'
  const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  return `${Math.floor(hr / 24)}d ago`
}

function StatsView({
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
      <Text bold color="#6366f1">{'◆ Skill Usage'}</Text>
      <Box flexDirection="column" marginLeft={2}>
        {lines.map((line, i) => (
          <Text key={i} dimColor={line.startsWith('  ')}>{line}</Text>
        ))}
      </Box>
    </Box>
  )
}

export const call: LocalJSXCommandCall = async (onDone) => {
  const records = await getSkillUsage()
  const nudge = await shouldNudgeDistillation()

  const lines: string[] = []
  if (records.length === 0) {
    lines.push('No skill invocations recorded yet.')
    lines.push('Skills become trackable once you invoke them via /skills.')
  } else {
    lines.push(`Total skills tracked: ${records.length}`)
    lines.push('')
    for (const r of records.slice(0, 15)) {
      const ok = r.outcomes.success
      const bad = r.outcomes.aborted
      const summary = `${r.invocations}× (${ok}✓ ${bad}✗)  · last ${timeAgo(r.lastUsed)}`
      lines.push(`  ${r.skillName.padEnd(28)} ${summary}`)
    }
  }

  if (nudge.nudge) {
    lines.push('')
    lines.push(`💡 ${nudge.reason}`)
  }

  return <StatsView lines={lines} onReady={() => onDone(undefined)} />
}
