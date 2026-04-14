/**
 * Director Memory Operations — CRUD, pruning, and indexing for the director's
 * persistent state.
 */

import { mkdir, readdir, readFile, stat, writeFile } from 'fs/promises'
import { basename, join, relative, resolve } from 'path'
import { homedir } from 'os'
import { logForDebugging } from '../../utils/debug.js'
import type {
  DirectorMemoryState,
  DirectorProject,
  DirectorFileEntry,
  DirectorTaskEntry,
  TaskOutcome,
} from './directorMemory.js'
import { createEmptyState } from './directorMemory.js'

// ─── Paths ───────────────────────────────────────────────────────────────────

const DIRECTOR_DIR = join(homedir(), '.claude', 'director')
const STATE_FILE = join(DIRECTOR_DIR, 'state.json')
export const DIRECTOR_MEMORY_DIR = join(DIRECTOR_DIR, 'memory')

// ─── State I/O ───────────────────────────────────────────────────────────────

export async function loadDirectorState(): Promise<DirectorMemoryState> {
  try {
    const raw = await readFile(STATE_FILE, 'utf-8')
    const parsed = JSON.parse(raw) as DirectorMemoryState
    if (parsed.version !== 1) return createEmptyState()
    return parsed
  } catch {
    return createEmptyState()
  }
}

export async function saveDirectorState(state: DirectorMemoryState): Promise<void> {
  await mkdir(DIRECTOR_DIR, { recursive: true })
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2), 'utf-8')
}

// ─── Project operations ──────────────────────────────────────────────────────

