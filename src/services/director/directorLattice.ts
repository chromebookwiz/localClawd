/**
 * Director Lattice Integration — reuses the existing geometric algebra
 * lattice scorer to find relevant director memories.
 */

import { DIRECTOR_MEMORY_DIR } from './directorMemoryOps.js'
import { scanMemoryFiles } from '../../memdir/memoryScan.js'
import { topLatticeMemories, type ScoredMemory } from '../../memdir/lattice.js'
import { logForDebugging } from '../../utils/debug.js'
import { mkdir } from 'fs/promises'

/**
 * Find relevant director memories using lattice scoring.
 * Returns up to `limit` memories ranked by geometric algebra similarity.
 */
export async function findRelevantDirectorMemories(
  query: string,
  signal: AbortSignal,
  limit: number = 5,
): Promise<ScoredMemory[]> {
  try {
    // Ensure directory exists
    await mkdir(DIRECTOR_MEMORY_DIR, { recursive: true })

    const memories = await scanMemoryFiles(DIRECTOR_MEMORY_DIR, signal)
    if (memories.length === 0) return []

    return topLatticeMemories(query, memories, limit)
  } catch (e) {
    logForDebugging(`[director-lattice] Memory scan failed: ${e}`)
    return []
  }
}
