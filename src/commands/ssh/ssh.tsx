/**
 * /ssh <user@host> <command> — run a command on a remote host.
 *
 * Useful for driving localclawd (or any shell command) on a remote
 * machine without leaving this TUI.
 */

import * as React from 'react'
import { Box, Text } from '../../ink.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import { runSsh } from '../../services/backend/sshBackend.js'
import { AutoDone } from '../../components/AutoDone.js'

function SshResult({
  target,
  command,
  exitCode,
  stdout,
  stderr,
  onReady,
}: {
  target: string
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
        {`◆ ssh ${target}  [exit ${exitCode ?? 'timed out'}]`}
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
      <AutoDone onDone={onDone}>
        <Box marginTop={1}>
          <Text color="yellow">{'Usage: /ssh <user@host> <command>'}</Text>
        </Box>
      </AutoDone>
    )
  }

  // First whitespace-separated token is the target; the rest is the command
  const match = input.match(/^(\S+)\s+([\s\S]+)$/)
  if (!match) {
    return (
      <AutoDone onDone={onDone}>
        <Box marginTop={1}>
          <Text color="red">{'/ssh requires both a target and a command.'}</Text>
        </Box>
      </AutoDone>
    )
  }
  const target = match[1]!
  const command = match[2]!

  let result: Awaited<ReturnType<typeof runSsh>>
  try {
    result = await runSsh({ target, command })
  } catch (e) {
    return (
      <AutoDone onDone={onDone}>
        <Box marginTop={1}><Text color="red">{`✗ ssh failed: ${e instanceof Error ? e.message : String(e)}`}</Text></Box>
      </AutoDone>
    )
  }

  return (
    <SshResult
      target={target}
      command={command}
      exitCode={result.exitCode}
      stdout={result.stdout}
      stderr={result.stderr}
      onReady={() => onDone(undefined)}
    />
  )
}
