/**
 * Memory pruner — keeps the memory store from growing without bound.
 *
 * Composite score for each indexed item:
 *
 *   pruneScore(m) = effectiveness(m) × recencyFactor(m) × usefulnessFactor(m)
 *
 *     recencyFactor    = 1 / (1 + log(1 + days_since_last_seen))
 *     usefulnessFactor = log(1 + retrievals)
 *
 * Items below the cutoff are removed from the E8 region index, the
 * effectiveness store, and (if applicable) the lattice/markdown
 * memory directory.
 *
 * Pruning runs:
 *   - on demand via /memory-prune
 *   - automatically every N memory additions (set via PRUNE_TRIGGER_COUNT)
 *   - on a daily cadence by the scheduler service
 *
 * The user's curated `memory/*.md` lattice files are NEVER auto-deleted —
 * those are user-edited content. We only prune the *index entries* and
 * the auto-generated session summaries / trajectories.
 */

import { mkdir, readFile, readdir, stat, unlink, writeFile } from 'fs/promises'
import { join } from 'path'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { logForDebugging } from '../../utils/debug.js'
import { listGraded } from './effectiveness.js'
import { removeFromIndex, indexStats } from './e8RegionIndex.js'

const STATE_PATH = join(getClaudeConfigHomeDir(), 'pruner-state.json')
const SUMMARIES_DIR = join(getClaudeConfigHomeDir(), 'session-summaries')
const TRAJECTORIES_DIR = join(getClaudeConfigHomeDir(), 'trajectories')

interface PrunerState {
  version: 1
  lastRun: number
  totalPruned: number
  additionsSinceLastRun: number
}

export interface PruneOptions {
  /** Maximum total items the index should hold. Defaults to 2000. */
  capacity?: number
  /**
   * Target retention ratio after pruning — pruner removes the worst
   * (1 - keepRatio) items when over capacity. Default 0.85, so a
   * pruning run drops the bottom ~15% when triggered.
   */
  keepRatio?: number
  /** If true, remove session-summary + trajectory files for pruned IDs. */
  removeArtifacts?: boolean
  /** Force a run even if not over capacity. */
  force?: boolean
}

const DEFAULT_OPTS: Required<Omit<PruneOptions, 'force'>> & { force: boolean } = {
  capacity: 2000,
  keepRatio: 0.85,
  removeArtifacts: true,
  force: false,
}

// ─── State I/O ──────────────────────────────────────────────────────────────

async function loadState(): Promise<PrunerState> {
  try {
    const raw = await readFile(STATE_PATH, 'utf-8')
    const parsed = JSON.parse(raw) as PrunerState
    if (parsed.version === 1) return parsed
  } catch { /* fresh */ }
  return { version: 1, lastRun: 0, totalPruned: 0, additionsSinceLastRun: 0 }
}

async function saveState(state: PrunerState): Promise<void> {
  await mkdir(getClaudeConfigHomeDir(), { recursive: true })
  await writeFile(STATE_PATH, JSON.stringify(state, null, 2), 'utf-8')
}

// ─── Composite scoring ──────────────────────────────────────────────────────

interface ScoredItem {
  id: string
  pruneScore: number
  effectiveness: number
  retrievals: number
  daysSinceLastSeen: number
}

function computePruneScore(
  effectiveness: number,
  retrievals: number,
  lastUpdated: number,
  now: number,
): number {
  const daysSince = Math.max(0, (now - lastUpdated) / (24 * 60 * 60 * 1000))
  const recency = 1 / (1 + Math.log(1 + daysSince))
  const usefulness = Math.log(1 + retrievals)
  // Effectiveness alone shouldn't pin a never-used item to the floor;
  // add a small constant so brand-new items survive their first prune.
  return (effectiveness + 0.1) * recency * (1 + usefulness)
}

// ─── Public API ─────────────────────────────────────────────────────────────

/** Increment the addition counter; trigger an auto-prune if threshold hit. */
export async function notifyMemoryAdded(): Promise<void> {
  const state = await loadState()
  state.additionsSinceLastRun++
  await saveState(state)
  if (state.additionsSinceLastRun >= 50) {
    void prune({}).catch(() => {})
  }
}

