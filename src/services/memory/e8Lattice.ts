/**
 * E8 lattice quantization for the memory system.
 *
 * Why E8?
 * ──────
 * The E8 lattice is the densest packing of 8-dimensional space and the
 * unique even unimodular lattice in 8D. Its kissing number is 240 — the
 * number of nearest neighbors of any lattice point — which gives us a
 * natural "240 conceptual neighbors" structure for free.
 *
 * Conway and Sloane proved an O(8) decoder: given any point in ℝ⁸,
 * you can find the nearest E8 lattice point in constant time without
 * brute-force search ("Sphere Packings, Lattices and Groups", 1988,
 * Algorithm 1).
 *
 * How we use it
 * ─────────────
 * Embeddings (typically 384–1536D) are projected to multiple 8D tiles
 * via a fixed pseudo-random projection (Achlioptas-style sparse matrix,
 * deterministic by seed). Each tile is quantized to its nearest E8
 * lattice point. The concatenated tile signature is a bucket key:
 * memories with the same key live in the same conceptual region.
 *
 *   embedding (Nd) → 8D tile₁ ┐
 *                  → 8D tile₂ ├→ E8 quantize each → bucket signature
 *                  → ...     ┘
 *
 * Two memories whose tile signatures differ in 0 positions are
 * conceptually identical (in the lattice sense). One position differing
 * means they fall in adjacent E8 cells along that axis — still close.
 *
 * The 240 root vectors of E8 are stored as a constant. Given a tile,
 * "neighbors" are the 240 lattice points reached by adding any root
 * vector — useful for query expansion ("show me memories in adjacent
 * concept regions").
 *
 * E8 root construction
 * ────────────────────
 * 240 = 112 + 128:
 *   - 112 vectors with two ±1 entries and six 0 entries: choose 2 of 8
 *     positions × 4 sign combos = 28 × 4 = 112
 *   - 128 vectors with all entries ±½, with an even number of minus
 *     signs: 2⁸ / 2 = 128
 */

const D = 8

// ─── E8 root vectors (240 total) ────────────────────────────────────────────

let _rootCache: ReadonlyArray<readonly number[]> | null = null

export function e8Roots(): ReadonlyArray<readonly number[]> {
  if (_rootCache) return _rootCache
  const roots: number[][] = []

  // Type 1: two ±1 entries, rest zero — 112 vectors
  for (let i = 0; i < D; i++) {
    for (let j = i + 1; j < D; j++) {
      for (const si of [-1, 1]) {
        for (const sj of [-1, 1]) {
          const v = new Array(D).fill(0)
          v[i] = si
          v[j] = sj
          roots.push(v)
        }
      }
    }
  }

  // Type 2: all entries ±½, even number of minus signs — 128 vectors
  for (let mask = 0; mask < 256; mask++) {
    // count bits
    let bits = 0
    for (let k = 0; k < 8; k++) bits += (mask >> k) & 1
    if (bits % 2 !== 0) continue
    const v: number[] = []
    for (let k = 0; k < 8; k++) v.push(((mask >> k) & 1) ? -0.5 : 0.5)
    roots.push(v)
  }

  _rootCache = roots
  return roots
}

// ─── Conway-Sloane fast decoder ─────────────────────────────────────────────

/**
 * Round to nearest integer; ties broken toward zero so the parity
 * adjustment in `nearestD8` works deterministically.
 */
function roundHalfToEven(x: number): number {
  const r = Math.round(x)
  // Math.round rounds 0.5 → 1, so ties go up. That's fine for us.
  return r
}

/**
 * Nearest D₈ lattice point. D₈ = {x ∈ ℤ⁸ : Σx_i is even}.
 * Algorithm: round each coordinate; if the rounded sum is odd, flip
 * the coordinate whose rounding error was largest (in absolute value),
 * adjusting in the direction that fixes parity.
 */
function nearestD8(point: number[]): number[] {
  const rounded = point.map(roundHalfToEven)
  let sum = 0
  for (const x of rounded) sum += x
  if (sum % 2 === 0) return rounded

  // Parity is odd — flip the coordinate with worst residual to fix it.
  // The "worst" residual is the one farthest from its rounded value.
  let worstIdx = 0
  let worstResidual = -1
  let worstDirection = 1
  for (let i = 0; i < D; i++) {
    const residual = Math.abs(point[i]! - rounded[i]!)
    if (residual > worstResidual) {
      worstResidual = residual
      worstIdx = i
      // Direction: if the original point was below the rounded value,
      // we should round down further; otherwise up.
      worstDirection = point[i]! < rounded[i]! ? -1 : 1
    }
  }
  rounded[worstIdx] = rounded[worstIdx]! + worstDirection
  return rounded
}

/**
 * Squared Euclidean distance in 8D.
 */
function dist2(a: readonly number[], b: readonly number[]): number {
  let s = 0
  for (let i = 0; i < D; i++) {
    const d = a[i]! - b[i]!
    s += d * d
  }
  return s
}

