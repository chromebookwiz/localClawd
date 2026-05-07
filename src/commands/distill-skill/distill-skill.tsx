import type { LocalJSXCommandCall } from '../../types/command.js'
import { distillRecentSessionToSkill } from '../../services/skills/skillDistill.js'

export const call: LocalJSXCommandCall = async (onDone) => {
  const skill = await distillRecentSessionToSkill()

  if (!skill) {
    onDone(
      '◆ Distill Skill\n\nNo distillable pattern found in the most recent session.\nThis usually means the session was exploratory or too short.',
      { display: 'system' },
    )
    return null
  }

  const lines = [
    '◆ Distilled Skill Candidate',
    '',
    `Name:        ${skill.name}`,
    `Description: ${skill.description}`,
    `Tags:        ${skill.tags.join(', ') || '(none)'}`,
    '',
    'Instructions:',
    ...skill.instructions.split('\n').map(l => `  ${l}`),
    '',
    'Save with /skills, or copy the instructions elsewhere.',
  ]

  onDone(lines.join('\n'), { display: 'system' })
  return null
}
