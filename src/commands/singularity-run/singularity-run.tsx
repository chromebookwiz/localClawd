/**
 * /singularity-run <image> -- <command>
 *
 * Image can be a SIF path, library:// URI, or docker://... URI.
 * The current working directory is bind-mounted at /workspace.
 */

import * as React from 'react'
import { Box, Text } from '../../ink.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import { singularityRun, isSingularityAvailable } from '../../services/backend/singularityBackend.js'
import { getOriginalCwd } from '../../bootstrap/state.js'
import { AutoDone } from '../../components/AutoDone.js'

function Result({
  binary, image, command, exitCode, stdout, stderr, onReady,
}: {
  binary: string
  image: string
  command: string
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
        {`◆ ${binary || 'singularity'} ${image}  [exit ${exitCode ?? 'timed out'}]`}
      </Text>
      <Text dimColor>{`  $ ${command}`}</Text>
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
            {'Usage: /singularity-run <image> -- <command>\n' +
              'Example: /singularity-run docker://python:3.12 -- python -c "print(\'hi\')"'}
          </Text>
        </Box>
      </AutoDone>
    )
  }

  if (!isSingularityAvailable()) {
    return (
      <AutoDone onDone={onDone}>
        <Box marginTop={1}>
          <Text color="red">{'✗ apptainer / singularity not found on PATH.'}</Text>
        </Box>
      </AutoDone>
    )
  }

  const sepIdx = input.indexOf(' -- ')
  if (sepIdx < 0) {
    return (
      <AutoDone onDone={onDone}>
        <Box marginTop={1}><Text color="red">{'/singularity-run requires " -- " between image and command.'}</Text></Box>
      </AutoDone>
    )
  }
  const image = input.slice(0, sepIdx).trim()
  const command = input.slice(sepIdx + 4).trim()
  if (!image || !command) {
    return (
      <AutoDone onDone={onDone}>
        <Box marginTop={1}><Text color="red">{'Both an image and a command are required.'}</Text></Box>
      </AutoDone>
    )
  }

  let result: Awaited<ReturnType<typeof singularityRun>>
  try {
    result = await singularityRun({ image, command, workdir: getOriginalCwd() })
  } catch (e) {
    return (
      <AutoDone onDone={onDone}>
        <Box marginTop={1}><Text color="red">{`✗ singularity-run failed: ${e instanceof Error ? e.message : String(e)}`}</Text></Box>
      </AutoDone>
    )
  }
  return (
    <Result
      binary={result.binary}
      image={image}
      command={command}
      exitCode={result.exitCode}
      stdout={result.stdout}
      stderr={result.stderr}
      onReady={() => onDone(undefined)}
    />
  )
}
