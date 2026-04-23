/**
 * /docker-run <image> -- <command>
 *
 * Run a command in a throwaway container. Bind-mounts the current
 * working directory at /workspace so the command can read/write project
 * files.
 *
 * Examples:
 *   /docker-run python:3.12 -- python -c "print('hi')"
 *   /docker-run node:20-alpine -- npm test
 *   /docker-run ghcr.io/my/cli:latest -- my-cli --help
 */

import * as React from 'react'
import { Box, Text } from '../../ink.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import { dockerRun, isDockerAvailable } from '../../services/backend/dockerBackend.js'
import { getOriginalCwd } from '../../bootstrap/state.js'

function Result({
  image,
  command,
  exitCode,
  stdout,
  stderr,
  onReady,
}: {
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
        {`◆ docker-run ${image}  [exit ${exitCode ?? 'timed out'}]`}
      </Text>
      <Text dimColor>{`  $ ${command}`}</Text>
      {outLines.length > 0 && outLines[0] && (
        <Box flexDirection="column" marginLeft={2} marginTop={1}>
          <Text bold>{'stdout:'}</Text>
          {outLines.map((line, i) => (
            <Text key={i} dimColor>{`  ${line}`}</Text>
          ))}
        </Box>
      )}
      {errLines.length > 0 && errLines[0] && (
        <Box flexDirection="column" marginLeft={2} marginTop={1}>
          <Text bold color="red">{'stderr:'}</Text>
          {errLines.map((line, i) => (
            <Text key={i} color="red">{`  ${line}`}</Text>
          ))}
        </Box>
      )}
    </Box>
  )
}

export const call: LocalJSXCommandCall = async (onDone, _context, args) => {
  const input = (args ?? '').trim()
  if (!input) {
    return (
      <Box marginTop={1}>
        <Text color="yellow" wrap="wrap">
          {'Usage: /docker-run <image> -- <command>\n' +
            'Example: /docker-run python:3.12 -- python -c "print(\'hi\')"'}
        </Text>
      </Box>
    )
  }

  if (!isDockerAvailable()) {
    return (
      <Box marginTop={1}>
        <Text color="red">{'✗ docker CLI not found on PATH. Install Docker Desktop or the docker package.'}</Text>
      </Box>
    )
  }

  // Split on the first " -- " — anything before is the image, anything after is the command
  const sepIdx = input.indexOf(' -- ')
  if (sepIdx < 0) {
    return (
      <Box marginTop={1}>
        <Text color="red">{'/docker-run requires " -- " between the image and the command.'}</Text>
      </Box>
    )
  }
  const image = input.slice(0, sepIdx).trim()
  const command = input.slice(sepIdx + 4).trim()
  if (!image || !command) {
    return (
      <Box marginTop={1}>
        <Text color="red">{'Both an image and a command are required.'}</Text>
      </Box>
    )
  }

  const result = await dockerRun({
    image,
    command,
    workdir: getOriginalCwd(),
  })

  return (
    <Result
      image={image}
      command={command}
      exitCode={result.exitCode}
      stdout={result.stdout}
      stderr={result.stderr}
      onReady={() => onDone(undefined)}
    />
  )
}
