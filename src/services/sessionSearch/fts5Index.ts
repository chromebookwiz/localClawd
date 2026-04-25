/**
 * FTS5 session-search backend — uses Node's built-in `node:sqlite` if
 * available (Node 22.5+ experimental, stable in 23+). Gracefully no-ops
 * on older Node so the existing term-scored path still works.
 *
 * Index lives at ~/.claude/sessions.db. Schema:
 *
 *   CREATE VIRTUAL TABLE summaries USING fts5(
 *     session_id UNINDEXED,
 *     project_slug UNINDEXED,
 *     summary, tags, first_user, last_modified UNINDEXED
 *   );
 *
 * Populated from ~/.claude/session-summaries/*.json. Incremental:
 * `rebuild()` adds rows that aren't already in the index, removes rows
 * for files that have disappeared, refreshes rows where the source file
 * is newer than the indexed copy.
 */

import { readdir, readFile, stat } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'
import { logForDebugging } from '../../utils/debug.js'

const DB_PATH = join(homedir(), '.claude', 'sessions.db')
const SUMMARIES_DIR = join(homedir(), '.claude', 'session-summaries')

interface SqliteDatabase {
  exec(sql: string): void
  prepare(sql: string): SqliteStatement
  close(): void
}

interface SqliteStatement {
  all(...params: unknown[]): unknown[]
  get(...params: unknown[]): unknown
  run(...params: unknown[]): { changes: number }
}

let _db: SqliteDatabase | null = null
let _available: boolean | null = null

