/**
 * Outcome-grounded memory grading.
 *
 * The lattice scores memories by *similarity*. This module adds an
 * orthogonal signal: *did this memory actually help?* When a memory is
 * retrieved (or a skill is invoked), we log the retrieval. When the
 * resulting work succeeds, the retrieved items get a slow upward bump.
 * When it fails or is abandoned, they decay slightly.
 *
 * Stored at ~/.localclawd/memory-effectiveness.json.
 *
 * The effectiveness score is multiplied into the final retrieval rank,
 * so the agent slowly converges on the memories/skills that have
 * actually produced good outcomes for *this user* on *this codebase*.
 */

import { mkdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { logForDebugging } from '../../utils/debug.js'

const EFFECTIVENESS_PATH = join(getClaudeConfigHomeDir(), 'memory-effectiveness.json')

export interface EffectivenessRecord {
  id: string                 // memory id, skill name, or arbitrary tag
  kind: 'memory' | 'skill' | 'session' | 'note' | 'other'
  score: number              // [0, 1] — 0.5 default
  retrievals: number         // total times retrieved
  successes: number          // task-complete signals after retrieval
  failures: number           // needs-input / error after retrieval
  firstSeen: number
  lastUpdated: number
}

interface EffectivenessFile {
  version: 1
  records: Record<string, EffectivenessRecord>
}

const DEFAULT_SCORE = 0.5
const SUCCESS_LR = 0.05    // exponential moving average rate on success
const FAILURE_LR = 0.04    // slightly slower on failure (forgiving)
const MIN_SCORE = 0.05     // never zero out — leave room for redemption
const MAX_SCORE = 1.0

// In-memory state: pending retrievals for the current task. Updates land
// when markTaskOutcome() fires; reset between tasks.
const _pendingRetrievals: Map<string, EffectivenessRecord['kind']> = new Map()

let _cache: EffectivenessFile | null = null

async function load(): Promise<EffectivenessFile> {
  if (_cache) return _cache
  try {
    const raw = await readFile(EFFECTIVENESS_PATH, 'utf-8')
    const parsed = JSON.parse(raw) as EffectivenessFile
    if (parsed.version === 1) { _cache = parsed; return parsed }
  } catch { /* fresh */ }
  _cache = { version: 1, records: {} }
  return _cache
}

async function save(file: EffectivenessFile): Promise<void> {
  await mkdir(getClaudeConfigHomeDir(), { recursive: true })
  await writeFile(EFFECTIVENESS_PATH, JSON.stringify(file, null, 2), 'utf-8')
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Record that a memory/skill/session was retrieved as part of the
 * current task. Multiple retrievals of the same id within one task
 * count once. Reset by markTaskOutcome().
 */
export function recordRetrieval(
  id: string,
  kind: EffectivenessRecord['kind'] = 'memory',
): void {
  if (!id) return
  if (!_pendingRetrievals.has(id)) _pendingRetrievals.set(id, kind)
}

/**
 * Apply an outcome update to all retrievals logged since the last
 * markTaskOutcome call. Call on TASK COMPLETE (success), NEEDS INPUT
 * (failure / abandoned), or any other definitive turn-end signal.
 */
export async function markTaskOutcome(
  outcome: 'success' | 'failure' | 'partial',
): Promise<void> {
  if (_pendingRetrievals.size === 0) return
  const file = await load()
  const now = Date.now()

  for (const [id, kind] of _pendingRetrievals) {
    const rec = file.records[id] ?? {
      id, kind,
      score: DEFAULT_SCORE,
      retrievals: 0, successes: 0, failures: 0,
      firstSeen: now,
      lastUpdated: now,
    }
    rec.retrievals++

    if (outcome === 'success') {
      rec.successes++
      // EMA toward 1.0
      rec.score = Math.min(MAX_SCORE, rec.score * (1 - SUCCESS_LR) + 1.0 * SUCCESS_LR)
    } else if (outcome === 'failure') {
      rec.failures++
      // EMA toward 0
      rec.score = Math.max(MIN_SCORE, rec.score * (1 - FAILURE_LR))
    } else {
      // 'partial' — small upward nudge, less than success
      rec.score = Math.min(MAX_SCORE, rec.score * (1 - SUCCESS_LR / 2) + 1.0 * (SUCCESS_LR / 2))
    }

    rec.lastUpdated = now
    file.records[id] = rec
  }

  _pendingRetrievals.clear()
  try {
    await save(file)
  } catch (e) {
    logForDebugging(`[effectiveness] save failed: ${e}`)
  }
}

/**
 * Return effectiveness in [MIN_SCORE, MAX_SCORE]. Items that have
 * never been retrieved get the default 0.5 — neither rewarded nor
 * penalized.
 */
export async function getEffectiveness(id: string): Promise<number> {
  const file = await load()
  return file.records[id]?.score ?? DEFAULT_SCORE
}

/** Bulk lookup for retrieval ranking. */
export async function getEffectivenessMap(
  ids: readonly string[],
): Promise<Record<string, number>> {
  const file = await load()
  const out: Record<string, number> = {}
  for (const id of ids) {
    out[id] = file.records[id]?.score ?? DEFAULT_SCORE
  }
  return out
}

/** All graded items, sorted by score desc. Used by /memory-stats. */
export async function listGraded(): Promise<EffectivenessRecord[]> {
  const file = await load()
  return Object.values(file.records).sort((a, b) => b.score - a.score)
}

/** Discard current task's pending retrievals without committing. */
export function discardPending(): void {
  _pendingRetrievals.clear()
}

/** Snapshot of pending retrievals (for diagnostics). */
export function pendingCount(): number {
  return _pendingRetrievals.size
}
