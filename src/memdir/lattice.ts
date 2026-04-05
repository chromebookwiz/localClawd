/**
 * Lattice-based memory relevance scoring.
 *
 * A memory lattice is a partially ordered set where each memory node occupies
 * a position in a multidimensional tag space. Two nodes are ordered if one's
 * tag set is a subset of the other's (more specific ≤ more general). The
 * lattice operations are:
 *   meet(A, B) = A ∩ B  (greatest lower bound — shared subtopic)
 *   join(A, B) = A ∪ B  (least upper bound   — common ancestor topic)
 *
 * Relevance scoring combines:
 *   1. Jaccard similarity  |A ∩ B| / |A ∪ B|  — direct tag overlap
 *   2. Co-occurrence bonus — tags that appear together often suggest
 *      semantic proximity in the lattice even without an exact match
 *   3. Type affinity boost — memories whose type (user/feedback/project/
 *      reference) matches the inferred query intent score higher
 *
 * This lets memories about related topics surface together even when they
 * don't share every tag with the query. For example, a query tagged
 * [database, migrations] will score [database, rollback] higher than a
 * completely disjoint memory, because they share the "database" lattice
 * dimension.
 *
 * Usage (local-model-friendly fallback when sideQuery is unavailable):
 *   const tags = extractQueryTags(userQuery)
 *   const index = buildCooccurrenceIndex(memories)
 *   const ranked = rankByLatticeRelevance(tags, memories, index)
 */

import type { MemoryHeader } from './memoryScan.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TagCooccurrenceIndex = Map<string, Map<string, number>>

export type ScoredMemory = MemoryHeader & {
  latticeScore: number
  /** Tags parsed from this memory's frontmatter */
  tags: readonly string[]
}

// ---------------------------------------------------------------------------
// Tag extraction
// ---------------------------------------------------------------------------

/**
 * Parse a comma- or space-separated tags string from frontmatter into a
 * normalized lowercase array. Accepts either a raw string ("foo, bar baz")
 * or a pre-split array (YAML list). Returns [] on missing/invalid input.
 */
export function parseTags(raw: unknown): string[] {
  if (!raw) return []
  if (Array.isArray(raw)) {
    return raw
      .filter((t): t is string => typeof t === 'string')
      .map(t => t.trim().toLowerCase())
      .filter(Boolean)
  }
  if (typeof raw === 'string') {
    return raw
      .split(/[,\s]+/)
      .map(t => t.trim().toLowerCase())
      .filter(Boolean)
  }
  return []
}

/**
 * Heuristic: extract candidate search tags from a natural-language query.
 * Strips stop words and returns the remaining lowercase tokens. This is
 * intentionally lightweight — the lattice scoring doesn't require perfect
 * NLP, just enough signal to distinguish memory topics.
 */
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'is', 'it', 'as', 'be', 'was', 'are', 'has', 'have',
  'had', 'do', 'does', 'did', 'will', 'would', 'can', 'could', 'should',
  'may', 'might', 'shall', 'this', 'that', 'these', 'those', 'i', 'you',
  'he', 'she', 'we', 'they', 'what', 'how', 'when', 'where', 'why', 'who',
  'my', 'your', 'his', 'her', 'our', 'its', 'me', 'him', 'us', 'them',
])

export function extractQueryTags(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, ' ')
    .split(/\s+/)
    .map(t => t.trim())
    .filter(t => t.length >= 2 && !STOP_WORDS.has(t))
    .slice(0, 20) // cap to avoid pathological inputs
}

// ---------------------------------------------------------------------------
// Lattice operations
// ---------------------------------------------------------------------------

/**
 * Jaccard similarity: |A ∩ B| / |A ∪ B|.
 * Returns 0 when both sets are empty, 1 when identical.
 * This is the core lattice proximity measure.
 */
export function jaccardSimilarity(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 && b.length === 0) return 0
  const setA = new Set(a)
  const setB = new Set(b)
  let intersection = 0
  for (const t of setA) {
    if (setB.has(t)) intersection++
  }
  const union = setA.size + setB.size - intersection
  return union === 0 ? 0 : intersection / union
}

/**
 * Lattice meet: A ∩ B (greatest lower bound — shared tags).
 */
export function latticeMeet(a: readonly string[], b: readonly string[]): string[] {
  const setB = new Set(b)
  return a.filter(t => setB.has(t))
}

/**
 * Lattice join: A ∪ B (least upper bound — union of topics).
 */
export function latticeJoin(a: readonly string[], b: readonly string[]): string[] {
  return [...new Set([...a, ...b])]
}

// ---------------------------------------------------------------------------
// Co-occurrence index
// ---------------------------------------------------------------------------

/**
 * Build a symmetric tag co-occurrence index from a memory collection.
 * For each pair of tags (t1, t2) that appear in the same memory file,
 * increment count[t1][t2] and count[t2][t1].
 *
 * This captures semantic proximity: if "database" and "migrations" frequently
 * appear together, they are neighbours in the lattice even without an exact
 * tag match.
 */
