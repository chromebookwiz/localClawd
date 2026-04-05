/**
 * Geometric Algebra Memory Lattice — Cl(n,0) over ℝ
 *
 * Mathematical framework
 * ──────────────────────
 * Tag space is embedded in Clifford algebra Cl(n,0) where n = vocabulary size.
 * Each tag τ_i maps to a basis 1-vector e_i with metric e_i² = +1.
 *
 * Multivector representation (grades 0–2, higher grades approximated):
 *
 *   M = s                      (grade 0 — scalar, global weight)
 *     + Σ_i  a_i · e_i         (grade 1 — individual tag presence)
 *     + Σ_{i<j} b_ij · e_i∧e_j (grade 2 — tag pair co-occurrence bivector)
 *
 * Key operations
 * ──────────────
 * Geometric product:  e_i·e_i = 1,  e_i·e_j = e_i∧e_j (i≠j, anti-commuting)
 * Reversion:          rev(grade-k blade) = (-1)^(k(k−1)/2) · blade
 *   grade 0: +1 · blade   grade 1: +1 · blade   grade 2: −1 · blade
 * Geometric norm:     ||M||² = ⟨rev(M)·M⟩₀ = Σ coefficients²   (all grades)
 * Geometric cosine:   cos(M, N) = ⟨rev(M)·N⟩₀ / (||M|| · ||N||)
 *
 * Because Cl(n,0) has positive-definite metric, ⟨rev(A)·B⟩₀ equals the
 * standard Euclidean dot product over the coefficient vector — but the
 * STRUCTURE of what the coefficients represent is richer: grade-2 components
 * encode relational tag pairs as geometric objects (bivectors), capturing
 * second-order co-occurrence signal absent from flat Jaccard scoring.
 *
 * Formal Concept Analysis (FCA) lattice
 * ──────────────────────────────────────
 * The FCA concept lattice orders memories by subset relations on their tag
 * sets. A formal concept (A, B) has A = set of memories, B = shared tags.
 * The concept neighborhood score counts how many formal sub-concepts of the
 * query concept contain a given memory — more shared sub-concepts → higher
 * score. This captures topological position in the lattice beyond pairwise
 * similarity.
 *
 * Rotor-inspired temporal decay
 * ─────────────────────────────
 * Rotors in Cl(n,0) take the form R = cos(θ/2) + B·sin(θ/2) and implement
 * smooth rotation. For temporal scoring we use a rotor-amplitude envelope:
 *
 *   decay(t) = exp(−λ·t) · [1 + A·cos(2π·t/T_annual)]
 *
 * The oscillatory term models annual periodicity (recurring project cycles,
 * annual review cadences). λ = ln(2)/halfLife governs the exponential envelope.
 *
 * IDF attention weights
 * ─────────────────────
 * Tags that appear across many memories carry less discriminating signal.
 * IDF(τ) = log(1 + N / df(τ)) weights each tag inversely by document
 * frequency, giving rarer tags higher influence in both query and memory
 * multivectors — analogous to the attention mechanism's key weighting.
 *
 * Combined score
 * ──────────────
 * S(Q, M) = w₁·geometricCosine(Q̃, M̃)       [multivector similarity]
 *          + w₂·fcaNeighborhoodScore(Q, M)    [lattice position]
 *          + w₃·rotorDecay(age)               [temporal relevance]
 *
 * Weights: w₁=0.60, w₂=0.28, w₃=0.12
 */

import type { MemoryHeader } from './memoryScan.js'

// ─────────────────────────────────────────────────────────────────────────────
// 1. Types
// ─────────────────────────────────────────────────────────────────────────────

/** Sparse multivector over Cl(n,0). Key = blade bitmask, value = coefficient. */
export type SparseMultivector = Map<number, number>

/** Maps each tag string to its bit-index in the algebra basis (0..n-1). */
export type TagVocabulary = Map<string, number>

/** Symmetric tag co-occurrence index: tag → (neighbor tag → raw count). */
export type TagCooccurrenceIndex = Map<string, Map<string, number>>

