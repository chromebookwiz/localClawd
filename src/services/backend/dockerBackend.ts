/**
 * Docker backend — run a one-shot command (or localclawd itself) inside
 * a container. Zero new deps: shells out to the `docker` CLI.
 *
 * The host must have Docker installed. No daemon/API talking; we just
 * spawn `docker run ...` and stream output.
 */

import { spawn, spawnSync } from 'child_process'
import { logForDebugging } from '../../utils/debug.js'

export interface DockerRunOptions {
  image: string
  command: string                   // shell command to run inside the container
  workdir?: string                  // host path to bind-mount as /workspace (read-write)
  env?: Record<string, string>      // env vars to pass
  timeoutMs?: number                // default 10 minutes
  network?: 'host' | 'bridge' | string
  onStdout?: (chunk: string) => void
  onStderr?: (chunk: string) => void
}

export interface DockerRunResult {
  ok: boolean
  stdout: string
  stderr: string
  exitCode: number | null
}

export function isDockerAvailable(): boolean {
  try {
    const result = spawnSync('docker', ['--version'], { encoding: 'utf-8', timeout: 5000 })
    return result.status === 0
  } catch {
    return false
  }
}

export async function dockerRun(opts: DockerRunOptions): Promise<DockerRunResult> {
  const args = ['run', '--rm']

  if (opts.network) args.push('--network', opts.network)

  if (opts.workdir) {
    // Mount the host workdir at /workspace and cd there before running the command
    args.push('-v', `${opts.workdir}:/workspace`)
    args.push('-w', '/workspace')
  }

  if (opts.env) {
    for (const [k, v] of Object.entries(opts.env)) {
      args.push('-e', `${k}=${v}`)
    }
  }

  args.push(opts.image)
  // Run the user's command via sh -c to allow pipes, globs, etc.
  args.push('sh', '-c', opts.command)

  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    const child = spawn('docker', args, { shell: false })
    const timer = setTimeout(() => child.kill('SIGTERM'), opts.timeoutMs ?? 10 * 60_000)

    child.stdout.on('data', (c: Buffer) => {
      const s = c.toString('utf-8')
      stdout += s
      opts.onStdout?.(s)
    })
    child.stderr.on('data', (c: Buffer) => {
      const s = c.toString('utf-8')
      stderr += s
      opts.onStderr?.(s)
    })

    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ ok: code === 0, stdout, stderr, exitCode: code })
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      logForDebugging(`[docker] spawn error: ${err.message}`)
      resolve({ ok: false, stdout, stderr: String(err), exitCode: null })
    })
  })
}
