import memoize from 'lodash-es/memoize.js'
import { existsSync, readFileSync } from 'fs'
import { join, normalize, sep } from 'path'
import {
  getIsNonInteractiveSession,
  getProjectRoot,
} from '../bootstrap/state.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import { isEnvDefinedFalsy, isEnvTruthy } from '../utils/envUtils.js'
import { findCanonicalGitRoot } from '../utils/git.js'
import { getInitialSettings } from '../utils/settings/settings.js'

const AUTO_MEM_DIRNAME = 'memory'
const AUTO_MEM_ENTRYPOINT_NAME = 'MEMORY.md'

/**
 * Whether project memory features are enabled.
 *
 * Enabled by default. First defined value wins:
 * 1. LOCALCLAWD_DISABLE_MEMORY env var.
 * 2. Project .localclawd/memory/config.json.
 * 3. Legacy disable env var, for compatibility with older installs.
 * 4. Bare mode.
 * 5. autoMemoryEnabled in settings.
 */
export function isAutoMemoryEnabled(): boolean {
  const localclawdEnvVal = process.env.LOCALCLAWD_DISABLE_MEMORY
  if (isEnvTruthy(localclawdEnvVal)) return false
  if (isEnvDefinedFalsy(localclawdEnvVal)) return true

  const projectConfig = readProjectMemoryConfig()
  if (projectConfig?.enabled !== undefined) {
    return projectConfig.enabled
  }

  const legacyEnvVal = process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY
  if (isEnvTruthy(legacyEnvVal)) return false
  if (isEnvDefinedFalsy(legacyEnvVal)) return true

  if (isEnvTruthy(process.env.CLAUDE_CODE_SIMPLE)) {
    return false
  }

  const settings = getInitialSettings()
  if (settings.autoMemoryEnabled !== undefined) {
    return settings.autoMemoryEnabled
  }
  return true
}

/**
 * Whether the background extraction agent will run this session.
 */
export function isExtractModeActive(): boolean {
  if (!getFeatureValue_CACHED_MAY_BE_STALE('tengu_passport_quail', false)) {
    return false
  }
  return (
    !getIsNonInteractiveSession() ||
    getFeatureValue_CACHED_MAY_BE_STALE('tengu_slate_thimble', false)
  )
}

/**
 * Returns the canonical project root used for memory path detection.
 */
export function getMemoryBaseDir(): string {
  return getAutoMemBase()
}

/**
 * Returns the per-project persistent memory root.
 */
export function getProjectMemoryBaseDir(): string {
  return join(getAutoMemBase(), '.localclawd').normalize('NFC')
}

export function getProjectMemoryConfigPath(): string {
  return join(getProjectMemoryBaseDir(), AUTO_MEM_DIRNAME, 'config.json')
}

function readProjectMemoryConfig(): { enabled?: boolean } | null {
  const path = getProjectMemoryConfigPath()
  if (!existsSync(path)) return null
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as {
      enabled?: unknown
    }
    return typeof parsed.enabled === 'boolean'
      ? { enabled: parsed.enabled }
      : null
  } catch {
    return null
  }
}

/**
 * Memory is intentionally project-local in localclawd. Returning false keeps
 * filesystem permission checks on the normal project-memory path.
 */
export function hasAutoMemPathOverride(): boolean {
  return false
}

function getAutoMemBase(): string {
  return findCanonicalGitRoot(getProjectRoot()) ?? getProjectRoot()
}

/**
 * Returns the auto-memory directory path:
 * <projectRoot>/.localclawd/memory/
 */
export const getAutoMemPath = memoize(
  (): string => {
    return (join(getProjectMemoryBaseDir(), AUTO_MEM_DIRNAME) + sep).normalize(
      'NFC',
    )
  },
  () => getProjectRoot(),
)

/**
 * Returns the daily log file path for the given date.
 */
export function getAutoMemDailyLogPath(date: Date = new Date()): string {
  const yyyy = date.getFullYear().toString()
  const mm = (date.getMonth() + 1).toString().padStart(2, '0')
  const dd = date.getDate().toString().padStart(2, '0')
  return join(getAutoMemPath(), 'logs', yyyy, mm, `${yyyy}-${mm}-${dd}.md`)
}

export function getAutoMemEntrypoint(): string {
  return join(getAutoMemPath(), AUTO_MEM_ENTRYPOINT_NAME)
}

export function isAutoMemPath(absolutePath: string): boolean {
  const normalizedPath = normalize(absolutePath)
  if (process.platform === 'win32') {
    return normalizedPath.toLowerCase().startsWith(getAutoMemPath().toLowerCase())
  }
  return normalizedPath.startsWith(getAutoMemPath())
}
