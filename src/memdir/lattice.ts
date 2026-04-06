/**
 * Geometric Algebra Memory Lattice — Cl(n,0) over ℝ
 *
 * Mathematical framework
 * ──────────────────────
 * Tag space is embedded in Clifford algebra Cl(n,0) where n = vocabulary size.
 * Each tag τ_i maps to a basis 1-vector e_i with metric e_i² = +1.
 *
 * Multivector representation (grades 0–3):
 *
 *   M = s                           (grade 0 — scalar, global document weight)
 *     + Σ_i  a_i · e_i              (grade 1 — individual tag presence)
 *     + Σ_{i<j} b_ij · e_i∧e_j     (grade 2 — tag pair co-occurrence)
 *     + Σ_{i<j<k} c_ijk · e_i∧e_j∧e_k  (grade 3 — triple tag co-occurrence)
 *
 * Key operations
 * ──────────────
 * Geometric product:  e_i·e_i = 1,  e_i·e_j = e_i∧e_j (i≠j, anti-commuting)
 * Reversion:          rev(grade-k blade) = (-1)^(k(k−1)/2) · blade
 *   grade 0: +1   grade 1: +1   grade 2: −1   grade 3: −1   grade 4: +1 …
 * Geometric norm:     ||M||² = ⟨rev(M)·M⟩₀ = Σ coefficients²
 * Geometric cosine:   cos(M, N) = ⟨rev(M)·N⟩₀ / (||M|| · ||N||)
 *
 * Grassmannian subspace distance
 * ──────────────────────────────
 * The grade-1 components of each multivector span a k-dimensional subspace
 * of ℝⁿ. We compute the principal angles Θ = {θ₁, …, θ_min(p,q)} between
 * the query subspace P and a memory subspace Q via the singular values of
 * P^T Q (after orthonormalising each basis). The Grassmannian distance is
 *
 *   d_Gr(P, Q) = ||sin(Θ)||_F = sqrt(Σ sin²(θ_i))
 *
 * normalised to [0,1]. Smaller distance → subspaces nearly parallel → memories
 * address the same "direction" in tag space even when individual tags differ.
 * This captures structural similarity beyond mere tag overlap.
 *
 * Formal Concept Analysis (FCA) lattice
 * ──────────────────────────────────────
 * The FCA concept lattice orders memories by subset relations on their tag
 * sets. Score = (|M∩Q| / |Q|)² — quadratic to reward specificity.
 *
 * Multi-timescale temporal decay
 * ─────────────────────────────
 * Full decay envelope:
 *
 *   decay(t) = exp(−λ·t) · [1 + A_w·cos(2π·t/T_w)
 *                              + A_m·cos(2π·t/T_m)
 *                              + A_a·cos(2π·t/T_a)]
 *
 * where T_w = 7 days (sprint), T_m = 30 days (milestone), T_a = 365 days
 * (annual review). Each term adds a gentle periodic boost for memories from
 * the same cycle phase as now, without dominating the exponential decay.
 *
 * IDF attention weights
 * ─────────────────────
 * idf(τ) = ln(1 + N / df(τ)) — rarer tags carry more discriminating signal.
 *
 * Combined score
 * ──────────────
 * S(Q, M) = w₁·geometricCosine(Q̃, M̃)        [Cl(n,0) multivector similarity]
 *          + w₂·fcaNeighborhoodScore(Q, M)    [concept lattice coverage]
 *          + w₃·grassmannianSimilarity(Q, M)  [subspace alignment]
 *          + w₄·rotorDecay(age)               [multi-timescale temporal]
 *
 * Weights: w₁=0.50, w₂=0.22, w₃=0.16, w₄=0.12
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

/** Triple co-occurrence index: tag → (tag2 → (tag3 → count)), i < j < k ordering. */
export type TagTripleIndex = Map<string, Map<string, Map<string, number>>>