function slugify(path: string): string {
  return basename(resolve(path))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

async function detectGitRemote(projectPath: string): Promise<string | undefined> {
  try {
    const configPath = join(projectPath, '.git', 'config')
    const config = await readFile(configPath, 'utf-8')
    const match = config.match(/\[remote "origin"\][^[]*url\s*=\s*(.+)/m)
    return match?.[1]?.trim()
  } catch {
    return undefined
  }
}

async function detectDescription(projectPath: string): Promise<string> {
  // Try package.json description
  try {
    const pkg = JSON.parse(await readFile(join(projectPath, 'package.json'), 'utf-8'))
    if (pkg.description) return pkg.description
  } catch { /* no package.json */ }

  // Try first line of README
  try {
    const readme = await readFile(join(projectPath, 'README.md'), 'utf-8')
    const firstLine = readme.split('\n').find(l => l.trim() && !l.startsWith('#'))
    if (firstLine) return firstLine.trim().slice(0, 120)
  } catch { /* no README */ }

  return basename(resolve(projectPath))
}

function generateTags(project: { path: string; gitRemote?: string; description: string }): string[] {
  const tags: string[] = []
  const name = basename(resolve(project.path))
  tags.push(name.toLowerCase())

  // Extract keywords from description
  const words = project.description.toLowerCase().split(/\W+/).filter(w => w.length > 3)
  tags.push(...words.slice(0, 5))

  return [...new Set(tags)]
}

export async function registerProject(
  state: DirectorMemoryState,
  projectPath: string,
  description?: string,
): Promise<DirectorProject> {
  const absPath = resolve(projectPath)
  const id = slugify(absPath)

  // Check if already registered
  const existing = state.projects.find(p => p.id === id || p.path === absPath)
  if (existing) {
    existing.lastActive = Date.now()
    existing.accessCount++
    if (description) existing.description = description
    return existing
  }

  const gitRemote = await detectGitRemote(absPath)
  const desc = description ?? await detectDescription(absPath)
  const project: DirectorProject = {
    id,
    path: absPath,
    gitRemote,
    description: desc,
    lastActive: Date.now(),
    accessCount: 1,
    tags: generateTags({ path: absPath, gitRemote, description: desc }),
  }

  state.projects.push(project)
  return project
}

export function boostProject(state: DirectorMemoryState, projectId: string): void {
  const project = state.projects.find(p => p.id === projectId)
  if (project) {
    project.lastActive = Date.now()
    project.accessCount++
  }
}

// ─── File indexing ───────────────────────────────────────────────────────────

const KEY_FILES = [
  'package.json',
  'README.md',
  'CLAUDE.md',
  'Cargo.toml',
  'pyproject.toml',
  'go.mod',
  'Makefile',
  'docker-compose.yml',
  'Dockerfile',
]

const MAX_FILE_ENTRIES = 100

export async function indexProjectFiles(
  state: DirectorMemoryState,
  projectId: string,
  projectPath: string,
): Promise<void> {
  // Remove old entries for this project
  state.fileIndex = state.fileIndex.filter(f => f.projectId !== projectId)

  const entries: DirectorFileEntry[] = []
  const absPath = resolve(projectPath)

  // Index key root files
  for (const name of KEY_FILES) {
    try {
      const filePath = join(absPath, name)
      await stat(filePath)
      const content = await readFile(filePath, 'utf-8')
      const firstLine = content.split('\n').find(l => l.trim())?.trim() ?? name
      entries.push({
        projectId,
        relativePath: name,
        summary: firstLine.slice(0, 120),
        lastIndexed: Date.now(),
        importance: 0.8,
      })
    } catch { /* file doesn't exist */ }
  }

  // Index top-level src/ files
  try {
    const srcDir = join(absPath, 'src')
    const srcFiles = await readdir(srcDir)
    for (const file of srcFiles.slice(0, 30)) {
      if (!file.endsWith('.ts') && !file.endsWith('.tsx') && !file.endsWith('.js') &&
          !file.endsWith('.py') && !file.endsWith('.rs') && !file.endsWith('.go')) continue
      entries.push({
        projectId,
        relativePath: `src/${file}`,
        summary: file,
        lastIndexed: Date.now(),
        importance: 0.5,
      })
    }
  } catch { /* no src directory */ }

  state.fileIndex.push(...entries.slice(0, MAX_FILE_ENTRIES))
}

// ─── Task history ────────────────────────────────────────────────────────────

const MAX_TASKS = 200

export function recordTask(
  state: DirectorMemoryState,
  projectId: string,
  prompt: string,
  outcome: TaskOutcome,
  summary: string,
  roundsUsed: number,
): DirectorTaskEntry {
  const entry: DirectorTaskEntry = {
    id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    projectId,
    prompt: prompt.slice(0, 500),
    outcome,
    summary: summary.slice(0, 500),
    timestamp: Date.now(),
    roundsUsed,
  }

  state.taskHistory.push(entry)

  // Cap at MAX_TASKS, remove oldest first
  if (state.taskHistory.length > MAX_TASKS) {
    state.taskHistory = state.taskHistory.slice(-MAX_TASKS)
  }

  return entry
}

// ─── Pruning ─────────────────────────────────────────────────────────────────

const PRUNE_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000    // 7 days
const PROJECT_STALE_MS = 90 * 24 * 60 * 60 * 1000     // 90 days
const IMPORTANCE_DECAY = 0.95

export function shouldPrune(state: DirectorMemoryState): boolean {
  return Date.now() - state.lastPruned > PRUNE_INTERVAL_MS
}

export function pruneMemory(state: DirectorMemoryState): void {
  const now = Date.now()

  // Remove stale projects (not accessed in 90 days)
  const staleProjectIds = new Set<string>()
  state.projects = state.projects.filter(p => {
    if (now - p.lastActive > PROJECT_STALE_MS) {
      staleProjectIds.add(p.id)
      return false
    }
    return true
  })

  // Remove file entries for pruned projects
  state.fileIndex = state.fileIndex.filter(f => !staleProjectIds.has(f.projectId))

  // Decay importance scores
  for (const entry of state.fileIndex) {
    entry.importance *= IMPORTANCE_DECAY
  }

  // Cap task history
  if (state.taskHistory.length > MAX_TASKS) {
    state.taskHistory = state.taskHistory.slice(-MAX_TASKS)
  }

  state.lastPruned = now
  logForDebugging(`[director] Pruned memory: removed ${staleProjectIds.size} stale projects`)
}

// ─── Context building ────────────────────────────────────────────────────────

export function getProjectContext(
  state: DirectorMemoryState,
  projectId: string,
): string {
  const project = state.projects.find(p => p.id === projectId)
  if (!project) return 'Unknown project.'

  const lines: string[] = []
  lines.push(`Project: ${project.description}`)
  lines.push(`Path: ${project.path}`)
  if (project.gitRemote) lines.push(`Remote: ${project.gitRemote}`)
  lines.push(`Access count: ${project.accessCount}`)

  // Key files
  const files = state.fileIndex.filter(f => f.projectId === projectId)
  if (files.length > 0) {
    lines.push('')
    lines.push('Key files:')
    for (const f of files.slice(0, 20)) {
      lines.push(`  ${f.relativePath} — ${f.summary}`)
    }
  }

  // Recent tasks
  const tasks = state.taskHistory
    .filter(t => t.projectId === projectId)
    .slice(-5)
  if (tasks.length > 0) {
    lines.push('')
    lines.push('Recent tasks:')
    for (const t of tasks) {
      const date = new Date(t.timestamp).toISOString().slice(0, 10)
      lines.push(`  [${t.outcome}] ${date}: ${t.prompt.slice(0, 80)}`)
    }
  }

  return lines.join('\n')
}
