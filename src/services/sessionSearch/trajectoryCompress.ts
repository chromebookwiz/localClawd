/**
 * Trajectory compression — condense a session .jsonl into a compact
 * training-data-friendly format.
 *
 * Goals:
 *   - Drop redundant tool scaffolding (cache_control, usage, ids we
 *     don't need for training).
 *   - Keep role, content, tool_use blocks, tool_result blocks.
 *   - Merge consecutive messages of the same role.
 *   - Truncate very long tool results.
 *
 * Writes to ~/.claude/trajectories/<session-id>.json as a list of
 * { role, content } records.
 */

import { readFile, writeFile, readdir, mkdir, stat } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'
import { logForDebugging } from '../../utils/debug.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'

// Read sessions from both legacy + current paths so old histories still
// compress. Writes go to the canonical localclawd path only.
const PROJECTS_DIRS = [
  join(getClaudeConfigHomeDir(), 'projects'),
  join(homedir(), '.claude', 'projects'),
]
const TRAJECTORIES_DIR = join(getClaudeConfigHomeDir(), 'trajectories')
const MAX_TOOL_RESULT_CHARS = 4000

type CompactContent =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; name: string; input: unknown }
  | { type: 'tool_result'; tool_name?: string; content: string; is_error?: boolean }

interface CompactMessage {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: CompactContent[]
}