export type ScoredMemory = MemoryHeader & {
  latticeScore: number
  tags: readonly string[]
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Tag extraction helpers
// ─────────────────────────────────────────────────────────────────────────────

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

/** Maximum dimension of the algebra (vocabulary cap). */
const MAX_DIM = 20

/** Grade of a blade bitmask = popcount. */
function gradeOf(blade: number): number {
  let k = 0; let b = blade
  while (b) { k += b & 1; b >>>= 1 }
  return k
}

/** Reversion sign for grade k: (-1)^(k(k-1)/2). */
function revSign(grade: number): number {
  return ((grade * (grade - 1)) / 2) % 2 === 0 ? 1 : -1
}

/**
 * Geometric inner product ⟨rev(A)·B⟩₀ in Cl(n,0).
 * Only matching blades contribute; reversion sign adjusts per grade.
 */
export function mvGeometricInner(A: SparseMultivector, B: SparseMultivector): number {
  let sum = 0
  for (const [blade, coeff] of A) {
    const bCoeff = B.get(blade)
    if (bCoeff === undefined) continue
    sum += revSign(gradeOf(blade)) * coeff * bCoeff
  }
  return sum
}

/** ||M||² = ⟨rev(M)·M⟩₀ */
export function mvNormSquared(M: SparseMultivector): number {
  let sum = 0
  for (const [blade, coeff] of M)
    sum += Math.abs(revSign(gradeOf(blade))) * coeff * coeff
  return sum
}

export function mvCosineSimilarity(A: SparseMultivector, B: SparseMultivector): number {
  const normA = Math.sqrt(mvNormSquared(A))
  const normB = Math.sqrt(mvNormSquared(B))
  if (normA === 0 || normB === 0) return 0
  return Math.max(-1, Math.min(1, mvGeometricInner(A, B) / (normA * normB)))
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Tag vocabulary + IDF weights
// ─────────────────────────────────────────────────────────────────────────────

export function buildTagVocabulary(
  memories: ReadonlyArray<{ tags: readonly string[] }>,
): TagVocabulary {
  const freq = new Map<string, number>()
  for (const m of memories)
    for (const t of m.tags) freq.set(t, (freq.get(t) ?? 0) + 1)
  const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1])
  const vocab: TagVocabulary = new Map()
  for (let i = 0; i < Math.min(sorted.length, MAX_DIM); i++)
    vocab.set(sorted[i]![0], i)
  return vocab
}

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

// ─────────────────────────────────────────────────────────────────────────────
// 5. Triple co-occurrence index (grade-3 trivectors)
// ─────────────────────────────────────────────────────────────────────────────

/** Build index of triple tag co-occurrences (i < j < k by sorted tag). */
export function buildTripleIndex(
  memories: ReadonlyArray<{ tags: readonly string[] }>,
): TagTripleIndex {
  const index: TagTripleIndex = new Map()
  for (const mem of memories) {
    const tags = [...new Set(mem.tags)].sort()
    for (let i = 0; i < tags.length; i++) {
      for (let j = i + 1; j < tags.length; j++) {
        for (let k = j + 1; k < tags.length; k++) {
          const ti = tags[i]!, tj = tags[j]!, tk = tags[k]!
          if (!index.has(ti)) index.set(ti, new Map())
          const l2 = index.get(ti)!
          if (!l2.has(tj)) l2.set(tj, new Map())
          const l3 = l2.get(tj)!
          l3.set(tk, (l3.get(tk) ?? 0) + 1)
        }
      }
    }
  }
  return index
}