/** Feature-detect node:sqlite. Returns null if unavailable. */
async function tryOpenDatabase(): Promise<SqliteDatabase | null> {
  if (_db) return _db
  if (_available === false) return null
  try {
    // Dynamic import so older Node doesn't crash at parse time
    const mod = await import('node:sqlite' as string)
    const { DatabaseSync } = mod as { DatabaseSync: new (path: string) => SqliteDatabase }
    const db = new DatabaseSync(DB_PATH)

    // Probe FTS5 — if missing, the build doesn't include FTS5 and we fall back.
    try {
      db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS summaries USING fts5(
        session_id UNINDEXED,
        project_slug UNINDEXED,
        summary,
        tags,
        first_user,
        last_modified UNINDEXED
      );`)
    } catch (e) {
      logForDebugging(`[fts5] FTS5 not compiled into sqlite: ${e}`)
      db.close()
      _available = false
      return null
    }

    db.exec(`CREATE TABLE IF NOT EXISTS index_meta (
      session_id TEXT PRIMARY KEY,
      indexed_mtime REAL NOT NULL
    );`)

    _db = db
    _available = true
    logForDebugging(`[fts5] Opened ${DB_PATH}`)
    return db
  } catch (e) {
    logForDebugging(`[fts5] node:sqlite unavailable: ${e}`)
    _available = false
    return null
  }
}

export async function isFts5Available(): Promise<boolean> {
  return (await tryOpenDatabase()) !== null
}

export interface IndexedSummary {
  sessionId: string
  projectSlug: string
  summary: string
  tags: string[]
  firstUser: string
  lastModified: number
}

interface SummaryFile {
  sessionId: string
  projectSlug: string
  summary: string
  tags: string[]
  firstUserMessage: string
  lastModified: number
}

/**
 * Refresh the index from ~/.claude/session-summaries/. Adds new rows,
 * deletes rows whose source file is gone, replaces rows whose source
 * is newer than the indexed copy.
 *
 * Returns a status report. No-op on non-FTS5 hosts (returns added/removed=0).
 */
export async function rebuildIndex(): Promise<{
  available: boolean
  added: number
  removed: number
  refreshed: number
}> {
  const db = await tryOpenDatabase()
  if (!db) return { available: false, added: 0, removed: 0, refreshed: 0 }

  // Collect indexed state
  const indexed = new Map<string, number>()
  for (const row of db.prepare('SELECT session_id, indexed_mtime FROM index_meta').all() as Array<{ session_id: string; indexed_mtime: number }>) {
    indexed.set(row.session_id, row.indexed_mtime)
  }

  // Walk summaries directory
  let entries: string[]
  try { entries = await readdir(SUMMARIES_DIR) } catch { return { available: true, added: 0, removed: 0, refreshed: 0 } }

  const seen = new Set<string>()
  let added = 0
  let refreshed = 0

  const insertStmt = db.prepare(
    'INSERT INTO summaries (session_id, project_slug, summary, tags, first_user, last_modified) VALUES (?, ?, ?, ?, ?, ?)',
  )
  const deleteStmt = db.prepare('DELETE FROM summaries WHERE session_id = ?')
  const upsertMetaStmt = db.prepare(
    'INSERT INTO index_meta (session_id, indexed_mtime) VALUES (?, ?) ON CONFLICT(session_id) DO UPDATE SET indexed_mtime=excluded.indexed_mtime',
  )
  const deleteMetaStmt = db.prepare('DELETE FROM index_meta WHERE session_id = ?')

  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue
    const sessionId = entry.replace(/\.json$/, '')
    seen.add(sessionId)
    const filePath = join(SUMMARIES_DIR, entry)
    let s: { mtimeMs: number }
    try { s = await stat(filePath) } catch { continue }

    const indexedMtime = indexed.get(sessionId)
    if (indexedMtime !== undefined && indexedMtime >= s.mtimeMs) continue  // up to date

    let raw: string
    try { raw = await readFile(filePath, 'utf-8') } catch { continue }
    let parsed: SummaryFile
    try { parsed = JSON.parse(raw) as SummaryFile } catch { continue }

    if (indexedMtime !== undefined) {
      deleteStmt.run(sessionId)
      refreshed++
    } else {
      added++
    }

    insertStmt.run(
      sessionId,
      parsed.projectSlug,
      parsed.summary,
      parsed.tags.join(' '),
      parsed.firstUserMessage ?? '',
      parsed.lastModified,
    )
    upsertMetaStmt.run(sessionId, s.mtimeMs)
  }

  // Remove entries for files that no longer exist
  let removed = 0
  for (const [sessionId] of indexed) {
    if (seen.has(sessionId)) continue
    deleteStmt.run(sessionId)
    deleteMetaStmt.run(sessionId)
    removed++
  }

  return { available: true, added, removed, refreshed }
}

export interface Fts5SearchHit {
  sessionId: string
  projectSlug: string
  summary: string
  tags: string[]
  firstUser: string
  lastModified: number
  score: number
}

/**
 * Run an FTS5 query. The query string supports FTS5 syntax (phrases,
 * NEAR, OR, prefix searches with *). We sanitize quotes to avoid syntax
 * errors when the user types them literally.
 *
 * Returns null when FTS5 is unavailable so callers can fall back.
 */
export async function searchFts5(
  query: string,
  limit: number = 10,
): Promise<Fts5SearchHit[] | null> {
  const db = await tryOpenDatabase()
  if (!db) return null

  // FTS5 query syntax: split on whitespace and quote each term to allow
  // mixed-case and avoid accidental operator interpretation.
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .map(t => t.replace(/[^a-z0-9_]+/g, ''))
    .filter(t => t.length >= 2)
  if (terms.length === 0) return []

  const fts5Query = terms.map(t => `"${t}"*`).join(' OR ')

  try {
    const rows = db.prepare(
      `SELECT session_id, project_slug, summary, tags, first_user, last_modified, bm25(summaries) AS score
       FROM summaries WHERE summaries MATCH ?
       ORDER BY score LIMIT ?`,
    ).all(fts5Query, limit) as Array<{
      session_id: string
      project_slug: string
      summary: string
      tags: string
      first_user: string
      last_modified: number
      score: number
    }>

    return rows.map(r => ({
      sessionId: r.session_id,
      projectSlug: r.project_slug,
      summary: r.summary,
      tags: r.tags.split(/\s+/).filter(Boolean),
      firstUser: r.first_user,
      lastModified: r.last_modified,
      score: -r.score,  // bm25 returns negative-better; flip so higher = better
    }))
  } catch (e) {
    logForDebugging(`[fts5] search error: ${e}`)
    return null
  }
}
