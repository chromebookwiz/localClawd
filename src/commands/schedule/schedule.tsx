import type { LocalJSXCommandCall } from '../../types/command.js'
import {
  addSchedule,
  removeSchedule,
  listSchedules,
  validateScheduleExpression,
} from '../../services/schedule/scheduler.js'

function parseScheduleInput(rest: string): { expr: string; name: string; prompt: string } | null {
  const trimmed = rest.trim()
  if (!trimmed) return null

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
    onDone(`◆ Schedule\n\n${text}`, { display: 'system' })
    return null
  }

  if (input.startsWith('rm ') || input.startsWith('remove ') || input.startsWith('delete ')) {
    const id = input.replace(/^(rm|remove|delete)\s+/, '').trim()
    const ok = await removeSchedule(id)
    onDone(
      ok ? `◆ Schedule — Removed: ${id}` : `◆ Schedule — No schedule found: ${id}`,
      { display: 'system' },
    )
    return null
  }

  const parsed = parseScheduleInput(input)
  if (!parsed) {
    onDone(
      [
        '◆ Schedule',
        '',
        'Usage:',
        '  /schedule list',
        '  /schedule rm <id|name>',
        '  /schedule <cron> <name>: <prompt>',
        '  /schedule @daily backup: run the backup script',
        '  /schedule every 30m ping: check on the deployment',
      ].join('\n'),
      { display: 'system' },
    )
    return null
  }

  const validation = validateScheduleExpression(parsed.expr)
  if (!validation.ok) {
    onDone(`◆ Schedule — Invalid expression: ${validation.error}`, { display: 'system' })
    return null
  }

  const entry = await addSchedule(parsed.name, parsed.expr, parsed.prompt)
  const nextStr = new Date(entry.nextRun).toISOString().slice(0, 16).replace('T', ' ')
  onDone(
    [
      `◆ Schedule — Added: ${entry.name} (${entry.id})`,
      `  When:   ${entry.schedule}`,
      `  Next:   ${nextStr} UTC`,
      `  Prompt: ${entry.prompt.slice(0, 100)}`,
    ].join('\n'),
    { display: 'system' },
  )
  return null
}