export interface TrajectoryFile {
  sessionId: string
  projectSlug: string
  sourceMtime: number
  compressedAt: number
  originalBytes: number
  compressedBytes: number
  messages: CompactMessage[]
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function flattenText(obj: unknown): string {
  if (typeof obj === 'string') return obj
  if (!obj || typeof obj !== 'object') return ''
  if (Array.isArray(obj)) return obj.map(flattenText).join('')
  const rec = obj as Record<string, unknown>
  if (typeof rec.text === 'string') return rec.text
  return ''
}

function compactContentBlock(block: unknown): CompactContent | null {
  if (!block || typeof block !== 'object') return null
  const b = block as Record<string, unknown>
  const type = b.type
  if (type === 'text' && typeof b.text === 'string') {
    return { type: 'text', text: b.text }
  }
  if (type === 'tool_use') {
    return {
      type: 'tool_use',
      name: String(b.name ?? ''),
      input: b.input ?? {},
    }
  }
  if (type === 'tool_result') {
    const raw = flattenText(b.content) || (typeof b.content === 'string' ? b.content : '')
    const truncated = raw.length > MAX_TOOL_RESULT_CHARS
      ? raw.slice(0, MAX_TOOL_RESULT_CHARS) + `\n…[truncated ${raw.length - MAX_TOOL_RESULT_CHARS} chars]`
      : raw
    return {
      type: 'tool_result',
      content: truncated,
      is_error: Boolean(b.is_error),
    }
  }
  return null
}

function extractMessage(line: string): CompactMessage | null {
  let parsed: Record<string, unknown>
  try { parsed = JSON.parse(line) } catch { return null }

  // jsonl layouts differ: some have {role, content} at top, some wrap in {message: {...}}
  const msg = (parsed.message as Record<string, unknown>) ?? parsed
  const role = msg.role
  if (role !== 'user' && role !== 'assistant' && role !== 'system' && role !== 'tool') return null

  const rawContent = msg.content
  const blocks: CompactContent[] = []

  if (typeof rawContent === 'string') {
    blocks.push({ type: 'text', text: rawContent })
  } else if (Array.isArray(rawContent)) {
    for (const b of rawContent) {
      const c = compactContentBlock(b)
      if (c) blocks.push(c)
    }
  }

  if (blocks.length === 0) return null
  return { role, content: blocks }
}

function mergeConsecutive(messages: CompactMessage[]): CompactMessage[] {
  const out: CompactMessage[] = []
  for (const m of messages) {
    const prev = out[out.length - 1]
    if (prev && prev.role === m.role) {
      prev.content.push(...m.content)
    } else {
      out.push({ role: m.role, content: [...m.content] })
    }
  }
  return out
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function compressSession(
  sessionId: string,
  projectSlug: string,
): Promise<TrajectoryFile | null> {
  // Try each projects dir until one resolves
  let sourcePath = ''
  let source: string | null = null
  let sourceStat: { mtimeMs: number; size: number } | null = null
  for (const projectsDir of PROJECTS_DIRS) {
    const candidate = join(projectsDir, projectSlug, `${sessionId}.jsonl`)
    try {
      const text = await readFile(candidate, 'utf-8')
      const s = await stat(candidate)
      sourcePath = candidate
      source = text
      sourceStat = { mtimeMs: s.mtimeMs, size: s.size }
      break
    } catch { /* try next */ }
  }
  if (!source || !sourceStat) return null
  void sourcePath  // referenced for future error logging

  const lines = source.split('\n').filter(Boolean)
  const messages: CompactMessage[] = []
  for (const line of lines) {
    const m = extractMessage(line)
    if (m) messages.push(m)
  }

  const merged = mergeConsecutive(messages)
  if (merged.length === 0) return null

  const trajectory: TrajectoryFile = {
    sessionId,
    projectSlug,
    sourceMtime: sourceStat.mtimeMs,
    compressedAt: Date.now(),
    originalBytes: sourceStat.size,
    compressedBytes: 0,
    messages: merged,
  }

  const serialized = JSON.stringify(trajectory, null, 0)
  trajectory.compressedBytes = Buffer.byteLength(serialized, 'utf-8')

  await mkdir(TRAJECTORIES_DIR, { recursive: true })
  await writeFile(
    join(TRAJECTORIES_DIR, `${sessionId}.json`),
    JSON.stringify(trajectory),
    'utf-8',
  )

  return trajectory
}

export async function compressAllPending(
  limit: number = 20,
): Promise<{ compressed: number; skipped: number; totalRatio: number }> {
  // Existing trajectories (mtime gate)
  const existing = new Map<string, number>()
  try {
    const files = await readdir(TRAJECTORIES_DIR)
    for (const f of files) {
      if (!f.endsWith('.json')) continue
      const s = await stat(join(TRAJECTORIES_DIR, f)).catch(() => null)
      if (s) existing.set(f.replace(/\.json$/, ''), s.mtimeMs)
    }
  } catch { /* fine */ }

  const pending: Array<{ slug: string; sessionId: string; mtime: number }> = []
  const seen = new Set<string>()
  for (const projectsDir of PROJECTS_DIRS) {
    let slugs: string[]
    try { slugs = await readdir(projectsDir) } catch { continue }
    for (const slug of slugs) {
      try {
        const entries = await readdir(join(projectsDir, slug))
        for (const entry of entries) {
          if (!entry.endsWith('.jsonl')) continue
          const sessionId = entry.replace(/\.jsonl$/, '')
          if (seen.has(sessionId)) continue
          seen.add(sessionId)
          const s = await stat(join(projectsDir, slug, entry)).catch(() => null)
          if (!s) continue
          const have = existing.get(sessionId)
          if (have && have >= s.mtimeMs) continue
          pending.push({ slug, sessionId, mtime: s.mtimeMs })
        }
      } catch { /* skip */ }
    }
  }

  pending.sort((a, b) => b.mtime - a.mtime)
  const slice = pending.slice(0, limit)

  let compressed = 0
  let skipped = 0
  let originalTotal = 0
  let compressedTotal = 0

  for (const p of slice) {
    try {
      const result = await compressSession(p.sessionId, p.slug)
      if (!result) { skipped++; continue }
      compressed++
      originalTotal += result.originalBytes
      compressedTotal += result.compressedBytes
    } catch (e) {
      logForDebugging(`[trajectory] compress failed: ${e}`)
      skipped++
    }
  }

  const totalRatio = originalTotal > 0 ? compressedTotal / originalTotal : 1
  return { compressed, skipped, totalRatio }
}
