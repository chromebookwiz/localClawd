/**
 * Windows-first setup helpers — checks the host for tools localclawd
 * benefits from, and offers persistent env-var setting via PowerShell's
 * [Environment]::SetEnvironmentVariable so values survive shell restart.
 *
 * No-op on non-Windows platforms.
 */

import { spawnSync } from 'child_process'

export interface ToolStatus {
  name: string
  command: string
  available: boolean
  version?: string
  hint?: string
}

const TOOLS_TO_CHECK: Array<{ name: string; command: string; args: string[]; hint: string }> = [
  { name: 'Node.js',     command: 'node',     args: ['--version'],   hint: 'https://nodejs.org' },
  { name: 'Git',         command: 'git',      args: ['--version'],   hint: 'https://git-scm.com/download/win  (or `winget install Git.Git`)' },
  { name: 'PowerShell 7', command: 'pwsh',    args: ['--version'],   hint: '`winget install Microsoft.PowerShell` for the modern shell' },
  { name: 'Docker',      command: 'docker',   args: ['--version'],   hint: 'https://docs.docker.com/desktop/install/windows-install/' },
  { name: 'Tailscale',   command: 'tailscale', args: ['version'],    hint: 'https://tailscale.com/download/windows  (peers auto-listed in setup)' },
  { name: 'signal-cli',  command: 'signal-cli', args: ['--version'], hint: 'https://github.com/AsamK/signal-cli  (for /signal bridge)' },
  { name: 'Modal',       command: 'modal',    args: ['--version'],   hint: '`pip install modal`  (for /modal-run)' },
  { name: 'Daytona',     command: 'daytona',  args: ['--version'],   hint: 'https://daytona.io/docs/installation/installation/' },
  { name: 'Apptainer',   command: 'apptainer', args: ['--version'],  hint: 'WSL: `sudo apt install apptainer`  (for /singularity-run)' },
]

export function isWindows(): boolean {
  return process.platform === 'win32'
}

function probe(command: string, args: string[]): { available: boolean; version?: string } {
  try {
    const r = spawnSync(command, args, { encoding: 'utf-8', timeout: 5000, shell: false })
    if (r.status !== 0) return { available: false }
    const version = (r.stdout || r.stderr || '').trim().split('\n')[0]?.slice(0, 80)
    return { available: true, version }
  } catch {
    return { available: false }
  }
}

export function checkAllTools(): ToolStatus[] {
  return TOOLS_TO_CHECK.map(t => {
    const result = probe(t.command, t.args)
    return { name: t.name, command: t.command, ...result, hint: result.available ? undefined : t.hint }
  })
}

/**
 * Set a User-scope persistent env var on Windows via PowerShell.
 * Returns ok=true if the variable was successfully set.
 *
 * Uses -EncodedCommand so values containing special chars are safe.
 */
export async function setPersistentEnvVar(
  name: string,
  value: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!isWindows()) return { ok: false, error: 'Only supported on Windows.' }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    return { ok: false, error: 'Invalid env var name.' }
  }

  const script =
    `[Environment]::SetEnvironmentVariable(${JSON.stringify(name)}, ${JSON.stringify(value)}, 'User')`
  const encoded = Buffer.from(script, 'utf16le').toString('base64')

  return new Promise((resolve) => {
    const r = spawnSync(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
      { encoding: 'utf-8', timeout: 10_000 },
    )
    if (r.status === 0) {
      // Also set for this process so the change is immediately visible
      process.env[name] = value
      resolve({ ok: true })
    } else {
      resolve({ ok: false, error: r.stderr || r.stdout || 'powershell exited non-zero' })
    }
  })
}

/** Get a User-scope persistent env var (Windows only). */
export function getPersistentEnvVar(name: string): string | null {
  if (!isWindows()) return null
  const script = `[Environment]::GetEnvironmentVariable(${JSON.stringify(name)}, 'User')`
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  try {
    const r = spawnSync(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
      { encoding: 'utf-8', timeout: 5_000 },
    )
    if (r.status === 0) {
      const v = r.stdout.trim()
      return v ? v : null
    }
    return null
  } catch {
    return null
  }
}
