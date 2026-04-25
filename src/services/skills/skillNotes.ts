/**
 * Skill notes — append-only "lessons learned" attached to each skill.
 *
 * Each note is a one-line entry stored at:
 *   ~/.claude/skills/<name>.notes.md
 * (or ~/.claude/skills/<name>/NOTES.md for skill-as-directory layouts)
 *
 * The skill loader can prepend these notes to the skill body next time
 * the skill is invoked, so genuinely useful corrections persist across
 * invocations without rewriting the skill itself.
 *
 * This is the minimum viable form of "skills that self-improve during use."
 * Full self-improvement (skills that observe outcomes and rewrite their
 * own bodies) requires deeper hooks into skill execution and stays on
 * the roadmap.
 */

import { mkdir, readFile, writeFile, appendFile, stat } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'
import { logForDebugging } from '../../utils/debug.js'

const USER_SKILLS_DIR = join(homedir(), '.claude', 'skills')
const MAX_NOTES_BYTES = 32 * 1024
const MAX_NOTE_LENGTH = 500

async function findNotesPath(skillName: string): Promise<string> {
  const dirPath = join(USER_SKILLS_DIR, skillName, 'NOTES.md')
  try {
    const s = await stat(join(USER_SKILLS_DIR, skillName))
    if (s.isDirectory()) return dirPath
  } catch { /* not a directory layout */ }
  return join(USER_SKILLS_DIR, `${skillName}.notes.md`)
}

export async function loadSkillNotes(skillName: string): Promise<string> {
  const path = await findNotesPath(skillName)
  try {
    return await readFile(path, 'utf-8')
  } catch {
    return ''
  }
}

export async function appendSkillNote(
  skillName: string,
  note: string,
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const trimmed = note.trim().slice(0, MAX_NOTE_LENGTH)
  if (!trimmed) return { ok: false, error: 'note is empty' }

  const path = await findNotesPath(skillName)
  await mkdir(USER_SKILLS_DIR, { recursive: true })

  // Read current size and rotate if too large
  let existing = ''
  try { existing = await readFile(path, 'utf-8') } catch { /* fresh */ }
  if (existing.length === 0) {
    existing = `# Notes for skill: ${skillName}\n\n` +
      `These are accumulated lessons. The skill loader prepends recent ones to\n` +
      `the skill body when this skill is next invoked.\n\n`
  }

  const date = new Date().toISOString().slice(0, 10)
  const entry = `- ${date}: ${trimmed}\n`

  // If oversized, drop the oldest line items beyond the header
  if (existing.length + entry.length > MAX_NOTES_BYTES) {
    const lines = existing.split('\n')
    const headerEnd = lines.findIndex(l => l.startsWith('- '))
    if (headerEnd > 0) {
      // Keep the latest ~half
      const trimStart = headerEnd + Math.floor((lines.length - headerEnd) / 2)
      const compacted = lines.slice(0, headerEnd).concat(lines.slice(trimStart)).join('\n')
      try { await writeFile(path, compacted + entry, 'utf-8') } catch (e) { return { ok: false, error: String(e) } }
      logForDebugging(`[skill-notes] rotated ${path}`)
      return { ok: true, path }
    }
  }

  try {
    await appendFile(path, existing.length === 0 ? existing + entry : entry, 'utf-8')
    return { ok: true, path }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

/** Build a short prefix (most recent N lessons) for prepending to the skill prompt. */
export async function buildSkillNotesPrefix(
  skillName: string,
  maxNotes: number = 5,
): Promise<string> {
  const raw = await loadSkillNotes(skillName)
  if (!raw) return ''
  const lines = raw.split('\n').filter(l => l.startsWith('- '))
  if (lines.length === 0) return ''
  const recent = lines.slice(-maxNotes)
  return `## Lessons from past invocations\n\n${recent.join('\n')}\n\n`
}
