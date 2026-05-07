import type { LocalJSXCommandCall } from '../../types/command.js'
import { appendSkillNote, loadSkillNotes } from '../../services/skills/skillNotes.js'

export const call: LocalJSXCommandCall = async (onDone, _ctx, args) => {
  const input = (args ?? '').trim()
  if (!input) {
    onDone(
      '◆ Skill Note\n\nUsage:\n  /skill-note <skill-name> <note text>\n  /skill-note <skill-name>            (show current notes)\n\nExample:\n  /skill-note ship-pr always run lint before tagging the release commit',
      { display: 'system' },
    )
    return null
  }

  const m = input.match(/^(\S+)(?:\s+([\s\S]+))?$/)
  if (!m) {
    onDone('◆ Skill Note — Could not parse arguments.', { display: 'system' })
    return null
  }
  const skillName = m[1]!
  const note = (m[2] ?? '').trim()

  if (!note) {
    const existing = await loadSkillNotes(skillName)
    if (!existing) {
      onDone(`◆ Skill Note — No notes recorded for "${skillName}" yet.`, { display: 'system' })
      return null
    }
    onDone(`◆ Skill Note — ${skillName}\n\n${existing.split('\n').slice(-30).join('\n')}`, { display: 'system' })
    return null
  }

  const result = await appendSkillNote(skillName, note)
  if (!result.ok) {
    onDone(`◆ Skill Note — Error: ${result.error}`, { display: 'system' })
    return null
  }
  onDone(`◆ Skill Note — Appended to ${skillName}\n  → ${result.path}`, { display: 'system' })
  return null
}
