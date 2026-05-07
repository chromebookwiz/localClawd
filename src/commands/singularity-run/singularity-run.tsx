import type { LocalJSXCommandCall } from '../../types/command.js'
import { singularityRun, isSingularityAvailable } from '../../services/backend/singularityBackend.js'
import { getOriginalCwd } from '../../bootstrap/state.js'

export const call: LocalJSXCommandCall = async (onDone, _ctx, args) => {
  const input = (args ?? '').trim()
  if (!input) {
    onDone('Usage: /singularity-run <image> -- <command>\nExample: /singularity-run docker://python:3.12 -- python -c "print(\'hi\')"', { display: 'system' })
    return null
  }

  if (!isSingularityAvailable()) {
    onDone('✗ apptainer / singularity not found on PATH.')
    return null
  }

  const sepIdx = input.indexOf(' -- ')
  if (sepIdx < 0) {
    onDone('/singularity-run requires " -- " between image and command.', { display: 'system' })
    return null
  }
  const image = input.slice(0, sepIdx).trim()
  const command = input.slice(sepIdx + 4).trim()
  if (!image || !command) {
    onDone('Both an image and a command are required.', { display: 'system' })
    return null
  }

  let result: Awaited<ReturnType<typeof singularityRun>>
  try {
    result = await singularityRun({ image, command, workdir: getOriginalCwd() })
  } catch (e) {
    onDone(`✗ singularity-run failed: ${e instanceof Error ? e.message : String(e)}`)
    return null
  }

  const lines: string[] = [
    `◆ ${result.binary || 'singularity'} ${image}  [exit ${result.exitCode ?? 'timed out'}]`,
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
