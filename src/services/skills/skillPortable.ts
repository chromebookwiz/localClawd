/**
 * Portable skill import/export — moves skills between machines and
 * supports the agentskills.io-style markdown-with-frontmatter format.
 *
 * Each skill is a single .md file with YAML frontmatter:
 *
 *   ---
 *   name: my-skill
 *   description: When to use this skill
 *   tags: [foo, bar]
 *   ---
 *
 *   # Instructions
 *   ...the body of the skill...
 *
 * Skills are read from / written to ~/.claude/skills/<name>.md.
 */

import { readdir, readFile, writeFile, mkdir, stat } from 'fs/promises'
import { join, basename, extname, resolve } from 'path'
import { logForDebugging } from '../../utils/debug.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'

const USER_SKILLS_DIR = join(getClaudeConfigHomeDir(), 'skills')

export interface PortableSkill {
  name: string
  description: string
  tags: string[]
  body: string
}

// ─── Frontmatter parsing ────────────────────────────────────────────────────

function parseFrontmatter(raw: string): { meta: Record<string, unknown>; body: string } {
  const m = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/)
  if (!m) return { meta: {}, body: raw }

  const yaml = m[1]!
  const body = m[2] ?? ''
  const meta: Record<string, unknown> = {}

  for (const line of yaml.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const colon = t.indexOf(':')
    if (colon < 0) continue
    const key = t.slice(0, colon).trim()
    let val: string = t.slice(colon + 1).trim()

    // YAML list shorthand: [a, b, c]
    if (val.startsWith('[') && val.endsWith(']')) {
      const items = val.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean)
      meta[key] = items
      continue
    }

    // Strip surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    meta[key] = val
  }

  return { meta, body }
}

function buildFrontmatter(skill: PortableSkill): string {
  const lines: string[] = ['---']
  lines.push(`name: ${skill.name}`)
  lines.push(`description: ${JSON.stringify(skill.description)}`)
  if (skill.tags.length > 0) lines.push(`tags: [${skill.tags.join(', ')}]`)
  lines.push('---')
  lines.push('')
  lines.push(skill.body.trim())
  lines.push('')
  return lines.join('\n')
}

// ─── Listing ─────────────────────────────────────────────────────────────────

export async function listSkills(): Promise<string[]> {
  try {
    const entries = await readdir(USER_SKILLS_DIR)
    const out: string[] = []
    for (const entry of entries) {
      if (entry.endsWith('.md')) {
        out.push(entry.replace(/\.md$/, ''))
      } else {
        // Subdirectory with SKILL.md
        try {
          const sub = await stat(join(USER_SKILLS_DIR, entry, 'SKILL.md'))
          if (sub.isFile()) out.push(entry)
        } catch { /* not a skill dir */ }
      }
    }
    return out
  } catch {
    return []
  }
}

async function readSkillFile(name: string): Promise<{ raw: string; path: string } | null> {
  // Try flat .md first
  const flatPath = join(USER_SKILLS_DIR, `${name}.md`)
  try {
    const raw = await readFile(flatPath, 'utf-8')
    return { raw, path: flatPath }
  } catch { /* try directory */ }

  const dirPath = join(USER_SKILLS_DIR, name, 'SKILL.md')
  try {
    const raw = await readFile(dirPath, 'utf-8')
    return { raw, path: dirPath }
  } catch {
    return null
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function exportSkill(
  name: string,
  destDir: string,
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const file = await readSkillFile(name)
  if (!file) return { ok: false, error: `Skill not found: ${name}` }

  const { meta, body } = parseFrontmatter(file.raw)
  const description = typeof meta.description === 'string' ? meta.description : ''
  const tags = Array.isArray(meta.tags) ? (meta.tags as string[]) : []

  const skill: PortableSkill = {
    name: typeof meta.name === 'string' ? meta.name : name,
    description,
    tags,
    body,
  }

  const outPath = resolve(destDir, `${skill.name}.md`)
  await mkdir(destDir, { recursive: true })
  await writeFile(outPath, buildFrontmatter(skill), 'utf-8')
  return { ok: true, path: outPath }
}

export async function importSkill(
  filePath: string,
): Promise<{ ok: true; name: string; path: string } | { ok: false; error: string }> {
  let raw: string
  try {
    raw = await readFile(filePath, 'utf-8')
  } catch (e) {
    return { ok: false, error: `Could not read ${filePath}: ${e}` }
  }

  const { meta, body } = parseFrontmatter(raw)
  let name = typeof meta.name === 'string' ? meta.name : ''
  if (!name) {
    name = basename(filePath, extname(filePath))
  }
  // Sanitize name to a safe filename
  name = name.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '').slice(0, 48)
  if (!name) return { ok: false, error: 'Could not derive a valid skill name' }

  const description = typeof meta.description === 'string' ? meta.description : ''
  const tags = Array.isArray(meta.tags) ? (meta.tags as string[]) : []

  const skill: PortableSkill = { name, description, tags, body }
  const outPath = join(USER_SKILLS_DIR, `${name}.md`)

  try {
    await mkdir(USER_SKILLS_DIR, { recursive: true })
    await writeFile(outPath, buildFrontmatter(skill), 'utf-8')
    logForDebugging(`[skills] imported ${name} → ${outPath}`)
    return { ok: true, name, path: outPath }
  } catch (e) {
    return { ok: false, error: `Could not write skill: ${e}` }
  }
}