export function buildCooccurrenceIndex(
  memories: ReadonlyArray<MemoryHeader & { tags: readonly string[] }>,
): TagCooccurrenceIndex {
  const index: TagCooccurrenceIndex = new Map()

  const bump = (t1: string, t2: string) => {
    if (!index.has(t1)) index.set(t1, new Map())
    const row = index.get(t1)!
    row.set(t2, (row.get(t2) ?? 0) + 1)
  }

  for (const mem of memories) {
    const tags = mem.tags
    for (let i = 0; i < tags.length; i++) {
      for (let j = i + 1; j < tags.length; j++) {
        bump(tags[i], tags[j])
        bump(tags[j], tags[i])
      }
    }
  }

  return index
}

/**
 * Co-occurrence bonus: how strongly are the given tag sets related via
 * indirect tag neighbours? Normalised to [0, 1].
 *
 * For each tag in queryTags, look up its co-occurring neighbours and check
 * how many of memoryTags appear there. The sum is normalised by the product
 * of the set sizes (bounded) to avoid penalising memories with many tags.
 */
export function cooccurrenceBonus(
  queryTags: readonly string[],
  memoryTags: readonly string[],
  index: TagCooccurrenceIndex,
): number {
  if (queryTags.length === 0 || memoryTags.length === 0) return 0

  let score = 0
  const memSet = new Set(memoryTags)

  for (const qt of queryTags) {
    const neighbours = index.get(qt)
    if (!neighbours) continue
    for (const mt of memSet) {
      const coCount = neighbours.get(mt) ?? 0
      if (coCount > 0) {
        // Dampen high counts with log to avoid one dominant pair dominating
        score += Math.log1p(coCount)
      }
    }
  }

  // Normalise: divide by max possible (queryTags × memoryTags × log1p(1))
  const maxPossible = queryTags.length * memoryTags.length * Math.log1p(1)
  return maxPossible === 0 ? 0 : Math.min(1, score / maxPossible)
}

// ---------------------------------------------------------------------------
// Combined lattice relevance score
// ---------------------------------------------------------------------------

const JACCARD_WEIGHT = 0.65
const COOCCURRENCE_WEIGHT = 0.25
const RECENCY_WEIGHT = 0.10

/**
 * Compute a combined lattice relevance score for a memory against a query.
 *
 * Score = 0.65 × Jaccard(queryTags, memTags)
 *       + 0.25 × cooccurrenceBonus(queryTags, memTags, index)
 *       + 0.10 × recencyScore(mtimeMs)
 *
 * The recency component ensures recently-modified memories edge out older
 * ones at equal topical relevance (a reasonable default for coding sessions).
 */
export function latticeRelevanceScore(
  queryTags: readonly string[],
  memory: MemoryHeader & { tags: readonly string[] },
  index: TagCooccurrenceIndex,
  nowMs: number = Date.now(),
): number {
  const jaccard = jaccardSimilarity(queryTags, memory.tags)
  const cooc = cooccurrenceBonus(queryTags, memory.tags, index)

  // Recency: exponential decay with 30-day half-life
  const ageMs = Math.max(0, nowMs - memory.mtimeMs)
  const halfLifeMs = 30 * 24 * 60 * 60 * 1000
  const recency = Math.pow(0.5, ageMs / halfLifeMs)

  return JACCARD_WEIGHT * jaccard + COOCCURRENCE_WEIGHT * cooc + RECENCY_WEIGHT * recency
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

/**
 * Rank a set of memories by lattice relevance to the given query tags.
 * Returns all memories sorted descending by score, with their computed tags
 * and score attached. Memories with zero tags get a pure recency score
 * (they can still surface when nothing else is tagged).
 */
export function rankByLatticeRelevance(
  queryTags: readonly string[],
  memories: ReadonlyArray<MemoryHeader & { tags: readonly string[] }>,
  index: TagCooccurrenceIndex,
  nowMs: number = Date.now(),
): ScoredMemory[] {
  return memories
    .map(mem => ({
      ...mem,
      latticeScore: latticeRelevanceScore(queryTags, mem, index, nowMs),
    }))
    .sort((a, b) => b.latticeScore - a.latticeScore)
}

/**
 * Top-level helper: given a raw query string and a list of memory headers
 * (each already carrying a `tags` field), return the top-N most relevant
 * memories using the full lattice pipeline.
 *
 * This is the local-model-friendly fallback for findRelevantMemories when
 * a sideQuery to a hosted model is not available or too expensive.
 */
export function topLatticeMemories(
  query: string,
  memories: ReadonlyArray<MemoryHeader & { tags: readonly string[] }>,
  topN = 5,
): ScoredMemory[] {
  const queryTags = extractQueryTags(query)
  const index = buildCooccurrenceIndex(memories)
  const ranked = rankByLatticeRelevance(queryTags, memories, index)
  // Only return memories that have some relevance signal
  return ranked.filter(m => m.latticeScore > 0).slice(0, topN)
}
