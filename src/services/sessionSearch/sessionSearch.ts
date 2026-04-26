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
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { loadAllSummaries } from './sessionSummarize.js'
import { searchFts5 } from './fts5Index.js'

export interface SessionMatch {
  sessionId: string
  projectSlug: string
  score: number
  lastModified: number
  messageCount: number
  snippet: string
  preview: string
  summary?: string
  tags?: string[]
}

// Search both the canonical localclawd path AND the legacy .claude path so
// users with existing session histories don't lose recall when they upgrade.
const PROJECTS_DIRS = [
  join(getClaudeConfigHomeDir(), 'projects'),
  join(homedir(), '.claude', 'projects'),
]
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
  const seen = new Set<string>()
  for (const projectsDir of PROJECTS_DIRS) {
    let projects: string[]
    try {
      projects = await readdir(projectsDir)
    } catch {
      continue
    }
    for (const slug of projects) {
      const slugDir = join(projectsDir, slug)
      try {
        const entries = await readdir(slugDir)
        for (const entry of entries) {
          if (!entry.endsWith('.jsonl')) continue
          const full = join(slugDir, entry)
          // Dedupe across legacy + new paths if the same session id exists
          // in both (we deliberately don't migrate, just read both).
          if (seen.has(entry)) continue
          seen.add(entry)
          try {
            const s = await stat(full)
            if (s.size > MAX_FILE_BYTES) continue
            result.push({ slug, path: full, mtime: s.mtimeMs })
          } catch { /* skip */ }
        }
      } catch { /* skip */ }
    }
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

  const now = Date.now()
  const matchMap = new Map<string, SessionMatch>()

  // Pass 0: try FTS5 (fastest, BM25-ranked). When available it's the
  // primary signal; we still run the legacy passes to catch sessions
  // that haven't been summarized yet.
  const fts = await searchFts5(query, limit * 2)
  if (fts && fts.length > 0) {
    for (const hit of fts) {
      const daysOld = Math.max(0, (now - hit.lastModified) / (1000 * 60 * 60 * 24))
      const recencyBoost = 1 / (1 + Math.log(1 + daysOld))
      // Multiply BM25 score by 3 so FTS5 hits dominate when present
      const finalScore = hit.score * 3 * (0.7 + 0.3 * recencyBoost)
      matchMap.set(hit.sessionId, {
        sessionId: hit.sessionId,
        projectSlug: hit.projectSlug,
        score: finalScore,
        lastModified: hit.lastModified,
        messageCount: 0,
        snippet: hit.summary,
        preview: hit.firstUser,
        summary: hit.summary,
        tags: hit.tags,
      })
    }
  }

  // Pass 1: summaries (fast; only read small JSON files)
  const summaries = await loadAllSummaries()
  for (const s of summaries) {
    const hay = (s.summary + ' ' + s.tags.join(' ') + ' ' + s.firstUserMessage).toLowerCase()
    let score = 0
    for (const term of terms) {
      let idx = 0
      while ((idx = hay.indexOf(term, idx)) !== -1) { score++; idx += term.length }
      // Tag match — strong signal
      if (s.tags.includes(term)) score += 5
    }
    if (score === 0) continue

    const daysOld = Math.max(0, (now - s.lastModified) / (1000 * 60 * 60 * 24))
    const recencyBoost = 1 / (1 + Math.log(1 + daysOld))
    // Summary-match boost — these are curated
    const finalScore = score * 2.0 * (0.7 + 0.3 * recencyBoost)

    matchMap.set(s.sessionId, {
      sessionId: s.sessionId,
      projectSlug: s.projectSlug,
      score: finalScore,
      lastModified: s.lastModified,
      messageCount: s.messageCount,
      snippet: s.summary,
      preview: s.firstUserMessage,
      summary: s.summary,
      tags: s.tags,
    })
  }

  // Pass 2: raw session files (slower; do this only for sessions not in matchMap
  // or to refine scores)
  const files = await listSessionFiles()
  for (const f of files) {
    const sessionId = f.path.split(/[\\/]/).pop()!.replace(/\.jsonl$/, '')
    // Skip if we already have a strong match from summary and this file isn't newer
    if (matchMap.has(sessionId)) continue

    const r = await scoreSession(terms, f.path)
    if (r.score === 0) continue

    const daysOld = Math.max(0, (now - f.mtime) / (1000 * 60 * 60 * 24))
    const recencyBoost = 1 / (1 + Math.log(1 + daysOld))
    const finalScore = r.score * (0.7 + 0.3 * recencyBoost)

    matchMap.set(sessionId, {
      sessionId,
      projectSlug: f.slug,
      score: finalScore,
      lastModified: f.mtime,
      messageCount: r.messageCount,
      snippet: r.snippet,
      preview: r.preview,
    })
  }

  const results = Array.from(matchMap.values())
  results.sort((a, b) => b.score - a.score)

  // RRF rerank when embeddings are available — fuses keyword + summary
  // scoring (already in `results`) with semantic vector cosine. Multiplies
  // the fused rank by per-session effectiveness so successful past
  // recalls drift to the top over time.
  const reranked = await maybeRerankWithRRF(query, results)
  const final = (reranked ?? results).slice(0, limit)

  // Log retrievals for the effectiveness loop. Best-effort.
  try {
    const { recordRetrieval } = await import('../memory/effectiveness.js')
    for (const m of final) recordRetrieval(m.sessionId, 'session')
  } catch { /* non-critical */ }

  return final
}

async function maybeRerankWithRRF(
  query: string,
  candidates: SessionMatch[],
): Promise<SessionMatch[] | null> {
  if (candidates.length === 0) return null
  try {
    const { isEmbeddingAvailable, embedSimilarity } = await import('../memory/embedding.js')
    if (!(await isEmbeddingAvailable())) return null

    // Original ranking (by current score) provides one signal
    const origRank = new Map<string, number>()
    candidates.forEach((c, i) => origRank.set(c.sessionId, i + 1))

    // Embedding ranking provides the second
    const slice = candidates.slice(0, 50)
    const docTexts = slice.map(c =>
      [c.summary, c.snippet, c.preview, c.tags?.join(' ')].filter(Boolean).join('\n'),
    )
    const sims = await embedSimilarity(query, docTexts)
    if (!sims) return null
    const embedRank = new Map<string, number>()
    slice
      .map((c, i) => ({ id: c.sessionId, sim: sims[i]! }))
      .sort((a, b) => b.sim - a.sim)
      .forEach((entry, i) => embedRank.set(entry.id, i + 1))

    const { getEffectivenessMap } = await import('../memory/effectiveness.js')
    const effMap = await getEffectivenessMap(candidates.map(c => c.sessionId))
    const RRF_K = 60

    const fused = candidates.map(c => {
      const oRank = origRank.get(c.sessionId)
      const eRank = embedRank.get(c.sessionId)
      let rrf = 0
      if (oRank !== undefined) rrf += 1 / (RRF_K + oRank)
      if (eRank !== undefined) rrf += 1 / (RRF_K + eRank)
      const eff = effMap[c.sessionId] ?? 0.5
      return { ...c, score: rrf * eff }
    })
    fused.sort((a, b) => b.score - a.score)
    return fused
  } catch {
    return null
  }
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
