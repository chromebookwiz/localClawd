/**
 * /skill-note <skill> <text>
 *
 * Appends a "lesson learned" to a skill's notes file. These notes are
 * automatically loaded as context next time the skill is invoked, so
 * useful corrections persist without rewriting the skill body itself.
 *
 * Notes live at ~/.claude/skills/<skill>.notes.md.
 */

import * as React from 'react'
import { Box, Text } from '../../ink.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import { appendSkillNote, loadSkillNotes } from '../../services/skills/skillNotes.js'

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
      <Text bold color={color}>{'◆ Skill Note'}</Text>
      <Box flexDirection="column" marginLeft={2}>
        {lines.map((line, i) => (
          <Text key={i} dimColor={line.startsWith('  ')}>{line}</Text>
        ))}
      </Box>
    </Box>
  )
}

export const call: LocalJSXCommandCall = async (onDone, _ctx, args) => {
  const input = (args ?? '').trim()
  if (!input) {
    return (
      <Result
        color="yellow"
        lines={[
          'Usage:',
          '  /skill-note <skill-name> <note text>',
          '  /skill-note <skill-name>            (show current notes)',
          '',
          'Example:',
          '  /skill-note ship-pr always run lint before tagging the release commit',
        ]}
        onReady={() => onDone(undefined)}
      />
    )
  }

  // First whitespace-delimited token is the skill name; rest is the note
  const m = input.match(/^(\S+)(?:\s+([\s\S]+))?$/)
  if (!m) {
    return <Result color="red" lines={['Could not parse arguments.']} onReady={() => onDone(undefined)} />
  }
  const skillName = m[1]!
  const note = (m[2] ?? '').trim()

  // Show mode (no note text given)
  if (!note) {
    const existing = await loadSkillNotes(skillName)
    if (!existing) {
      return (
        <Result
          color="yellow"
          lines={[`No notes recorded for "${skillName}" yet.`]}
          onReady={() => onDone(undefined)}
        />
      )
    }
    return (
      <Result
        color="#6366f1"
        lines={existing.split('\n').slice(-30)}
        onReady={() => onDone(undefined)}
      />
    )
  }

  // Append mode
  const result = await appendSkillNote(skillName, note)
  if (!result.ok) {
    return <Result color="red" lines={[result.error]} onReady={() => onDone(undefined)} />
  }
  return (
    <Result
      color="green"
      lines={[`Appended note to ${skillName}.`, `  → ${result.path}`]}
      onReady={() => onDone(undefined)}
    />
  )
}
