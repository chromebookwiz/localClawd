/**
 * /schedule — recurring prompts driven by a cron-like scheduler.
 *
 * /schedule                              — list existing schedules
 * /schedule list                         — same
 * /schedule rm <id|name>                 — remove
 * /schedule <cron> <name>: <prompt>      — add (name before first colon)
 * /schedule <cron> <prompt>              — add (name auto-generated)
 *
 * Cron expressions: standard 5-field, @hourly @daily @weekly @monthly,
 * or "every Nm" / "every Nh" / "every Nd".
 */

import * as React from 'react'
import { Box, Text } from '../../ink.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import {
  addSchedule,
  removeSchedule,
  listSchedules,
  validateScheduleExpression,
} from '../../services/schedule/scheduler.js'

function ScheduleResult({
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
      <Text bold color={color}>{'◆ Schedule'}</Text>
      <Box flexDirection="column" marginLeft={2}>
        {lines.map((line, i) => (
          <Text key={i} dimColor={line.startsWith('  ')}>{line}</Text>
        ))}
      </Box>
    </Box>
  )
}

function parseScheduleInput(rest: string): {
  expr: string
  name: string
  prompt: string
} | null {
  const trimmed = rest.trim()
  if (!trimmed) return null

  // Pull off the cron expression first — it's the first 5 fields or single @token/every phrase
  let expr = ''
  let remainder = ''

  if (/^@(hourly|daily|midnight|weekly|monthly)\b/i.test(trimmed)) {
    const [first, ...rest2] = trimmed.split(/\s+/)
    expr = first!
    remainder = rest2.join(' ')
  } else if (/^every\s+\d+\s*[mhd]\b/i.test(trimmed)) {
    const m = trimmed.match(/^(every\s+\d+\s*[mhd])\s+(.*)$/i)
    if (!m) return null
    expr = m[1]!
    remainder = m[2]!
  } else {
    const parts = trimmed.split(/\s+/)
    if (parts.length < 6) return null
    expr = parts.slice(0, 5).join(' ')
    remainder = parts.slice(5).join(' ')
  }

  if (!remainder) return null

  // If user wrote "name: prompt", split; otherwise auto-name
  const colonIdx = remainder.indexOf(':')
  let name = ''
  let prompt = remainder
  if (colonIdx > 0 && colonIdx < 60) {
    name = remainder.slice(0, colonIdx).trim()
    prompt = remainder.slice(colonIdx + 1).trim()
  }
  if (!name) name = prompt.slice(0, 32).trim().replace(/\s+/g, '-').toLowerCase()

  return { expr, name, prompt }
}

export const call: LocalJSXCommandCall = async (onDone, _context, args) => {
  const input = args?.trim() ?? ''

  if (!input || input === 'list') {
    const text = await listSchedules()
    const lines = text.split('\n')
    return <ScheduleResult lines={lines} color="#6366f1" onReady={() => onDone(undefined)} />
  }

  if (input.startsWith('rm ') || input.startsWith('remove ') || input.startsWith('delete ')) {
    const id = input.replace(/^(rm|remove|delete)\s+/, '').trim()
    const ok = await removeSchedule(id)
    return (
      <ScheduleResult
        lines={ok ? [`Removed schedule: ${id}`] : [`No schedule found: ${id}`]}
        color={ok ? 'green' : 'red'}
        onReady={() => onDone(undefined)}
      />
    )
  }

  const parsed = parseScheduleInput(input)
  if (!parsed) {
    return (
      <ScheduleResult
        lines={[
          'Usage:',
          '  /schedule list',
          '  /schedule rm <id|name>',
          '  /schedule <cron> <name>: <prompt>',
          '  /schedule @daily backup: run the backup script',
          '  /schedule every 30m ping: check on the deployment',
        ]}
        color="yellow"
        onReady={() => onDone(undefined)}
      />
    )
  }

  const validation = validateScheduleExpression(parsed.expr)
  if (!validation.ok) {
    return (
      <ScheduleResult
        lines={[`Invalid schedule expression: ${validation.error}`]}
        color="red"
        onReady={() => onDone(undefined)}
      />
    )
  }

  const entry = await addSchedule(parsed.name, parsed.expr, parsed.prompt)
  const nextStr = new Date(entry.nextRun).toISOString().slice(0, 16).replace('T', ' ')
  return (
    <ScheduleResult
      lines={[
        `Added schedule: ${entry.name} (${entry.id})`,
        `  When: ${entry.schedule}`,
        `  Next: ${nextStr} UTC`,
        `  Prompt: ${entry.prompt.slice(0, 100)}`,
      ]}
      color="green"
      onReady={() => onDone(undefined)}
    />
  )
}
