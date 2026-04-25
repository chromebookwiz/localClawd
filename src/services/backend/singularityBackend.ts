/**
 * Singularity / Apptainer backend — run a one-shot command inside a
 * SIF container. Useful on HPC clusters where Docker isn't allowed.
 *
 * Tries the `apptainer` binary first (modern fork), then falls back to
 * `singularity` (legacy/SylabsCloud builds). Same arg syntax.
 */

import { spawn, spawnSync } from 'child_process'
import { logForDebugging } from '../../utils/debug.js'

export interface SingularityRunOptions {
  image: string                  // SIF path or library:// / docker:// URI
  command: string                // shell command to execute inside
  workdir?: string               // host path to bind at /workspace
  bindMounts?: string[]          // additional host:container mounts
  timeoutMs?: number
  onStdout?: (chunk: string) => void
  onStderr?: (chunk: string) => void
}

export interface SingularityRunResult {
  ok: boolean
  stdout: string
  stderr: string
  exitCode: number | null
  binary: string
}

function findBinary(): string | null {
  for (const candidate of ['apptainer', 'singularity']) {
    try {
      const r = spawnSync(candidate, ['--version'], { encoding: 'utf-8', timeout: 5000 })
      if (r.status === 0) return candidate
    } catch { /* try next */ }
  }
  return null
}

export function isSingularityAvailable(): boolean {
  return findBinary() !== null
}

export async function singularityRun(opts: SingularityRunOptions): Promise<SingularityRunResult> {
  const binary = findBinary()
  if (!binary) {
    return {
      ok: false, stdout: '', stderr: 'apptainer/singularity not found on PATH',
      exitCode: null, binary: '',
    }
  }

  const args: string[] = ['exec']

  if (opts.workdir) {
    args.push('--bind', `${opts.workdir}:/workspace`)
    args.push('--pwd', '/workspace')
  }
  if (opts.bindMounts) {
    for (const m of opts.bindMounts) args.push('--bind', m)
  }

  args.push(opts.image)
  args.push('sh', '-c', opts.command)

  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    const child = spawn(binary, args, { shell: false })
    const timer = setTimeout(() => child.kill('SIGTERM'), opts.timeoutMs ?? 10 * 60_000)

    child.stdout.on('data', (c: Buffer) => {
      const s = c.toString('utf-8'); stdout += s; opts.onStdout?.(s)
    })
    child.stderr.on('data', (c: Buffer) => {
      const s = c.toString('utf-8'); stderr += s; opts.onStderr?.(s)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ ok: code === 0, stdout, stderr, exitCode: code, binary })
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      logForDebugging(`[singularity] spawn error: ${err.message}`)
      resolve({ ok: false, stdout, stderr: String(err), exitCode: null, binary })
    })
  })
}