/**
 * Run a pruning pass. Returns the number of items removed.
 */
export async function prune(opts: PruneOptions = {}): Promise<{
  pruned: number
  kept: number
  reason: 'over-capacity' | 'forced' | 'under-capacity'
}> {
  const o = { ...DEFAULT_OPTS, ...opts }
  const state = await loadState()
  const now = Date.now()

  const graded = await listGraded()
  const stats = await indexStats()

  // Population to consider: graded items (memories/skills/sessions tracked
  // by the effectiveness store). Items not yet graded are exempt — we
  // need at least one observation before judging.
  const items: ScoredItem[] = graded.map(r => ({
    id: r.id,
    pruneScore: computePruneScore(r.score, r.retrievals, r.lastUpdated, now),
    effectiveness: r.score,
    retrievals: r.retrievals,
    daysSinceLastSeen: (now - r.lastUpdated) / (24 * 60 * 60 * 1000),
  }))

  const total = Math.max(stats.memories, items.length)
  if (!o.force && total <= o.capacity) {
    state.lastRun = now
    state.additionsSinceLastRun = 0
    await saveState(state)
    return { pruned: 0, kept: total, reason: 'under-capacity' }
  }

  // Decide how many to remove.
  const target = Math.floor(o.capacity * o.keepRatio)
  const toRemove = Math.max(0, items.length - target)
  if (toRemove === 0) {
    state.lastRun = now
    state.additionsSinceLastRun = 0
    await saveState(state)
    return { pruned: 0, kept: items.length, reason: 'under-capacity' }
  }

  items.sort((a, b) => a.pruneScore - b.pruneScore)
  const losers = items.slice(0, toRemove)

  let actuallyPruned = 0
  for (const item of losers) {
    try {
      await removeFromIndex(item.id)
      if (o.removeArtifacts) {
        await removeArtifacts(item.id)
      }
      actuallyPruned++
    } catch (e) {
      logForDebugging(`[pruner] failed to remove ${item.id}: ${e}`)
    }
  }

  // Also prune from the effectiveness store itself
  if (actuallyPruned > 0) {
    await removeFromEffectivenessStore(losers.map(l => l.id))
  }

  state.lastRun = now
  state.additionsSinceLastRun = 0
  state.totalPruned += actuallyPruned
  await saveState(state)

  logForDebugging(`[pruner] removed ${actuallyPruned} items (capacity=${o.capacity})`)
  return {
    pruned: actuallyPruned,
    kept: items.length - actuallyPruned,
    reason: o.force ? 'forced' : 'over-capacity',
  }
}

async function removeArtifacts(id: string): Promise<void> {
  // Auto-generated artifacts named after a session id
  const candidates = [
    join(SUMMARIES_DIR, `${id}.json`),
    join(TRAJECTORIES_DIR, `${id}.json`),
  ]
  for (const path of candidates) {
    try { await unlink(path) } catch { /* not present */ }
  }
}

async function removeFromEffectivenessStore(ids: readonly string[]): Promise<void> {
  // We don't import the effectiveness module's internal save() — instead
  // we rewrite the file ourselves. Slight duplication is fine; both
  // shapes are stable.
  const path = join(getClaudeConfigHomeDir(), 'memory-effectiveness.json')
  let raw: string
  try { raw = await readFile(path, 'utf-8') } catch { return }
  let parsed: { version: 1; records: Record<string, unknown> }
  try { parsed = JSON.parse(raw) } catch { return }
  const removeSet = new Set(ids)
  for (const id of removeSet) delete parsed.records[id]
  try { await writeFile(path, JSON.stringify(parsed, null, 2), 'utf-8') } catch { /* ignore */ }
}

/** For the /memory-stats UI. */
export async function getPrunerState(): Promise<PrunerState & {
  graded: number
  indexed: number
}> {
  const state = await loadState()
  const graded = (await listGraded()).length
  const stats = await indexStats()
  return { ...state, graded, indexed: stats.memories }
}

// Suppress unused-import warning — these helpers are exposed for callers
void readdir
void stat
