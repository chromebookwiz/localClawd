import type { LocalJSXCommandCall } from '../../types/command.js'
import { importSkill } from '../../services/skills/skillPortable.js'
import { resolve } from 'path'
import { getOriginalCwd } from '../../bootstrap/state.js'

export const call: LocalJSXCommandCall = async (onDone, _ctx, args) => {
  const input = (args ?? '').trim()
  if (!input) {
    onDone('◆ Skills Import\n\nUsage: /skills-import <path-to-md-file>', { display: 'system' })
    return null
  }

  const filePath = resolve(getOriginalCwd(), input)
  const result = await importSkill(filePath)
  if (!result.ok) {
    onDone(`◆ Skills Import — Error: ${result.error}`, { display: 'system' })
    return null
  }

  onDone(
    `◆ Skills Import — Imported "${result.name}"\n  → ${result.path}\n\nUse it via /skills or invoke directly with the skill name.`,
    { display: 'system' },
  )
  return null
}
