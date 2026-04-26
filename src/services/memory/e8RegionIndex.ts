/**
 * E8 region index — maps memory embeddings to E8 bucket signatures
 * so retrieval can fast-filter by conceptual region before doing the
 * expensive cosine pass.
 *
 * The index is a JSON file: { sig → [{id, lastSeen}], …}.
 * Stored at ~/.localclawd/e8-regions.json.
 *
 * Workflow:
 *   1. memory is added/touched → embedText → e8BucketSignature
 *      → upsert into the right region bucket
 *   2. query comes in → embed query → query signature
 *      → return all memories from buckets within distance ≤ MAX_TILE_DIFF
 *      → (caller does cosine refinement on this candidate set)
 *
 * For 4 tiles, MAX_TILE_DIFF=1 means "concept region exactly matches
 * in 3 of 4 tiles" — a reasonable recall floor while staying selective.
 */

import { mkdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { embedText } from './embedding.js'
import { e8BucketSignature, signatureDistance } from './e8Lattice.js'

const INDEX_PATH = join(getClaudeConfigHomeDir(), 'e8-regions.json')

interface RegionEntry {
  id: string
  lastSeen: number
}

interface IndexFile {
  version: 1
  // bucket signature → list of memory IDs in that bucket
  regions: Record<string, RegionEntry[]>
  // memory ID → its current bucket signature (so we can move it on update)
  byId: Record<string, string>
}

let _cache: IndexFile | null = null

async function load(): Promise<IndexFile> {
  if (_cache) return _cache
  try {
    const raw = await readFile(INDEX_PATH, 'utf-8')
    const parsed = JSON.parse(raw) as IndexFile
    if (parsed.version === 1) { _cache = parsed; return parsed }
  } catch { /* fresh */ }
  _cache = { version: 1, regions: {}, byId: {} }
  return _cache
}

async function save(file: IndexFile): Promise<void> {
  await mkdir(getClaudeConfigHomeDir(), { recursive: true })
  await writeFile(INDEX_PATH, JSON.stringify(file), 'utf-8')
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Index a memory under its E8 region signature. If embeddings aren't
 * available, this is a no-op — the index will be empty and queries
 * will simply return no candidates (the caller falls back).
 */
export async function indexMemory(
  id: string,
  text: string,
): Promise<{ ok: true; signature: string } | { ok: false; reason: string }> {
  const vec = await embedText(text)
  if (!vec) return { ok: false, reason: 'embeddings unavailable' }
  const sig = e8BucketSignature(vec)
  if (!sig) return { ok: false, reason: 'empty signature' }

  const file = await load()
  const now = Date.now()

  // Move from old bucket if present
  const previousSig = file.byId[id]
  if (previousSig && previousSig !== sig) {
    const old = file.regions[previousSig]
    if (old) {
      file.regions[previousSig] = old.filter(e => e.id !== id)
      if (file.regions[previousSig]!.length === 0) delete file.regions[previousSig]
    }
  }

  // Upsert into the new bucket
  const bucket = file.regions[sig] ?? []
  const existing = bucket.find(e => e.id === id)
  if (existing) existing.lastSeen = now
  else bucket.push({ id, lastSeen: now })
  file.regions[sig] = bucket
  file.byId[id] = sig

  await save(file)
  return { ok: true, signature: sig }
}

/**
 * Remove a memory from the index. Used by the pruner.
 */
export async function removeFromIndex(id: string): Promise<void> {
  const file = await load()
  const sig = file.byId[id]
  if (!sig) return
  const bucket = file.regions[sig]
  if (bucket) {
    file.regions[sig] = bucket.filter(e => e.id !== id)
    if (file.regions[sig]!.length === 0) delete file.regions[sig]
  }
  delete file.byId[id]
  await save(file)
}

/**
 * Find candidate memory IDs whose E8 region is at most `maxTileDiff`
 * tiles away from the query's region. Returns IDs sorted by tile
 * distance ascending (closest concept regions first).
 *
 * The caller should run an embedding-cosine refinement pass over
 * these candidates rather than over every memory.
 */
export async function findCandidates(
  queryText: string,
  maxTileDiff: number = 1,
  limit: number = 50,
): Promise<Array<{ id: string; tileDistance: number }>> {
  const vec = await embedText(queryText)
  if (!vec) return []
  const querySig = e8BucketSignature(vec)
  if (!querySig) return []

  const file = await load()
  const out: Array<{ id: string; tileDistance: number }> = []
  for (const [sig, entries] of Object.entries(file.regions)) {
    const dist = signatureDistance(querySig, sig)
    if (dist > maxTileDiff) continue
    for (const e of entries) {
      out.push({ id: e.id, tileDistance: dist })
    }
  }
  out.sort((a, b) => a.tileDistance - b.tileDistance)
  return out.slice(0, limit)
}

/**
 * Diagnostic: how many distinct concept regions and memories are
 * indexed? Useful for /memory-stats output.
 */
export async function indexStats(): Promise<{
  regions: number
  memories: number
  largestBucket: number
}> {
  const file = await load()
  const sizes = Object.values(file.regions).map(b => b.length)
  return {
    regions: Object.keys(file.regions).length,
    memories: Object.keys(file.byId).length,
    largestBucket: sizes.reduce((m, s) => Math.max(m, s), 0),
  }
}
