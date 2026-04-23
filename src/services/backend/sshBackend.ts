/**
 * SSH backend — run localclawd tasks on a remote machine over SSH.
 *
 * Launches `ssh <target> <remote-command>` and streams stdout back.
 * Requires `ssh` on the local machine and localclawd (or just a shell
 * command) available on the remote.
 *
 * The remote side can be:
 *   1. A plain shell command ("echo hello") — useful for one-shots
 *   2. An invocation of localclawd on the remote ("localclawd --prompt ...")
 */

import { spawn } from 'child_process'
import { logForDebugging } from '../../utils/debug.js'

export interface SshResult {
  ok: boolean
  stdout: string
  stderr: string
  exitCode: number | null
}

export interface SshOptions {
  target: string                     // user@host or host from ~/.ssh/config
  command: string                    // remote command to execute
  identityFile?: string              // optional -i path
  port?: number                      // optional -p
  timeoutMs?: number                 // default 5 minutes
  onStdout?: (chunk: string) => void // stream callback
  onStderr?: (chunk: string) => void
}

export async function runSsh(opts: SshOptions): Promise<SshResult> {
  const args: string[] = []
  if (opts.port) args.push('-p', String(opts.port))
  if (opts.identityFile) args.push('-i', opts.identityFile)
  // Non-interactive: disable host-key prompts, fail fast on auth issues
  args.push('-o', 'BatchMode=yes')
  args.push('-o', 'StrictHostKeyChecking=accept-new')
  args.push('-o', 'ConnectTimeout=15')
  args.push(opts.target)
  args.push(opts.command)

  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    const child = spawn('ssh', args, { shell: false })

    const timeout = setTimeout(() => {
      child.kill('SIGTERM')
    }, opts.timeoutMs ?? 5 * 60_000)

    child.stdout.on('data', (chunk: Buffer) => {
      const s = chunk.toString('utf-8')
      stdout += s
      opts.onStdout?.(s)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      const s = chunk.toString('utf-8')
      stderr += s
      opts.onStderr?.(s)
    })

    child.on('close', (code) => {
      clearTimeout(timeout)
      resolve({ ok: code === 0, stdout, stderr, exitCode: code })
    })

    child.on('error', (err) => {
      clearTimeout(timeout)
      logForDebugging(`[ssh] spawn error: ${err.message}`)
      resolve({ ok: false, stdout, stderr: String(err), exitCode: null })
    })
  })
}