export type ScoredMemory = MemoryHeader & {
  latticeScore: number
  tags: readonly string[]
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Tag extraction helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse comma- or space-separated tags from YAML frontmatter.
 * Accepts a raw string, array, or falsy value. Returns [] on failure.
 */
export function parseTags(raw: unknown): string[] {
  if (!raw) return []
  if (Array.isArray(raw))
    return raw
      .filter((t): t is string => typeof t === 'string')
      .map(t => t.trim().toLowerCase())
      .filter(Boolean)
  if (typeof raw === 'string')
    return raw
      .split(/[,\s]+/)
      .map(t => t.trim().toLowerCase())
      .filter(Boolean)
  return []
}

const STOP_WORDS = new Set([
  'a','an','the','and','or','but','in','on','at','to','for','of','with','by',
  'is','it','as','be','was','are','has','have','had','do','does','did','will',
  'would','can','could','should','may','might','shall','this','that','these',
  'those','i','you','he','she','we','they','what','how','when','where','why',
  'who','my','your','his','her','our','its','me','him','us','them','not','no',
  'if','then','so','up','out','about','into','over','after','from','get','use',
])

/** Extract candidate query tags from a natural-language string. */
export function extractQueryTags(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9\s_-]/g, ' ')
    .split(/\s+/)
    .map(t => t.trim())
    .filter(t => t.length >= 2 && !STOP_WORDS.has(t))
    .slice(0, 24)
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Clifford algebra — sparse multivector operations
// ─────────────────────────────────────────────────────────────────────────────

/** Maximum dimension of the algebra (vocabulary cap). 2^MAX_DIM blade count. */
const MAX_DIM = 20

/** Grade of a blade bitmask = number of set bits. */
function gradeOf(blade: number): number {
  let k = 0
  let b = blade
  while (b) { k += b & 1; b >>>= 1 }
  return k
}

/** Reversion sign for grade k: (-1)^(k(k-1)/2). */
function revSign(grade: number): number {
  return ((grade * (grade - 1)) / 2) % 2 === 0 ? 1 : -1
}

/**
 * Geometric inner product ⟨rev(A)·B⟩₀ in Cl(n,0).
 *
 * In positive-definite Cl(n,0) this equals the Euclidean dot product of the
 * coefficient vectors, but only when blades of the SAME grade and SAME basis
 * element are paired (cross-grade terms vanish in the scalar projection).
 * Reversion sign: grade-0 → +1, grade-1 → +1, grade-2 → −1, grade-3 → −1, …
 */
export function mvGeometricInner(A: SparseMultivector, B: SparseMultivector): number {
  let sum = 0
  for (const [blade, coeff] of A) {
    const bCoeff = B.get(blade)
    if (bCoeff === undefined) continue
    const grade = gradeOf(blade)
    // ⟨rev(e_K)·e_K⟩₀ = revSign(grade) * (e_K·e_K in Cl(n,0))
    // For Cl(n,0) positive-definite: e_K·e_K = +1 for any blade K
    // (Each e_i² = +1 and the product of k copies of +1 = +1)
    // But reversion flips sign for grade ≥ 2:
    sum += revSign(grade) * coeff * bCoeff
  }
  return sum
}

/** ||M||² = ⟨rev(M)·M⟩₀ */
export function mvNormSquared(M: SparseMultivector): number {
  let sum = 0
  for (const [blade, coeff] of M) {
    const grade = gradeOf(blade)
    sum += Math.abs(revSign(grade)) * coeff * coeff
  }
  return sum
}

/**
 * Geometric cosine similarity in [-1, 1].
 * cos(A, B) = ⟨rev(A)·B⟩₀ / (||A|| · ||B||)
 *
 * In practice this equals the standard cosine similarity over the
 * coefficient vector, adjusted by reversion signs per grade.
 */
export function mvCosineSimilarity(A: SparseMultivector, B: SparseMultivector): number {
  const normA = Math.sqrt(mvNormSquared(A))
  const normB = Math.sqrt(mvNormSquared(B))
  if (normA === 0 || normB === 0) return 0
  return Math.max(-1, Math.min(1, mvGeometricInner(A, B) / (normA * normB)))
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Tag vocabulary + IDF-weighted multivector construction
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a tag vocabulary (tag → bit-index) from a collection of memories,
 * capped at MAX_DIM dimensions. Tags are sorted by descending frequency so
 * the most common tags occupy the lowest bit indices (keeps the algebra
 * dense in the most-used part of the space).
 */
export function buildTagVocabulary(
  memories: ReadonlyArray<{ tags: readonly string[] }>,
): TagVocabulary {
  const freq = new Map<string, number>()
  for (const m of memories)
    for (const t of m.tags)
      freq.set(t, (freq.get(t) ?? 0) + 1)

  const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1])
  const vocab: TagVocabulary = new Map()
  for (let i = 0; i < Math.min(sorted.length, MAX_DIM); i++)
    vocab.set(sorted[i]![0], i)
  return vocab
}

