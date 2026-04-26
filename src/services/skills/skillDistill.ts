/**
 * Skill distillation — turn a recent session into a candidate skill.
 *
 * Reads the current session's transcript, extracts the "recipe" (what
 * the user asked for + how the agent solved it), and uses the local
 * LLM to propose a skill definition (name, description, instructions,
 * tags). The user can then save it as a real skill.
 *
 * This is the first half of "skill self-improvement" — surfacing a
 * nudge after complex work. The self-improvement loop proper (skills
 * that edit themselves during use) is still on ROADMAP.
 */

import { readFile, readdir, stat } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'
import { logForDebugging } from '../../utils/debug.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import {
  getLocalLLMBaseUrl,
  getLocalLLMModel,
  getLocalLLMApiKey,
} from '../../utils/model/providers.js'

const PROJECTS_DIRS = [
  join(getClaudeConfigHomeDir(), 'projects'),
  join(homedir(), '.claude', 'projects'),
]
const MAX_TRANSCRIPT_CHARS = 10_000

export interface DistilledSkill {
  name: string
  description: string
  instructions: string
  tags: string[]
}

function extractText(obj: unknown): string {
  if (typeof obj === 'string') return obj
  if (!obj || typeof obj !== 'object') return ''
  if (Array.isArray(obj)) return obj.map(extractText).join(' ')
  const rec = obj as Record<string, unknown>
  const parts: string[] = []
  if (typeof rec.text === 'string') parts.push(rec.text)
  if (typeof rec.content === 'string') parts.push(rec.content)
  if (Array.isArray(rec.content)) parts.push(extractText(rec.content))
  if (rec.message) parts.push(extractText(rec.message))
  return parts.join(' ')
}

async function findMostRecentSession(): Promise<string | null> {
  let best: { path: string; mtime: number } | null = null
  for (const projectsDir of PROJECTS_DIRS) {
    let slugs: string[]
    try { slugs = await readdir(projectsDir) } catch { continue }
    for (const slug of slugs) {
      const slugDir = join(projectsDir, slug)
      try {
        const entries = await readdir(slugDir)
        for (const entry of entries) {
          if (!entry.endsWith('.jsonl')) continue
          const full = join(slugDir, entry)
          const s = await stat(full).catch(() => null)
          if (!s) continue
          if (!best || s.mtimeMs > best.mtime) {
            best = { path: full, mtime: s.mtimeMs }
          }
        }
      } catch { /* skip */ }
    }
  }
  return best?.path ?? null
}

async function buildTranscript(sessionPath: string): Promise<string> {
  const content = await readFile(sessionPath, 'utf-8')
  const lines = content.split('\n').filter(Boolean)
  const parts: string[] = []
  let used = 0
  for (const line of lines) {
    let parsed: { role?: string; message?: { role?: string } }
    try { parsed = JSON.parse(line) } catch { continue }
    const role = parsed.role ?? parsed.message?.role ?? 'unknown'
    const text = extractText(parsed).trim().replace(/\s+/g, ' ')
    if (!text) continue
    const snippet = `[${role}] ${text.slice(0, 800)}`
    if (used + snippet.length > MAX_TRANSCRIPT_CHARS) break
    parts.push(snippet)
    used += snippet.length + 1
  }
  return parts.join('\n')
}

async function callLLM(prompt: string): Promise<string | null> {
  try {
    const baseUrl = getLocalLLMBaseUrl()
    const model = getLocalLLMModel()
    const apiKey = getLocalLLMApiKey()
    if (!baseUrl || !model) return null

    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 700,
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(60_000),
    })
    if (!res.ok) return null
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    return data.choices?.[0]?.message?.content ?? null
  } catch (e) {
    logForDebugging(`[distill-skill] LLM call failed: ${e}`)
    return null
  }
}

function parseSkillResponse(text: string): DistilledSkill | null {
  const nameMatch = text.match(/NAME:\s*([^\n]+)/i)
  const descMatch = text.match(/DESCRIPTION:\s*([^\n]+)/i)
  const tagsMatch = text.match(/TAGS:\s*([^\n]+)/i)
  const instrMatch = text.match(/INSTRUCTIONS:\s*([\s\S]+?)(?:\n\s*TAGS:|$)/i)

  if (!nameMatch || !descMatch || !instrMatch) return null

  const name = nameMatch[1]!
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48)
  const description = descMatch[1]!.trim().slice(0, 200)
  const instructions = instrMatch[1]!.trim()
  const tags = (tagsMatch?.[1] ?? '')
    .split(/[,;]/)
    .map(t => t.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 6)

  if (!name || !description || !instructions) return null
  return { name, description, instructions, tags }
}

export async function distillRecentSessionToSkill(): Promise<DistilledSkill | null> {
  const sessionPath = await findMostRecentSession()
  if (!sessionPath) return null

  const transcript = await buildTranscript(sessionPath)
  if (!transcript) return null

  const prompt =
    `You are distilling a completed coding session into a reusable "skill" —\n` +
    `a short named recipe the agent can follow next time a similar task comes up.\n\n` +
    `Read the transcript below. Identify:\n` +
    `  1. What the user was trying to accomplish\n` +
    `  2. The minimum set of steps that made it work\n` +
    `  3. Any non-obvious gotchas worth remembering\n\n` +
    `If the session does NOT contain a reusable pattern (e.g. it was a one-off\n` +
    `question or exploration), respond with just: NO_SKILL\n\n` +
    `Otherwise respond in this exact format:\n` +
    `NAME: <kebab-case, short, specific>\n` +
    `DESCRIPTION: <one-sentence summary of when to use this skill>\n` +
    `INSTRUCTIONS:\n<numbered step-by-step, 3-8 steps>\n` +
    `TAGS: tag1, tag2, tag3\n\n` +
    `Transcript:\n${transcript}`

  const response = await callLLM(prompt)
  if (!response) return null
  if (/NO_SKILL/i.test(response.trim().slice(0, 100))) return null

  return parseSkillResponse(response)
}
