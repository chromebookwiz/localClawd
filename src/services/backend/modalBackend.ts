/**
 * Modal backend — run a command on Modal's serverless compute via the
 * `modal` CLI. The user must have run `modal token set` already.
 *
 * Modal apps are usually defined as Python files. This backend uses
 * `modal run <module>::function -- <args>` for one-shot execution.
 *
 * For a generic shell command, we point at a small wrapper script
 * pattern (modal_runner.py) which the user can drop in their repo.
 * If they have their own Modal entrypoint, they pass it as the image
 * argument (e.g. "myapp.py::my_func").
 */

import { spawn, spawnSync } from 'child_process'
import { logForDebugging } from '../../utils/debug.js'

export interface ModalRunOptions {
  entrypoint: string               // "module.py::function_name" or just "module.py"
  args?: string[]                  // arguments passed after `--`
  timeoutMs?: number
  cwd?: string
  onStdout?: (chunk: string) => void
  onStderr?: (chunk: string) => void
}

export interface ModalRunResult {
  ok: boolean
  stdout: string
  stderr: string
  exitCode: number | null
}

export function isModalAvailable(): boolean {
  try {
    const r = spawnSync('modal', ['--version'], { encoding: 'utf-8', timeout: 5000 })
    return r.status === 0
  } catch { return false }
}

export function isModalAuthed(): boolean {
  try {
    const r = spawnSync('modal', ['token', 'current'], { encoding: 'utf-8', timeout: 5000 })
    return r.status === 0
  } catch { return false }
}

export async function modalRun(opts: ModalRunOptions): Promise<ModalRunResult> {
  if (!isModalAvailable()) {
    return { ok: false, stdout: '', stderr: 'modal CLI not found. Install: pip install modal', exitCode: null }
  }

  const args = ['run', opts.entrypoint]
  if (opts.args && opts.args.length > 0) {
    args.push('--', ...opts.args)
  }

  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    const child = spawn('modal', args, { shell: false, cwd: opts.cwd })
    const timer = setTimeout(() => child.kill('SIGTERM'), opts.timeoutMs ?? 30 * 60_000)

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
      logForDebugging(`[modal] spawn error: ${err.message}`)
      resolve({ ok: false, stdout, stderr: String(err), exitCode: null })
    })
  })
}
