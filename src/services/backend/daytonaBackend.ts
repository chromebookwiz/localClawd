/**
 * Daytona backend — run a command in a Daytona workspace.
 *
 * Daytona is a dev-environment-as-a-service: workspaces hibernate when
 * idle and wake on demand. Requires `daytona` CLI installed and the
 * user authenticated (`daytona auth login`).
 *
 * This backend takes a workspace name + command and runs:
 *   daytona ssh <workspace> -c "<command>"
 *
 * If the workspace doesn't exist yet, the user creates it once via
 * `daytona create` outside of this command.
 */

import { spawn, spawnSync } from 'child_process'
import { logForDebugging } from '../../utils/debug.js'

export interface DaytonaRunOptions {
  workspace: string                 // workspace name
  command: string                   // shell command to run inside
  timeoutMs?: number
  onStdout?: (chunk: string) => void
  onStderr?: (chunk: string) => void
}

export interface DaytonaRunResult {
  ok: boolean
  stdout: string
  stderr: string
  exitCode: number | null
}

export function isDaytonaAvailable(): boolean {
  try {
    const r = spawnSync('daytona', ['--version'], { encoding: 'utf-8', timeout: 5000 })
    return r.status === 0
  } catch { return false }
}

export async function daytonaRun(opts: DaytonaRunOptions): Promise<DaytonaRunResult> {
  if (!isDaytonaAvailable()) {
    return {
      ok: false, stdout: '',
      stderr: 'daytona CLI not found. See https://daytona.io/docs/installation/installation/',
      exitCode: null,
    }
  }

  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    const child = spawn(
      'daytona',
      ['ssh', opts.workspace, '-c', opts.command],
      { shell: false },
    )
    const timer = setTimeout(() => child.kill('SIGTERM'), opts.timeoutMs ?? 10 * 60_000)

    child.stdout.on('data', (c: Buffer) => {
      const s = c.toString('utf-8'); stdout += s; opts.onStdout?.(s)
    })
    child.stderr.on('data', (c: Buffer) => {
      const s = c.toString('utf-8'); stderr += s; opts.onStderr?.(s)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ ok: code === 0, stdout, stderr, exitCode: code })
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      logForDebugging(`[daytona] spawn error: ${err.message}`)
      resolve({ ok: false, stdout, stderr: String(err), exitCode: null })
    })
  })
}
