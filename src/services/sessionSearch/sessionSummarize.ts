/**
 * Session summarization — condense .jsonl session files into short
 * summaries the search index can use for cross-session recall.
 *
 * Reads a session, assembles a compact transcript, asks the local LLM
 * for a 3-sentence summary + tag list, and writes the result to:
 *   ~/.claude/session-summaries/<session-id>.json
 *
 * The summary file format:
 *   {
 *     sessionId, projectSlug, lastModified, messageCount,
 *     summary, tags, firstUserMessage
 *   }
 */

import { readdir, readFile, writeFile, mkdir, stat } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'
import { logForDebugging } from '../../utils/debug.js'
import {
  getLocalLLMBaseUrl,
  getLocalLLMModel,
  getLocalLLMApiKey,
} from '../../utils/model/providers.js'

const PROJECTS_DIR = join(homedir(), '.claude', 'projects')
const SUMMARIES_DIR = join(homedir(), '.claude', 'session-summaries')
const MAX_TRANSCRIPT_CHARS = 12_000

export interface SessionSummary {
  sessionId: string
  projectSlug: string
  lastModified: number
  messageCount: number
  summary: string
  tags: string[]
  firstUserMessage: string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

async function listUnsummarized(): Promise<Array<{ slug: string; sessionId: string; path: string; mtime: number }>> {
  const result: Array<{ slug: string; sessionId: string; path: string; mtime: number }> = []
  let slugs: string[]
  try { slugs = await readdir(PROJECTS_DIR) } catch { return result }

  // Existing summaries by id (mtime is used to detect stale summaries)
  const existing = new Map<string, number>()
  try {
    const files = await readdir(SUMMARIES_DIR)
    for (const f of files) {
      if (!f.endsWith('.json')) continue
      const s = await stat(join(SUMMARIES_DIR, f)).catch(() => null)
      if (s) existing.set(f.replace(/\.json$/, ''), s.mtimeMs)
    }
  } catch { /* dir doesn't exist yet */ }

  for (const slug of slugs) {
    const slugDir = join(PROJECTS_DIR, slug)
    try {
      const entries = await readdir(slugDir)
      for (const entry of entries) {
        if (!entry.endsWith('.jsonl')) continue
        const sessionId = entry.replace(/\.jsonl$/, '')
        const full = join(slugDir, entry)
        const s = await stat(full).catch(() => null)
        if (!s) continue
        const existingMtime = existing.get(sessionId)
        if (existingMtime && existingMtime >= s.mtimeMs) continue  // up-to-date
        result.push({ slug, sessionId, path: full, mtime: s.mtimeMs })
      }
    } catch { /* skip */ }
  }

  return result
}

function buildTranscript(content: string): { transcript: string; messageCount: number; firstUser: string } {
  const lines = content.split('\n').filter(Boolean)
  const parts: string[] = []
  let firstUser = ''
  let used = 0

  for (const line of lines) {
    let parsed: {
      role?: string
      type?: string
      message?: { role?: string; content?: unknown }
    }
    try { parsed = JSON.parse(line) } catch { continue }

    const role = parsed.role ?? parsed.message?.role ?? parsed.type ?? 'unknown'
    const text = extractText(parsed).trim().replace(/\s+/g, ' ')
    if (!text) continue

    if (!firstUser && role === 'user') firstUser = text.slice(0, 300)

    const snippet = `[${role}] ${text.slice(0, 500)}`
    if (used + snippet.length > MAX_TRANSCRIPT_CHARS) break
    parts.push(snippet)
    used += snippet.length + 1
  }

  return { transcript: parts.join('\n'), messageCount: lines.length, firstUser }
}

// ─── LLM call ────────────────────────────────────────────────────────────────

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
        max_tokens: 400,
        temperature: 0.2,
      }),
      signal: AbortSignal.timeout(60_000),
    })
    if (!res.ok) return null
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    return data.choices?.[0]?.message?.content ?? null
  } catch (e) {
    logForDebugging(`[session-summarize] LLM call failed: ${e}`)
    return null
  }
}

function parseSummaryResponse(text: string): { summary: string; tags: string[] } {
  // Look for a SUMMARY: and TAGS: block; otherwise treat whole text as summary
  const summaryMatch = text.match(/SUMMARY:\s*([\s\S]*?)(?:\n\s*TAGS:|$)/i)
  const tagsMatch = text.match(/TAGS:\s*([^\n]+)/i)

  const summary = (summaryMatch?.[1] ?? text).trim().slice(0, 600)
  const tags = (tagsMatch?.[1] ?? '')
    .split(/[,;]/)
    .map(t => t.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 8)

  return { summary, tags }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function summarizeSession(
  sessionId: string,
  slug: string,
  filePath: string,
  mtime: number,
): Promise<SessionSummary | null> {
  const content = await readFile(filePath, 'utf-8').catch(() => '')
  if (!content) return null

  const { transcript, messageCount, firstUser } = buildTranscript(content)
  if (!transcript) return null

  const prompt =
    `Below is a compressed transcript of a coding session. ` +
    `Summarize it in 2-3 sentences (what was being worked on, what was decided, ` +
    `what got done), then list 3-6 short lowercase tags for searching.\n\n` +
    `Respond in this exact format:\nSUMMARY: <text>\nTAGS: tag1, tag2, tag3\n\n` +
    `Transcript:\n${transcript}`

  const response = await callLLM(prompt)
  if (!response) return null

  const { summary, tags } = parseSummaryResponse(response)
  if (!summary) return null

  return {
    sessionId,
    projectSlug: slug,
    lastModified: mtime,
    messageCount,
    summary,
    tags,
    firstUserMessage: firstUser,
  }
}

export async function summarizeAllPending(
  limit: number = 20,
  onProgress?: (current: number, total: number, sessionId: string) => void,
): Promise<{ summarized: number; skipped: number }> {
  await mkdir(SUMMARIES_DIR, { recursive: true })
  const pending = await listUnsummarized()
  // Newest first so recent sessions get summarized when limit caps us
  pending.sort((a, b) => b.mtime - a.mtime)
  const slice = pending.slice(0, limit)

  let summarized = 0
  let skipped = 0
  for (let i = 0; i < slice.length; i++) {
    const p = slice[i]!
    onProgress?.(i + 1, slice.length, p.sessionId)
    const summary = await summarizeSession(p.sessionId, p.slug, p.path, p.mtime)
    if (!summary) {
      skipped++
      continue
    }
    try {
      await writeFile(
        join(SUMMARIES_DIR, `${p.sessionId}.json`),
        JSON.stringify(summary, null, 2),
        'utf-8',
      )
      summarized++
    } catch (e) {
      logForDebugging(`[session-summarize] write failed: ${e}`)
      skipped++
    }
  }

  return { summarized, skipped }
}

export async function loadAllSummaries(): Promise<SessionSummary[]> {
  try {
    const files = await readdir(SUMMARIES_DIR)
    const summaries: SessionSummary[] = []
    for (const f of files) {
      if (!f.endsWith('.json')) continue
      try {
        const raw = await readFile(join(SUMMARIES_DIR, f), 'utf-8')
        summaries.push(JSON.parse(raw) as SessionSummary)
      } catch { /* skip */ }
    }
    return summaries
  } catch {
    return []
  }
}