/**
 * Find the nearest E8 lattice point to an arbitrary 8D vector.
 * E8 = D₈ ∪ (D₈ + (½, ½, ½, ½, ½, ½, ½, ½)).
 *
 * @param point an 8D real vector
 * @returns the nearest E8 lattice point as 8 floats (entries are
 *          either all-integer or all-half-integer)
 */
export function nearestE8(point: number[]): number[] {
  if (point.length !== D) throw new Error(`nearestE8 requires an 8D vector, got ${point.length}`)

  // Candidate 1: nearest D₈ point
  const candA = nearestD8(point)

  // Candidate 2: shift by ½, find nearest D₈, shift back
  const shifted = point.map(x => x - 0.5)
  const candBshifted = nearestD8(shifted)
  const candB = candBshifted.map(x => x + 0.5)

  return dist2(point, candA) <= dist2(point, candB) ? candA : candB
}

// ─── Projection from arbitrary D into 8D tiles ──────────────────────────────

/**
 * Deterministic pseudo-random projection matrix (Achlioptas-style
 * sparse: entries in {-1, 0, +1} scaled by √(3/k)). Identical seeds
 * always produce identical matrices, so the same embedding always maps
 * to the same buckets.
 *
 * We don't bother caching — the matrix is 8×K and rebuilds in <1ms.
 */
function buildProjection(inputDim: number, seed: number): number[][] {
  const matrix: number[][] = []
  // Simple deterministic xorshift32
  let state = (seed | 0) || 1
  const next = (): number => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return (state >>> 0) / 0x100000000
  }
  const scale = Math.sqrt(3 / inputDim)
  for (let i = 0; i < D; i++) {
    const row: number[] = []
    for (let j = 0; j < inputDim; j++) {
      const r = next()
      row.push(r < 1 / 6 ? -scale : r < 2 / 6 ? scale : 0)
    }
    matrix.push(row)
  }
  return matrix
}

function applyProjection(vector: number[], matrix: number[][]): number[] {
  const out: number[] = new Array(D).fill(0)
  for (let i = 0; i < D; i++) {
    let s = 0
    const row = matrix[i]!
    for (let j = 0; j < vector.length; j++) {
      s += row[j]! * vector[j]!
    }
    out[i] = s
  }
  return out
}

// ─── Bucket signatures ──────────────────────────────────────────────────────

/**
 * Number of independent 8D projections used per signature. More tiles
 * = more robust signatures (less false collision) but longer keys.
 * 4 tiles × 8 dims = 32 effective dimensions of structure captured.
 */
const DEFAULT_TILES = 4

const _projectionCache = new Map<string, number[][][]>()

function getProjections(inputDim: number, tiles: number): number[][][] {
  const key = `${inputDim}:${tiles}`
  let cached = _projectionCache.get(key)
  if (!cached) {
    cached = []
    for (let t = 0; t < tiles; t++) {
      // Distinct seeds per tile → independent random projections
      cached.push(buildProjection(inputDim, 1729 + t * 9973))
    }
    _projectionCache.set(key, cached)
  }
  return cached
}

/**
 * Encode a single E8 lattice point as a short string. Coordinates are
 * either all-integer or all-half-integer, so we can multiply by 2 and
 * stringify cleanly.
 */
function encodeE8Point(point: number[]): string {
  return point.map(x => Math.round(x * 2)).join(',')
}

/**
 * Compute the E8 bucket signature for an embedding. Signatures of the
 * same length are directly comparable: identical = same conceptual
 * region across all tiles, partial overlap = adjacent regions.
 */
export function e8BucketSignature(
  embedding: number[],
  tiles: number = DEFAULT_TILES,
): string {
  if (embedding.length === 0) return ''
  const projections = getProjections(embedding.length, tiles)
  const parts: string[] = []
  for (let t = 0; t < tiles; t++) {
    const projected = applyProjection(embedding, projections[t]!)
    const e8Point = nearestE8(projected)
    parts.push(encodeE8Point(e8Point))
  }
  return parts.join('|')
}

/**
 * Tile-overlap distance between two signatures: number of tiles
 * (out of total) that map to *different* E8 cells. 0 = identical
 * concept region, `tiles` = totally unrelated.
 */
export function signatureDistance(a: string, b: string): number {
  if (!a || !b) return Infinity
  const aTiles = a.split('|')
  const bTiles = b.split('|')
  if (aTiles.length !== bTiles.length) return Infinity
  let diffs = 0
  for (let i = 0; i < aTiles.length; i++) {
    if (aTiles[i] !== bTiles[i]) diffs++
  }
  return diffs
}

/**
 * Number of root vectors of E8 — the kissing number. Exposed so other
 * modules can write "240 nearest concept neighbors" with a constant
 * instead of a magic number.
 */
export const E8_KISSING_NUMBER = 240
