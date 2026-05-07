import type { LocalJSXCommandCall } from '../../types/command.js'
import { daytonaRun, isDaytonaAvailable } from '../../services/backend/daytonaBackend.js'

export const call: LocalJSXCommandCall = async (onDone, _ctx, args) => {
  const input = (args ?? '').trim()
  if (!input) {
    onDone('Usage: /daytona-run <workspace> -- <command>\nExample: /daytona-run my-workspace -- npm test', { display: 'system' })
    return null
  }

  if (!isDaytonaAvailable()) {
    onDone('✗ daytona CLI not found on PATH.')
    return null
  }

  const sepIdx = input.indexOf(' -- ')
  if (sepIdx < 0) {
    onDone('/daytona-run requires " -- " between workspace and command.', { display: 'system' })
    return null
  }
  const workspace = input.slice(0, sepIdx).trim()
  const command = input.slice(sepIdx + 4).trim()
  if (!workspace || !command) {
    onDone('Both a workspace name and a command are required.', { display: 'system' })
    return null
  }

  let result: Awaited<ReturnType<typeof daytonaRun>>
  try {
    result = await daytonaRun({ workspace, command })
  } catch (e) {
    onDone(`✗ daytona-run failed: ${e instanceof Error ? e.message : String(e)}`)
    return null
  }

  const lines: string[] = [
    `◆ daytona ${workspace}  [exit ${result.exitCode ?? 'timed out'}]`,
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
