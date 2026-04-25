/**
 * /daytona-run <workspace> -- <command>
 *
 * Runs a command via `daytona ssh`. The workspace must already exist
 * and be accessible — create one with `daytona create` outside of
 * localclawd if needed.
 */

import * as React from 'react'
import { Box, Text } from '../../ink.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import { daytonaRun, isDaytonaAvailable } from '../../services/backend/daytonaBackend.js'

function Result({
  workspace, command, exitCode, stdout, stderr, onReady,
}: {
  workspace: string
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
        {`◆ daytona ${workspace}  [exit ${exitCode ?? 'timed out'}]`}
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
      <Box marginTop={1}>
        <Text color="yellow" wrap="wrap">
          {'Usage: /daytona-run <workspace> -- <command>\n' +
            'Example: /daytona-run my-workspace -- npm test'}
        </Text>
      </Box>
    )
  }

  if (!isDaytonaAvailable()) {
    return (
      <Box marginTop={1}>
        <Text color="red">{'✗ daytona CLI not found on PATH.'}</Text>
      </Box>
    )
  }

  const sepIdx = input.indexOf(' -- ')
  if (sepIdx < 0) {
    return <Box marginTop={1}><Text color="red">{'/daytona-run requires " -- " between workspace and command.'}</Text></Box>
  }
  const workspace = input.slice(0, sepIdx).trim()
  const command = input.slice(sepIdx + 4).trim()
  if (!workspace || !command) {
    return <Box marginTop={1}><Text color="red">{'Both a workspace name and a command are required.'}</Text></Box>
  }

  const result = await daytonaRun({ workspace, command })
  return (
    <Result
      workspace={workspace}
      command={command}
      exitCode={result.exitCode}
      stdout={result.stdout}
      stderr={result.stderr}
      onReady={() => onDone(undefined)}
    />
  )
}