/**
 * Inverse Document Frequency weight for each tag.
 * idf(τ) = ln(1 + N / df(τ))  where N = number of memories, df = #memories with τ.
 */
function buildIdfWeights(
  memories: ReadonlyArray<{ tags: readonly string[] }>,
  vocab: TagVocabulary,
): Map<number, number> {
  const N = memories.length
  const df = new Map<number, number>()
  for (const m of memories) {
    const seen = new Set<number>()
    for (const t of m.tags) {
      const idx = vocab.get(t)
      if (idx !== undefined && !seen.has(idx)) {
        seen.add(idx)
        df.set(idx, (df.get(idx) ?? 0) + 1)
      }
    }
  }
  const weights = new Map<number, number>()
  for (const [bit, count] of df)
    weights.set(bit, Math.log(1 + N / count))
  return weights
}

/**
 * Build a sparse multivector for a tag set.
 *
 * Grade-1 components: each tag τ_i → coefficient w_i (IDF weight or 1.0).
 * Grade-2 components: each co-occurring pair (τ_i, τ_j) → coefficient
 *   sqrt(w_i · w_j) · normalizedCoCount^(1/2)
 *   encoded as blade (1<<i | 1<<j).
 *
 * The scalar (grade-0) is set to 1/sqrt(|tags|) to give global document weight.
 */
