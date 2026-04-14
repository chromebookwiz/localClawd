/**
 * Director Memory — Type definitions for the director's persistent state.
 *
 * The director maintains a global memory at ~/.claude/director/ containing:
 *   - state.json: structured index (projects, file index, task history)
 *   - memory/*.md: lattice-scored memory files (reuse existing memdir format)
 */

// ─── Project registry ────────────────────────────────────────────────────────

export interface DirectorProject {
  /** Slug derived from path (e.g. "code-vllmclawd") */
  id: string
  /** Absolute directory path */
  path: string
  /** Git origin remote URL, if available */
  gitRemote?: string
  /** Human description of what this project does */
  description: string
  /** Last time the director worked in this project (epoch ms) */
  lastActive: number
  /** How many times the director has worked here */
  accessCount: number
  /** Tags for lattice scoring */
  tags: string[]
}

// ─── File index ──────────────────────────────────────────────────────────────

export interface DirectorFileEntry {
  projectId: string
  /** Relative to project root */
  relativePath: string
  /** One-line description of the file */
  summary: string
  /** When this entry was last refreshed (epoch ms) */
  lastIndexed: number
  /** Importance score 0-1, boosted by access frequency */
  importance: number
}

// ─── Task history ────────────────────────────────────────────────────────────

export type TaskOutcome = 'success' | 'partial' | 'failed' | 'blocked'

export interface DirectorTaskEntry {
  id: string
  projectId: string
  /** The original task prompt */
  prompt: string
  outcome: TaskOutcome
  /** Summary of what was accomplished */
  summary: string
  /** When this task was completed (epoch ms) */
  timestamp: number
  /** How many director rounds it took */
  roundsUsed: number
}

// ─── Full state ──────────────────────────────────────────────────────────────

export interface DirectorMemoryState {
  version: 1
  projects: DirectorProject[]
  fileIndex: DirectorFileEntry[]
  taskHistory: DirectorTaskEntry[]
  /** Last time pruning was run (epoch ms) */
  lastPruned: number
}

export function createEmptyState(): DirectorMemoryState {
  return {
    version: 1,
    projects: [],
    fileIndex: [],
    taskHistory: [],
    lastPruned: Date.now(),
  }
}
