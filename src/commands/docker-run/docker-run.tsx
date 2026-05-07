import type { LocalJSXCommandCall } from '../../types/command.js'
import { dockerRun, isDockerAvailable } from '../../services/backend/dockerBackend.js'
import { getOriginalCwd } from '../../bootstrap/state.js'

export const call: LocalJSXCommandCall = async (onDone, _context, args) => {
  const input = (args ?? '').trim()
  if (!input) {
    onDone('Usage: /docker-run <image> -- <command>\nExample: /docker-run python:3.12 -- python -c "print(\'hi\')"', { display: 'system' })
    return null
  }

  if (!isDockerAvailable()) {
    onDone('✗ docker CLI not found on PATH. Install Docker Desktop or the docker package.')
    return null
  }

  const sepIdx = input.indexOf(' -- ')
  if (sepIdx < 0) {
    onDone('/docker-run requires " -- " between the image and the command.\nUsage: /docker-run <image> -- <command>', { display: 'system' })
    return null
  }
  const image = input.slice(0, sepIdx).trim()
  const command = input.slice(sepIdx + 4).trim()
  if (!image || !command) {
    onDone('Both an image and a command are required.', { display: 'system' })
    return null
  }

  let result: Awaited<ReturnType<typeof dockerRun>>
  try {
    result = await dockerRun({ image, command, workdir: getOriginalCwd() })
  } catch (e) {
    onDone(`✗ docker-run failed: ${e instanceof Error ? e.message : String(e)}`)
    return null
  }

  const lines: string[] = [
    `◆ docker-run ${image}  [exit ${result.exitCode ?? 'timed out'}]`,
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