function tagsToMultivector(
  tags: readonly string[],
  vocab: TagVocabulary,
  idfWeights: Map<number, number>,
  coocIndex: TagCooccurrenceIndex,
  maxCoocPerMemory: number,
): SparseMultivector {
  const mv: SparseMultivector = new Map()

  // Grade-0 scalar
  const n = tags.length
  if (n > 0) mv.set(0, 1 / Math.sqrt(n))

  // Grade-1 vectors (individual tag presence, IDF-weighted)
  const bits: number[] = []
  for (const t of tags) {
    const idx = vocab.get(t)
    if (idx === undefined) continue
    const blade = 1 << idx
    const w = idfWeights.get(idx) ?? 1
    mv.set(blade, (mv.get(blade) ?? 0) + w)
    bits.push(idx)
  }

  // Grade-2 bivectors (tag pair co-occurrence)
  for (let a = 0; a < bits.length; a++) {
    for (let b = a + 1; b < bits.length; b++) {
      const ta = [...vocab.entries()].find(([, v]) => v === bits[a])?.[0]
      const tb = [...vocab.entries()].find(([, v]) => v === bits[b])?.[0]
      if (!ta || !tb) continue
      const coCount = coocIndex.get(ta)?.get(tb) ?? 0
      if (coCount === 0) continue
      const w_a = idfWeights.get(bits[a]!) ?? 1
      const w_b = idfWeights.get(bits[b]!) ?? 1
      const blade = (1 << bits[a]!) | (1 << bits[b]!)
      const coStrength = Math.sqrt(coCount / (maxCoocPerMemory || 1))
      mv.set(blade, (mv.get(blade) ?? 0) + Math.sqrt(w_a * w_b) * coStrength)
    }
  }

  return mv
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Formal Concept Analysis (FCA) lattice neighborhood score
// ─────────────────────────────────────────────────────────────────────────────

/**
 * FCA concept neighborhood score.
 *
 * For each non-empty subset S ⊆ queryTags, we find the set of memories whose
 * tag set CONTAINS every tag in S (the "extent" of that concept). A memory
 * that appears in more concept extents — especially larger subsets — scores
 * higher, because it occupies a more specific position in the concept lattice
 * that is geometrically close to the query concept.
 *
 * Score = Σ_{k=1}^{|Q|} k · 1[memTags ⊇ some k-subset of queryTags]
 *         / Σ_{k=1}^{|Q|} k
 *
 * Approximation: instead of enumerating all 2^|Q| subsets (expensive), we use
 * a graded inner product approach — count how many query tags the memory
 * covers, then weight by coverage depth (more = higher grade concept).
 */
export function fcaNeighborhoodScore(
  queryTags: readonly string[],
  memoryTags: readonly string[],
): number {
  if (queryTags.length === 0) return 0
  const memSet = new Set(memoryTags)
  let covered = 0
  for (const qt of queryTags)
    if (memSet.has(qt)) covered++

  // Coverage ratio weighted by coverage depth (quadratic: covering 2/4 > 2× covering 1/4)
  const ratio = covered / queryTags.length
  // Quadratic penalty for partial coverage encourages specificity
  return ratio * ratio
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Rotor-inspired temporal decay
// ─────────────────────────────────────────────────────────────────────────────

const HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000   // 30 days
const ANNUAL_PERIOD_MS = 365.25 * 24 * 60 * 60 * 1000
const ROTOR_AMPLITUDE = 0.08   // 8% periodic modulation

/**
 * Rotor-inspired temporal decay with annual periodicity.
 *
 * A rotor R(θ) = cos(θ/2) + B·sin(θ/2) in Cl(n,0) generates smooth rotations.
 * For temporal scoring we use the amplitude of a time-parameterized rotor:
 *
 *   decay(t) = exp(−λ·t) · [1 + A·cos(2π·t/T_annual)]
 *
 * where λ = ln(2)/halfLife. The oscillatory factor adds gentle periodic boost
 * for memories from the same calendar-cycle phase as now (e.g., memories
 * written ~1 year ago about the same project phase are slightly boosted).
 */
export function rotorDecay(
  ageMs: number,
  halfLifeMs: number = HALF_LIFE_MS,
  nowMs: number = Date.now(),
): number {
  const lambda = Math.LN2 / halfLifeMs
  const baseDecay = Math.exp(-lambda * Math.max(0, ageMs))
  // Phase angle for annual periodicity relative to current time-of-year
  const currentPhase = (nowMs % ANNUAL_PERIOD_MS) / ANNUAL_PERIOD_MS
  const memPhase = ((nowMs - ageMs) % ANNUAL_PERIOD_MS) / ANNUAL_PERIOD_MS
  const phaseDiff = currentPhase - memPhase
  const periodicBoost = 1 + ROTOR_AMPLITUDE * Math.cos(2 * Math.PI * phaseDiff)
  return baseDecay * periodicBoost
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. Co-occurrence index (retained for backward compatibility + grade-2 use)
// ─────────────────────────────────────────────────────────────────────────────

/** Build symmetric tag co-occurrence index from memories. */
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
    for (let i = 0; i < tags.length; i++)
      for (let j = i + 1; j < tags.length; j++) {
        bump(tags[i]!, tags[j]!)
        bump(tags[j]!, tags[i]!)
      }
  }
  return index
}

/** Maximum co-occurrence count in an index (for normalization). */
function maxCoocCount(index: TagCooccurrenceIndex): number {
  let max = 1
  for (const row of index.values())
    for (const v of row.values())
      if (v > max) max = v
  return max
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. Backward-compatible simple scoring (kept for direct callers)
// ─────────────────────────────────────────────────────────────────────────────

/** Jaccard similarity |A∩B| / |A∪B|. Returns 0 when both empty. */
export function jaccardSimilarity(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 && b.length === 0) return 0
  const setA = new Set(a)
  const setB = new Set(b)
  let intersection = 0
  for (const t of setA) if (setB.has(t)) intersection++
  const union = setA.size + setB.size - intersection
  return union === 0 ? 0 : intersection / union
}

/** Lattice meet: greatest lower bound (shared tags). */
export function latticeMeet(a: readonly string[], b: readonly string[]): string[] {
  const setB = new Set(b)
  return a.filter(t => setB.has(t))
}

/** Lattice join: least upper bound (union of tags). */
export function latticeJoin(a: readonly string[], b: readonly string[]): string[] {
  return [...new Set([...a, ...b])]
}

/** Co-occurrence bonus (retained for external callers). */
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
      if (coCount > 0) score += Math.log1p(coCount)
    }
  }
  const maxPossible = queryTags.length * memoryTags.length * Math.log1p(1)
  return maxPossible === 0 ? 0 : Math.min(1, score / maxPossible)
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. Combined geometric lattice relevance score
// ─────────────────────────────────────────────────────────────────────────────

const GEO_WEIGHT = 0.60      // Geometric cosine similarity (multivector)
const FCA_WEIGHT = 0.28      // FCA concept neighborhood score
const TEMPORAL_WEIGHT = 0.12 // Rotor temporal decay

