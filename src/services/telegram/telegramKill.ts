/**
 * Kill all running localclawd instances.
 *
 * Reads PID files from ~/.claude/sessions/ (written by concurrentSessions.ts)
 * and sends SIGTERM to each. Skips self — caller should handle self-termination.
 */

import { readdir, readFile, unlink } from 'fs/promises'
import { join } from 'path'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { logForDebugging } from '../../utils/debug.js'

export async function killAllInstances(): Promise<number> {
  const sessionsDir = join(getClaudeConfigHomeDir(), 'sessions')
  let files: string[]
  try {
    files = await readdir(sessionsDir)
  } catch {
    return 0
  }

  let killed = 0
  for (const file of files) {
    if (!/^\d+\.json$/.test(file)) continue
    const pid = parseInt(file.slice(0, -5), 10)
    if (isNaN(pid) || pid === process.pid) continue

    try {
      process.kill(pid, 'SIGTERM')
      killed++
      logForDebugging(`[telegram-kill] Sent SIGTERM to PID ${pid}`)
    } catch {
      // Process already dead — clean up stale PID file
      await unlink(join(sessionsDir, file)).catch(() => {})
    }
  }

  return killed
}

/**
 * Kill all instances including self. Delays self-kill so the caller
 * can finish sending confirmations (e.g. Telegram message).
 */
export async function killAllIncludingSelf(): Promise<number> {
  const killed = await killAllInstances()
  // Kill self after a short delay for confirmation messages
  setTimeout(() => process.kill(process.pid, 'SIGTERM'), 500)
  return killed
}
