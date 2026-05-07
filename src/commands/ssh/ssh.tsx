import type { LocalJSXCommandCall } from '../../types/command.js'
import { runSsh } from '../../services/backend/sshBackend.js'

export const call: LocalJSXCommandCall = async (onDone, _context, args) => {
  const input = (args ?? '').trim()
  if (!input) {
    onDone('Usage: /ssh <user@host> <command>', { display: 'system' })
    return null
  }

  const match = input.match(/^(\S+)\s+([\s\S]+)$/)
  if (!match) {
    onDone('/ssh requires both a target and a command.\nUsage: /ssh <user@host> <command>', { display: 'system' })
    return null
  }
  const target = match[1]!
  const command = match[2]!

  let result: Awaited<ReturnType<typeof runSsh>>
  try {
    result = await runSsh({ target, command })
  } catch (e) {
    onDone(`✗ ssh failed: ${e instanceof Error ? e.message : String(e)}`)
    return null
  }

  const lines: string[] = [
    `◆ ssh ${target}  [exit ${result.exitCode ?? 'timed out'}]`,
    `  $ ${command}`,
  ]
  const outLines = result.stdout.trim().split('\n').filter(Boolean).slice(-20)
  const errLines = result.stderr.trim().split('\n').filter(Boolean).slice(-10)
  if (outLines.length > 0) {
    lines.push('stdout:')
    for (const l of outLines) lines.push(`  ${l}`)
  }
  if (errLines.length > 0) {
    lines.push('stderr:')
    for (const l of errLines) lines.push(`  ${l}`)
  }

  onDone(lines.join('\n'))
  return null
}