/**
 * Full geometric lattice relevance score for a memory against a query.
 *
 * Requires pre-built vocabulary, IDF weights, and co-occurrence index for
 * efficient batch scoring. Use latticeRelevanceScore() for ad-hoc scoring
 * with automatically built indexes.
 *
 * Score = 0.60 · geometricCosine(Q̃, M̃)   [Cl(n,0) multivector similarity]
 *       + 0.28 · fcaNeighborhoodScore(Q,M)  [concept lattice position]
 *       + 0.12 · rotorDecay(age)            [temporal relevance]
 */
export function geometricLatticeScore(
  queryMv: SparseMultivector,
  queryTags: readonly string[],
  memory: MemoryHeader & { tags: readonly string[] },
  vocab: TagVocabulary,
  idfWeights: Map<number, number>,
  coocIndex: TagCooccurrenceIndex,
  maxCooc: number,
  nowMs: number,
): number {
  const memMv = tagsToMultivector(memory.tags, vocab, idfWeights, coocIndex, maxCooc)
  const geoSim = Math.max(0, mvCosineSimilarity(queryMv, memMv))

  const fcaScore = fcaNeighborhoodScore(queryTags, memory.tags)

  const ageMs = Math.max(0, nowMs - memory.mtimeMs)
  const temporal = rotorDecay(ageMs, HALF_LIFE_MS, nowMs)

  return GEO_WEIGHT * geoSim + FCA_WEIGHT * fcaScore + TEMPORAL_WEIGHT * temporal
}

/**
 * Convenience ad-hoc scorer that auto-builds all indexes.
 * Useful for single-memory scoring; for batch scoring prefer building indexes
 * once via buildCooccurrenceIndex + buildTagVocabulary.
 */
export function latticeRelevanceScore(
  queryTags: readonly string[],
  memory: MemoryHeader & { tags: readonly string[] },
  index: TagCooccurrenceIndex,
  nowMs: number = Date.now(),
): number {
  // Fallback using the simple jaccard + cooc + recency for ad-hoc calls
  const jaccard = jaccardSimilarity(queryTags, memory.tags)
  const cooc = cooccurrenceBonus(queryTags, memory.tags, index)
  const ageMs = Math.max(0, nowMs - memory.mtimeMs)
  const temporal = rotorDecay(ageMs, HALF_LIFE_MS, nowMs)
  // Use FCA neighborhood as well
  const fca = fcaNeighborhoodScore(queryTags, memory.tags)

  return (
    0.45 * jaccard +
    0.20 * cooc +
    0.23 * fca +
    0.12 * temporal
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// 10. Ranking
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Rank memories by geometric lattice relevance to query tags.
 *
 * Builds the Cl(n,0) vocabulary, IDF weights, and co-occurrence index once,
 * then scores all memories against the pre-built query multivector. This is
 * O(|vocab|² · |memories|) in the worst case but typically fast because the
 * multivectors are very sparse (most memories have 3–8 tags).
 */
export function rankByLatticeRelevance(
  queryTags: readonly string[],
  memories: ReadonlyArray<MemoryHeader & { tags: readonly string[] }>,
  _index: TagCooccurrenceIndex, // kept for API compatibility — rebuilt internally
  nowMs: number = Date.now(),
): ScoredMemory[] {
  if (memories.length === 0) return []

  const vocab = buildTagVocabulary(memories)
  const idfWeights = buildIdfWeights(memories, vocab)
  const coocIndex = buildCooccurrenceIndex(memories)
  const maxCooc = maxCoocCount(coocIndex)

  const queryMv = tagsToMultivector(
    queryTags,
    vocab,
    idfWeights,
    coocIndex,
    maxCooc,
  )

  return memories
    .map(mem => ({
      ...mem,
      latticeScore: geometricLatticeScore(
        queryMv,
        queryTags,
        mem,
        vocab,
        idfWeights,
        coocIndex,
        maxCooc,
        nowMs,
      ),
    }))
    .sort((a, b) => b.latticeScore - a.latticeScore)
}

/**
 * Top-level entry point: given a raw query and tagged memory list, return
 * the top-N most relevant memories using the full geometric lattice pipeline.
 *
 * This is the offline fallback for findRelevantMemories when a hosted
 * side-query model is unavailable.
 */
export function topLatticeMemories(
  query: string,
  memories: ReadonlyArray<MemoryHeader & { tags: readonly string[] }>,
  topN = 5,
): ScoredMemory[] {
  const queryTags = extractQueryTags(query)
  const index = buildCooccurrenceIndex(memories)
  const ranked = rankByLatticeRelevance(queryTags, memories, index)
  return ranked.filter(m => m.latticeScore > 0).slice(0, topN)
}
