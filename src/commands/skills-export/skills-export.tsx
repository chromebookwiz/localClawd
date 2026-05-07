import type { LocalJSXCommandCall } from '../../types/command.js'
import { exportSkill, listSkills } from '../../services/skills/skillPortable.js'
import { getOriginalCwd } from '../../bootstrap/state.js'

export const call: LocalJSXCommandCall = async (onDone, _ctx, args) => {
  const input = (args ?? '').trim()
  if (!input) {
    const skills = await listSkills()
    const lines = ['◆ Skills Export', '', 'Usage: /skills-export <name> [dest-dir]', '']
    if (skills.length > 0) {
      lines.push('Available skills:')
      for (const s of skills.slice(0, 20)) lines.push(`  ${s}`)
    } else {
      lines.push('No user skills found at ~/.claude/skills/')
    }
    onDone(lines.join('\n'), { display: 'system' })
    return null
  }

  const parts = input.split(/\s+/)
  const name = parts[0]!
  const destDir = parts[1] ?? getOriginalCwd()

  const result = await exportSkill(name, destDir)
  if (!result.ok) {
    onDone(`◆ Skills Export — Error: ${result.error}`, { display: 'system' })
    return null
  }

  onDone(
    `◆ Skills Export — Exported "${name}"\n  → ${result.path}\n\nMove this file to another machine and run /skills-import <file> to load it.`,
    { display: 'system' },
  )
  return null
}
