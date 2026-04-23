/**
 * Session Search — cross-session recall over past conversations.
 *
 * Scans ~/.claude/projects/<slug>/<uuid>.jsonl files, scores each session
 * against a query using term frequency + recency weighting, and returns
 * the top-N matches with context snippets.
 *
 * Zero deps — no SQLite. A future upgrade could back this with FTS5 once
 * node:sqlite is available everywhere we deploy.
 */

import { readdir, readFile, stat } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'

export interface SessionMatch {
  sessionId: string
  projectSlug: string
  score: number
  lastModified: number
  messageCount: number
  snippet: string
  preview: string
}

const PROJECTS_DIR = join(homedir(), '.claude', 'projects')
const MAX_FILE_BYTES = 5 * 1024 * 1024   // 5 MB — skip huge sessions
const MAX_SESSIONS_TO_SCAN = 200
const MAX_SNIPPET_LEN = 160

interface SessionLine {
  role?: string
  type?: string
  content?: unknown
  message?: { role?: string; content?: unknown }
  timestamp?: string
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter(t => t.length >= 2)
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

async function listSessionFiles(): Promise<Array<{ slug: string; path: string; mtime: number }>> {
  const result: Array<{ slug: string; path: string; mtime: number }> = []
  let projects: string[]
  try {
    projects = await readdir(PROJECTS_DIR)
  } catch {
    return result
  }

  for (const slug of projects) {
    const slugDir = join(PROJECTS_DIR, slug)
    try {
      const entries = await readdir(slugDir)
      for (const entry of entries) {
        if (!entry.endsWith('.jsonl')) continue
        const full = join(slugDir, entry)
        try {
          const s = await stat(full)
          if (s.size > MAX_FILE_BYTES) continue
          result.push({ slug, path: full, mtime: s.mtimeMs })
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }

  // Newest first, cap total
  result.sort((a, b) => b.mtime - a.mtime)
  return result.slice(0, MAX_SESSIONS_TO_SCAN)
}

async function scoreSession(
  terms: string[],
  filePath: string,
): Promise<{ score: number; messageCount: number; snippet: string; preview: string }> {
  let content: string
  try {
    content = await readFile(filePath, 'utf-8')
  } catch {
    return { score: 0, messageCount: 0, snippet: '', preview: '' }
  }

  const lines = content.split('\n').filter(Boolean)
  let score = 0
  let bestSnippet = ''
  let bestSnippetScore = 0
  let firstUserText = ''

  for (const line of lines) {
    let parsed: SessionLine
    try {
      parsed = JSON.parse(line) as SessionLine
    } catch { continue }

    const text = extractText(parsed).toLowerCase()
    if (!text) continue

    if (!firstUserText) {
      const role = parsed.role ?? parsed.message?.role
      if (role === 'user') firstUserText = extractText(parsed).slice(0, 200)
    }

    let lineScore = 0
    for (const term of terms) {
      // Count matches — simple substring count
      let idx = 0
      let count = 0
      while ((idx = text.indexOf(term, idx)) !== -1) {
        count++
        idx += term.length
      }
      lineScore += count
    }
    score += lineScore

    if (lineScore > bestSnippetScore) {
      bestSnippetScore = lineScore
      const raw = extractText(parsed).trim().replace(/\s+/g, ' ')
      bestSnippet = raw.slice(0, MAX_SNIPPET_LEN)
    }
  }

  return {
    score,
    messageCount: lines.length,
    snippet: bestSnippet,
    preview: firstUserText.trim().replace(/\s+/g, ' '),
  }
}

export async function searchSessions(
  query: string,
  limit: number = 10,
): Promise<SessionMatch[]> {
  const terms = tokenize(query)
  if (terms.length === 0) return []

  const files = await listSessionFiles()
  const now = Date.now()
  const results: SessionMatch[] = []

  for (const f of files) {
    const r = await scoreSession(terms, f.path)
    if (r.score === 0) continue

    // Recency boost: log-scale days since last modified
    const daysOld = Math.max(0, (now - f.mtime) / (1000 * 60 * 60 * 24))
    const recencyBoost = 1 / (1 + Math.log(1 + daysOld))
    const finalScore = r.score * (0.7 + 0.3 * recencyBoost)

    const sessionId = f.path.split(/[\\/]/).pop()!.replace(/\.jsonl$/, '')

    results.push({
      sessionId,
      projectSlug: f.slug,
      score: finalScore,
      lastModified: f.mtime,
      messageCount: r.messageCount,
      snippet: r.snippet,
      preview: r.preview,
    })
  }

  results.sort((a, b) => b.score - a.score)
  return results.slice(0, limit)
}

export function formatMatches(matches: SessionMatch[]): string {
  if (matches.length === 0) return 'No matching sessions found.'
  const lines: string[] = []
  for (const m of matches) {
    const date = new Date(m.lastModified).toISOString().slice(0, 10)
    lines.push(`${date}  [${m.projectSlug}]  score=${m.score.toFixed(1)}  msgs=${m.messageCount}`)
    lines.push(`  id: ${m.sessionId}`)
    if (m.preview) lines.push(`  first: ${m.preview.slice(0, 100)}`)
    if (m.snippet) lines.push(`  match: ${m.snippet.slice(0, 120)}`)
    lines.push('')
  }
  return lines.join('\n').trimEnd()
}
