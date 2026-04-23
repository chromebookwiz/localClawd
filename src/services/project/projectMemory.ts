/**
 * Project Memory — persistent per-project state that every localclawd
 * session participates in. Replaces the old /director command's memory
 * so every conversation benefits, not just supervised ones.
 *
 * Reuses the director memory format to preserve existing state files.
 */

import {
  loadDirectorState,
  saveDirectorState,
  registerProject,
  boostProject,
  indexProjectFiles,
  pruneMemory,
  shouldPrune,
  getProjectContext,
  setDirectorProjectRoot,
} from '../director/directorMemoryOps.js'
import { buildDirectorStatusText } from '../director/directorPrompts.js'
import { logForDebugging } from '../../utils/debug.js'

let _initialized = false
let _currentProjectId = ''
let _projectPath = ''

/**
 * Called once at startup. Registers the current project, builds the file
 * index, and prunes stale entries. Safe to call multiple times.
 */
export async function initProjectMemory(projectPath: string): Promise<void> {
  if (_initialized && _projectPath === projectPath) return
  _projectPath = projectPath

  try {
    setDirectorProjectRoot(projectPath)
    const state = await loadDirectorState()

    if (shouldPrune(state)) pruneMemory(state)

    const project = await registerProject(state, projectPath)
    boostProject(state, project.id)
    await indexProjectFiles(state, project.id, projectPath)
    await saveDirectorState(state)

    _currentProjectId = project.id
    _initialized = true
    logForDebugging(`[project-memory] Initialized for ${project.id}`)
  } catch (e) {
    logForDebugging(`[project-memory] Init failed: ${e}`)
  }
}

/**
 * Get formatted status text summarizing registered projects + recent tasks.
 * Used by /status in chat bridges.
 */
export async function getProjectStatus(): Promise<string> {
  try {
    const state = await loadDirectorState()
    return buildDirectorStatusText(state.projects, state.taskHistory)
  } catch {
    return 'No project memory available.'
  }
}

/**
 * Get the context block describing the current project — key files, recent
 * tasks, gitremote. Injected into the system prompt so the model has
 * persistent awareness across sessions.
 */
export async function getCurrentProjectContext(): Promise<string> {
  if (!_currentProjectId) return ''
  try {
    const state = await loadDirectorState()
    return getProjectContext(state, _currentProjectId)
  } catch {
    return ''
  }
}

export function getCurrentProjectId(): string {
  return _currentProjectId
}
