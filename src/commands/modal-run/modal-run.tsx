/**
 * /modal-run <entrypoint> [args...]
 *
 * Wraps `modal run`. Entrypoint is "module.py" or "module.py::function".
 * Args after the entrypoint are passed to the Modal function.
 *
 * Examples:
 *   /modal-run train.py::main
 *   /modal-run app.py::handler -- --epochs 5
 */

import * as React from 'react'
import { Box, Text } from '../../ink.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import {
  modalRun,
  isModalAvailable,
  isModalAuthed,
} from '../../services/backend/modalBackend.js'
import { getOriginalCwd } from '../../bootstrap/state.js'
import { AutoDone } from '../../components/AutoDone.js'

function Result({
  entrypoint, exitCode, stdout, stderr, onReady,
}: {
  entrypoint: string
  exitCode: number | null
  stdout: string
  stderr: string
  onReady: () => void
}): React.ReactNode {
  React.useEffect(() => {
    const id = setTimeout(onReady, 0)
    return () => clearTimeout(id)
  }, [onReady])

  const ok = exitCode === 0
  const outLines = stdout.trim().split('\n').slice(-20)
  const errLines = stderr.trim().split('\n').slice(-10)

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color={ok ? 'green' : 'red'}>
        {`◆ modal run ${entrypoint}  [exit ${exitCode ?? 'timed out'}]`}
      </Text>
      {outLines[0] && (
        <Box flexDirection="column" marginLeft={2} marginTop={1}>
          <Text bold>{'stdout:'}</Text>
          {outLines.map((l, i) => <Text key={i} dimColor>{`  ${l}`}</Text>)}
        </Box>
      )}
      {errLines[0] && (
        <Box flexDirection="column" marginLeft={2} marginTop={1}>
          <Text bold color="red">{'stderr:'}</Text>
          {errLines.map((l, i) => <Text key={i} color="red">{`  ${l}`}</Text>)}
        </Box>
      )}
    </Box>
  )
}

export const call: LocalJSXCommandCall = async (onDone, _ctx, args) => {
  const input = (args ?? '').trim()
  if (!input) {
    return (
      <AutoDone onDone={onDone}>
        <Box marginTop={1}>
          <Text color="yellow" wrap="wrap">
            {'Usage: /modal-run <module.py>[::function] [-- args...]\n' +
              'Example: /modal-run train.py::main -- --epochs 5'}
          </Text>
        </Box>
      </AutoDone>
    )
  }

  if (!isModalAvailable()) {
    return (
      <AutoDone onDone={onDone}>
        <Box marginTop={1}>
          <Text color="red" wrap="wrap">
            {'✗ modal CLI not found. Install with `pip install modal`, then `modal token set`.'}
          </Text>
        </Box>
      </AutoDone>
    )
  }

  if (!isModalAuthed()) {
    return (
      <AutoDone onDone={onDone}>
        <Box marginTop={1}>
          <Text color="yellow" wrap="wrap">
            {'⚠ modal is not authenticated. Run `modal token set` outside of localclawd first.'}
          </Text>
        </Box>
      </AutoDone>
    )
  }

  // Split entrypoint from args at the first " -- "
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
    return (
      <AutoDone onDone={onDone}>
        <Box marginTop={1}><Text color="red">{`✗ modal-run failed: ${e instanceof Error ? e.message : String(e)}`}</Text></Box>
      </AutoDone>
    )
  }

  return (
    <Result
      entrypoint={entrypoint}
      exitCode={result.exitCode}
      stdout={result.stdout}
      stderr={result.stderr}
      onReady={() => onDone(undefined)}
    />
  )
}
