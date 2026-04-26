/**
 * Hybrid retrieval — Reciprocal Rank Fusion (RRF) over multiple
 * scoring signals, weighted by effectiveness.
 *
 * RRF is the de-facto modern default for combining heterogeneous
 * rankers (Bruch et al. 2023, "An Analysis of Fusion Functions for
 * Hybrid Retrieval"): no per-signal score normalization needed, and
 * empirically dominates linear combinations on most retrieval tasks.
 *
 *   score(d) = Σ_i  1 / (k + rank_i(d))
 *
 * with k=60 the canonical default. We extend this by multiplying the
 * fused score by an effectiveness factor in [MIN_SCORE, MAX_SCORE]
 * so memories that have actually led to good outcomes drift to the
 * top over time.
 *
 * Signals:
 *   - FTS5 BM25                    (keyword precision)
 *   - Embedding cosine             (semantic similarity, if available)
 *   - Lattice geometric score      (tag-structural similarity)
 *
 * Each signal contributes a ranked list. Items missing from a list
 * just don't contribute that signal's component — no penalty.
 */

import { searchFts5, type Fts5SearchHit } from '../sessionSearch/fts5Index.js'
import { embedSimilarity, isEmbeddingAvailable } from './embedding.js'
import { getEffectivenessMap, recordRetrieval } from './effectiveness.js'
import { findCandidates as findE8Candidates } from './e8RegionIndex.js'

const RRF_K = 60

export interface HybridDoc {
  id: string                        // unique key (session id, memory filename, etc.)
  text: string                      // searchable representation (summary or body)
  metadata?: Record<string, unknown>
}

export interface HybridHit<T extends HybridDoc = HybridDoc> {
  doc: T
  score: number                     // post-effectiveness fused score
  rrfScore: number                  // raw RRF score
  effectiveness: number
  signals: {
    bm25Rank?: number
    embedRank?: number
    latticeRank?: number
    e8Rank?: number
  }
}

/**
 * Run hybrid retrieval over a candidate set.
 *
 * The caller is responsible for collecting candidates. This function
 * scores them and returns the top N. Pass a `latticeScored` list if
 * the lattice has already produced one — we'll fuse it in.
 */
export async function hybridRank<T extends HybridDoc>(
  query: string,
  candidates: T[],
  options: {
    limit?: number
    latticeOrder?: T[]              // pre-ranked by the lattice
    fts5Hits?: Fts5SearchHit[]       // optional pre-fetched FTS5 results
  } = {},
): Promise<HybridHit<T>[]> {
  const limit = options.limit ?? 10

  // Build per-signal rank maps: doc.id → 1-based rank
  const bm25Rank = new Map<string, number>()
  const embedRank = new Map<string, number>()
  const latticeRank = new Map<string, number>()
  const e8Rank = new Map<string, number>()

  // Signal 1: BM25 from FTS5
  const fts = options.fts5Hits ?? (await searchFts5(query, 50)) ?? []
  fts.forEach((hit, i) => bm25Rank.set(hit.sessionId, i + 1))

  // Signal 2: embedding cosine — only if endpoint supports it
  if (await isEmbeddingAvailable()) {
    // Score every candidate. The embedding cache makes repeat queries
    // cheap. Cap at 50 candidates to bound latency.
    const slice = candidates.slice(0, 50)
    const sims = await embedSimilarity(query, slice.map(c => c.text))
    if (sims) {
      const ranked = slice
        .map((c, i) => ({ id: c.id, sim: sims[i]! }))
        .sort((a, b) => b.sim - a.sim)
      ranked.forEach((entry, i) => embedRank.set(entry.id, i + 1))
    }
  }

  // Signal 3: lattice (caller-provided pre-ranked list)
  if (options.latticeOrder) {
    options.latticeOrder.forEach((doc, i) => latticeRank.set(doc.id, i + 1))
  }

  // Signal 4: E8 concept-region match. Items in the same E8 cell as
  // the query are conceptually adjacent; this is independent of cosine
  // (which acts on the full embedding) — it captures coarse cluster
  // membership and gives a useful tiebreaker when several candidates
  // have similar BM25 / cosine scores.
  try {
    const e8Hits = await findE8Candidates(query, 1, 50)
    e8Hits.forEach((hit, i) => e8Rank.set(hit.id, i + 1))
  } catch { /* index optional */ }

  // Fuse with RRF, then weight by effectiveness
  const ids = candidates.map(c => c.id)
  const effMap = await getEffectivenessMap(ids)

  const scored: HybridHit<T>[] = candidates.map(doc => {
    let rrf = 0
    const signals: HybridHit['signals'] = {}

    const bRank = bm25Rank.get(doc.id)
    if (bRank !== undefined) {
      rrf += 1 / (RRF_K + bRank)
      signals.bm25Rank = bRank
    }
    const eRank = embedRank.get(doc.id)
    if (eRank !== undefined) {
      rrf += 1 / (RRF_K + eRank)
      signals.embedRank = eRank
    }
    const lRank = latticeRank.get(doc.id)
    if (lRank !== undefined) {
      rrf += 1 / (RRF_K + lRank)
      signals.latticeRank = lRank
    }
    const e8R = e8Rank.get(doc.id)
    if (e8R !== undefined) {
      rrf += 1 / (RRF_K + e8R)
      signals.e8Rank = e8R
    }

    const eff = effMap[doc.id] ?? 0.5
    return { doc, score: rrf * eff, rrfScore: rrf, effectiveness: eff, signals }
  })

  scored.sort((a, b) => b.score - a.score)
  const top = scored.slice(0, limit)

  // Log retrievals so the effectiveness loop can credit/discredit them
  // when the task ends. This is the mechanism by which the agent
  // grades itself over time.
  for (const hit of top) {
    if (hit.score > 0) recordRetrieval(hit.doc.id, 'memory')
  }

  return top
}