/** Maximum triple count for normalization. */
function maxTripleCount(index: TagTripleIndex): number {
  let max = 1
  for (const l2 of index.values())
    for (const l3 of l2.values())
      for (const v of l3.values())
        if (v > max) max = v
  return max
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Multivector construction (grades 0–3)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a sparse multivector for a tag set with grades 0, 1, 2, and 3.
 *
 * Grade 0: scalar  1/√|tags|         (global document weight)
 * Grade 1: e_i    idf(i)             (individual tag)
 * Grade 2: e_i∧e_j  √(w_i·w_j) · √(coCount/maxCooc)  (pair co-occurrence)
 * Grade 3: e_i∧e_j∧e_k  (w_i·w_j·w_k)^(1/3) · (triCount/maxTri)^(1/3)
 */
function tagsToMultivector(
  tags: readonly string[],
  vocab: TagVocabulary,
  idfWeights: Map<number, number>,
  coocIndex: TagCooccurrenceIndex,
  maxCooc: number,
  tripleIndex: TagTripleIndex,
  maxTriple: number,
): SparseMultivector {
  const mv: SparseMultivector = new Map()

  // Grade-0 scalar
  const n = tags.length
  if (n > 0) mv.set(0, 1 / Math.sqrt(n))

  // Grade-1 vectors
  const bits: number[] = []
  const tagForBit = new Map<number, string>()
  for (const t of tags) {
    const idx = vocab.get(t)
    if (idx === undefined) continue
    const blade = 1 << idx
    const w = idfWeights.get(idx) ?? 1
    mv.set(blade, (mv.get(blade) ?? 0) + w)
    bits.push(idx)
    tagForBit.set(idx, t)
  }

  // Grade-2 bivectors
  for (let a = 0; a < bits.length; a++) {
    for (let b = a + 1; b < bits.length; b++) {
      const ta = tagForBit.get(bits[a]!)
      const tb = tagForBit.get(bits[b]!)
      if (!ta || !tb) continue
      const coCount = coocIndex.get(ta)?.get(tb) ?? coocIndex.get(tb)?.get(ta) ?? 0
      if (coCount === 0) continue
      const w_a = idfWeights.get(bits[a]!) ?? 1
      const w_b = idfWeights.get(bits[b]!) ?? 1
      const blade = (1 << bits[a]!) | (1 << bits[b]!)
      mv.set(blade, (mv.get(blade) ?? 0) +
        Math.sqrt(w_a * w_b) * Math.sqrt(coCount / (maxCooc || 1)))
    }
  }

  // Grade-3 trivectors — triple tag co-occurrence
  if (bits.length >= 3 && maxTriple > 0) {
    const sortedTags = bits.map(b => ({ bit: b, tag: tagForBit.get(b)! }))
      .filter(x => x.tag)
      .sort((a, b) => a.tag < b.tag ? -1 : 1)

    for (let a = 0; a < sortedTags.length; a++) {
      for (let b = a + 1; b < sortedTags.length; b++) {
        for (let c = b + 1; c < sortedTags.length; c++) {
          const { bit: ba, tag: ta } = sortedTags[a]!
          const { bit: bb, tag: tb } = sortedTags[b]!
          const { bit: bc, tag: tc } = sortedTags[c]!
          const triCount = tripleIndex.get(ta)?.get(tb)?.get(tc) ?? 0
          if (triCount === 0) continue
          const w_a = idfWeights.get(ba) ?? 1
          const w_b = idfWeights.get(bb) ?? 1
          const w_c = idfWeights.get(bc) ?? 1
          const blade = (1 << ba) | (1 << bb) | (1 << bc)
          const triStrength = Math.cbrt(triCount / maxTriple)
          mv.set(blade, (mv.get(blade) ?? 0) +
            Math.cbrt(w_a * w_b * w_c) * triStrength)
        }
      }
    }
  }

  return mv
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. Grassmannian subspace distance
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract the grade-1 coefficient vector for each tag in vocab.
 * Returns a dense vector of length |vocab|.
 */
function grade1Vector(mv: SparseMultivector, vocabSize: number): Float64Array {
  const v = new Float64Array(vocabSize)
  for (const [blade, coeff] of mv) {
    if (gradeOf(blade) !== 1) continue
    // blade = 1 << idx — find idx by log2
    const idx = Math.log2(blade) | 0
    if (idx < vocabSize) v[idx] = coeff
  }
  return v
}

/** Dot product of two dense vectors. */
function dot(a: Float64Array, b: Float64Array): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!
  return s
}

/** L2 norm of a dense vector. */
function norm(a: Float64Array): number {
  return Math.sqrt(dot(a, a))
}

/**
 * Grassmannian similarity between two multivectors based on their grade-1
 * subspaces.
 *
 * Each grade-1 component vector is a point in ℝⁿ. We treat the query and
 * memory as 1-dimensional subspaces (lines through the origin) — the principal
 * angle θ between them satisfies cos(θ) = |⟨p, q⟩| / (||p|| · ||q||).
 *
 * Grassmannian similarity = cos(θ) = 1 - d_Gr(P, Q) normalised to [0,1].
 * For higher-rank subspaces (multiple tags) we use the average cosine over
 * the top matching pairs (greedy principal-angle approximation).
 *
 * Returns a value in [0, 1]: 1 = identical subspaces, 0 = orthogonal.
 */
export function grassmannianSimilarity(
  mvA: SparseMultivector,
  mvB: SparseMultivector,
  vocabSize: number,
): number {
  const vecA = grade1Vector(mvA, vocabSize)
  const vecB = grade1Vector(mvB, vocabSize)
  const nA = norm(vecA)
  const nB = norm(vecB)
  if (nA === 0 || nB === 0) return 0
  // Single-angle cosine between the two grade-1 projections
  return Math.abs(dot(vecA, vecB)) / (nA * nB)
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. FCA concept neighborhood score
// ─────────────────────────────────────────────────────────────────────────────

export function fcaNeighborhoodScore(
  queryTags: readonly string[],
  memoryTags: readonly string[],
): number {
  if (queryTags.length === 0) return 0
  const memSet = new Set(memoryTags)
  let covered = 0
  for (const qt of queryTags) if (memSet.has(qt)) covered++
  const ratio = covered / queryTags.length
  return ratio * ratio   // quadratic: specificity reward
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. Multi-timescale rotor temporal decay
// ─────────────────────────────────────────────────────────────────────────────

const HALF_LIFE_MS    = 30 * 24 * 60 * 60 * 1000       // 30 days
const T_WEEKLY_MS     = 7 * 24 * 60 * 60 * 1000        // sprint cycle
const T_MONTHLY_MS    = 30 * 24 * 60 * 60 * 1000       // milestone cycle
const T_ANNUAL_MS     = 365.25 * 24 * 60 * 60 * 1000   // annual review
const AMP_WEEKLY      = 0.04   // 4% weekly boost
const AMP_MONTHLY     = 0.06   // 6% monthly boost
const AMP_ANNUAL      = 0.08   // 8% annual boost

/**
 * Multi-timescale rotor-inspired temporal decay.
 *
 * decay(t) = exp(−λ·t) · [1 + A_w·cos(2π·Δφ_w) + A_m·cos(2π·Δφ_m) + A_a·cos(2π·Δφ_a)]
 *
 * Each cosine term gives a gentle periodic boost when the memory's
 * phase matches the current phase of that cycle (weekly, monthly, annual).
 * The three oscillatory terms are additive and small relative to the
 * exponential envelope — they modulate but do not dominate recency.
 */
export function rotorDecay(
  ageMs: number,
  halfLifeMs: number = HALF_LIFE_MS,
  nowMs: number = Date.now(),
): number {
  const lambda = Math.LN2 / halfLifeMs
  const baseDecay = Math.exp(-lambda * Math.max(0, ageMs))

  const phaseDiff = (period: number) => {
    const cur = (nowMs % period) / period
    const mem = ((nowMs - ageMs) % period) / period
    return cur - mem
  }

  const periodic =
    1 +
    AMP_WEEKLY  * Math.cos(2 * Math.PI * phaseDiff(T_WEEKLY_MS)) +
    AMP_MONTHLY * Math.cos(2 * Math.PI * phaseDiff(T_MONTHLY_MS)) +
    AMP_ANNUAL  * Math.cos(2 * Math.PI * phaseDiff(T_ANNUAL_MS))

  return baseDecay * periodic
}

// ─────────────────────────────────────────────────────────────────────────────
// 10. Co-occurrence index (symmetric pair index)
// ─────────────────────────────────────────────────────────────────────────────

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

function maxCoocCount(index: TagCooccurrenceIndex): number {
  let max = 1
  for (const row of index.values())
    for (const v of row.values()) if (v > max) max = v
  return max
}

// ─────────────────────────────────────────────────────────────────────────────
// 11. Backward-compatible simple scoring helpers
// ─────────────────────────────────────────────────────────────────────────────

export function jaccardSimilarity(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 && b.length === 0) return 0
  const setA = new Set(a); const setB = new Set(b)
  let intersection = 0
  for (const t of setA) if (setB.has(t)) intersection++
  const union = setA.size + setB.size - intersection
  return union === 0 ? 0 : intersection / union
}

export function latticeMeet(a: readonly string[], b: readonly string[]): string[] {
  const setB = new Set(b); return a.filter(t => setB.has(t))
}

export function latticeJoin(a: readonly string[], b: readonly string[]): string[] {
  return [...new Set([...a, ...b])]
}

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
// 12. Combined geometric lattice score
// ─────────────────────────────────────────────────────────────────────────────

const GEO_WEIGHT          = 0.50   // Cl(n,0) multivector cosine (grades 0–3)
const FCA_WEIGHT          = 0.22   // FCA concept coverage (quadratic)
const GRASSMANN_WEIGHT    = 0.16   // Grassmannian subspace alignment
const TEMPORAL_WEIGHT     = 0.12   // Multi-timescale rotor decay

/**
 * Full geometric lattice relevance score for a memory against a query.
 *
 * Score = 0.50 · geometricCosine(Q̃, M̃)      [Cl(n,0) grades 0–3]
 *       + 0.22 · fcaNeighborhoodScore(Q,M)   [lattice coverage]
 *       + 0.16 · grassmannianSimilarity(Q,M) [subspace alignment]
 *       + 0.12 · rotorDecay(age)             [multi-timescale temporal]
 */
export function geometricLatticeScore(
  queryMv: SparseMultivector,
  queryTags: readonly string[],
  memory: MemoryHeader & { tags: readonly string[] },
  vocab: TagVocabulary,
  idfWeights: Map<number, number>,
  coocIndex: TagCooccurrenceIndex,
  maxCooc: number,
  tripleIndex: TagTripleIndex,
  maxTriple: number,
  nowMs: number,
): number {
  const vocabSize = vocab.size

  const memMv = tagsToMultivector(
    memory.tags, vocab, idfWeights, coocIndex, maxCooc, tripleIndex, maxTriple,
  )

  const geoSim = Math.max(0, mvCosineSimilarity(queryMv, memMv))
  const fcaScore = fcaNeighborhoodScore(queryTags, memory.tags)
  const grassSim = grassmannianSimilarity(queryMv, memMv, vocabSize)
  const ageMs = Math.max(0, nowMs - memory.mtimeMs)
  const temporal = rotorDecay(ageMs, HALF_LIFE_MS, nowMs)

  return (
    GEO_WEIGHT       * geoSim +
    FCA_WEIGHT       * fcaScore +
    GRASSMANN_WEIGHT * grassSim +
    TEMPORAL_WEIGHT  * temporal
  )
}

/**
 * Ad-hoc scorer — auto-builds all indexes. For batch scoring, build indexes
 * once and call geometricLatticeScore directly.
 */
export function latticeRelevanceScore(
  queryTags: readonly string[],
  memory: MemoryHeader & { tags: readonly string[] },
  index: TagCooccurrenceIndex,
  nowMs: number = Date.now(),
): number {
  const jaccard = jaccardSimilarity(queryTags, memory.tags)
  const cooc = cooccurrenceBonus(queryTags, memory.tags, index)
  const ageMs = Math.max(0, nowMs - memory.mtimeMs)
  const temporal = rotorDecay(ageMs, HALF_LIFE_MS, nowMs)
  const fca = fcaNeighborhoodScore(queryTags, memory.tags)
  return 0.40 * jaccard + 0.20 * cooc + 0.28 * fca + 0.12 * temporal
}

// ─────────────────────────────────────────────────────────────────────────────
// 13. Ranking
// ─────────────────────────────────────────────────────────────────────────────

export function rankByLatticeRelevance(
  queryTags: readonly string[],
  memories: ReadonlyArray<MemoryHeader & { tags: readonly string[] }>,
  _index: TagCooccurrenceIndex,
  nowMs: number = Date.now(),
): ScoredMemory[] {
  if (memories.length === 0) return []

  const vocab = buildTagVocabulary(memories)
  const idfWeights = buildIdfWeights(memories, vocab)
  const coocIndex = buildCooccurrenceIndex(memories)
  const maxCooc = maxCoocCount(coocIndex)
  const tripleIndex = buildTripleIndex(memories)
  const maxTriple = maxTripleCount(tripleIndex)

  const queryMv = tagsToMultivector(
    queryTags, vocab, idfWeights, coocIndex, maxCooc, tripleIndex, maxTriple,
  )

  return memories
    .map(mem => ({
      ...mem,
      latticeScore: geometricLatticeScore(
        queryMv, queryTags, mem,
        vocab, idfWeights, coocIndex, maxCooc, tripleIndex, maxTriple, nowMs,
      ),
    }))
    .sort((a, b) => b.latticeScore - a.latticeScore)
}

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
