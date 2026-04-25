/**
 * /windows-setup — diagnose Windows host prerequisites for localclawd
 * integrations.
 *
 * Lists each tool that localclawd can use, whether it's installed,
 * and a one-line install hint when it's missing. Works on non-Windows
 * too (just doesn't offer the persistent-env-var advice).
 */

import * as React from 'react'
import { Box, Text } from '../../ink.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import { checkAllTools, isWindows } from '../../services/windows/windowsSetup.js'

function ToolList({
  onReady,
}: {
  onReady: () => void
}): React.ReactNode {
  const tools = React.useMemo(() => checkAllTools(), [])
  React.useEffect(() => {
    const id = setTimeout(onReady, 0)
    return () => clearTimeout(id)
  }, [onReady])

  const installed = tools.filter(t => t.available)
  const missing = tools.filter(t => !t.available)

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color="#6366f1">{'◆ Host Diagnostic'}</Text>
      <Text dimColor>{`Platform: ${process.platform}  ·  Node ${process.version}`}</Text>

      {installed.length > 0 ? (
        <Box flexDirection="column" marginTop={1} marginLeft={2}>
          <Text bold color="green">{'Installed:'}</Text>
          {installed.map(t => (
            <Text key={t.name} color="green">{`  ✓ ${t.name.padEnd(14)} ${t.version ?? ''}`}</Text>
          ))}
        </Box>
      ) : null}

      {missing.length > 0 ? (
        <Box flexDirection="column" marginTop={1} marginLeft={2}>
          <Text bold color="yellow">{'Optional / not installed:'}</Text>
          {missing.map(t => (
            <Box key={t.name} flexDirection="column">
              <Text color="yellow">{`  ◌ ${t.name}`}</Text>
              {t.hint ? <Text dimColor>{`      ${t.hint}`}</Text> : null}
            </Box>
          ))}
        </Box>
      ) : null}

      {isWindows() ? (
        <Box flexDirection="column" marginTop={1} marginLeft={2}>
          <Text bold>{'Persistent env vars on Windows'}</Text>
          <Text dimColor wrap="wrap">
            {'localclawd reads tokens (TELEGRAM_BOT_TOKEN, SLACK_BOT_TOKEN, '}
            {'GROQ_API_KEY, OPENAI_API_KEY, etc.) from environment variables. '}
            {'To set them so they survive shell restarts, run from a PowerShell '}
            {'window (no admin needed):'}
          </Text>
          <Text color="cyan">
            {'    [Environment]::SetEnvironmentVariable("GROQ_API_KEY", "<value>", "User")'}
          </Text>
          <Text dimColor>
            {'  Then close + reopen any terminals so the new value is picked up.'}
          </Text>
        </Box>
      ) : (
        <Box flexDirection="column" marginTop={1} marginLeft={2}>
          <Text dimColor>{'(Persistent env-var advice is shown on Windows hosts.)'}</Text>
        </Box>
      )}
    </Box>
  )
}

export const call: LocalJSXCommandCall = async (onDone) => {
  return <ToolList onReady={() => onDone(undefined)} />
}
