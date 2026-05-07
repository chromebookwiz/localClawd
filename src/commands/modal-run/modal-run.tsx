import type { LocalJSXCommandCall } from '../../types/command.js'
import { modalRun, isModalAvailable, isModalAuthed } from '../../services/backend/modalBackend.js'
import { getOriginalCwd } from '../../bootstrap/state.js'

export const call: LocalJSXCommandCall = async (onDone, _ctx, args) => {
  const input = (args ?? '').trim()
  if (!input) {
    onDone('Usage: /modal-run <module.py>[::function] [-- args...]\nExample: /modal-run train.py::main -- --epochs 5', { display: 'system' })
    return null
  }

  if (!isModalAvailable()) {
    onDone('✗ modal CLI not found. Install with `pip install modal`, then `modal token set`.')
    return null
  }

  if (!isModalAuthed()) {
    onDone('⚠ modal is not authenticated. Run `modal token set` outside of localclawd first.')
    return null
  }

  const sepIdx = input.indexOf(' -- ')
  let entrypoint: string
  let extraArgs: string[]
  if (sepIdx >= 0) {
    entrypoint = input.slice(0, sepIdx).trim()
    extraArgs = input.slice(sepIdx + 4).trim().split(/\s+/).filter(Boolean)
  } else {
    entrypoint = input
    extraArgs = []
  }

  let result: Awaited<ReturnType<typeof modalRun>>
  try {
    result = await modalRun({ entrypoint, args: extraArgs, cwd: getOriginalCwd() })
  } catch (e) {
    onDone(`✗ modal-run failed: ${e instanceof Error ? e.message : String(e)}`)
    return null
  }

  const lines: string[] = [`◆ modal run ${entrypoint}  [exit ${result.exitCode ?? 'timed out'}]`]
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
