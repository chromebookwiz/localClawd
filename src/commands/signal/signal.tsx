/**
 * /signal — Signal bridge status / send.
 *
 * Setup is not interactive because `signal-cli` requires manual
 * registration + verification (SMS code) that can't be driven from a TUI.
 * Instead this command shows status and the setup instructions.
 */

import * as React from 'react'
import { Box, Text } from '../../ink.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import {
  isSignalActive,
  isSignalConfigured,
  isSignalCliAvailable,
  sendSignalMessage,
  getSignalRecipient,
} from '../../services/signal/signalBot.js'

function SignalStatus({ onReady }: { onReady: () => void }): React.ReactNode {
  const active = isSignalActive()
  const configured = isSignalConfigured()
  const cliAvailable = isSignalCliAvailable()

  React.useEffect(() => {
    const id = setTimeout(onReady, 100)
    return () => clearTimeout(id)
  }, [onReady])

  if (active) {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text bold color="#6366f1">{'◆ Signal Bridge'}</Text>
        <Text color="green">{'  ● Active'}</Text>
        <Text dimColor>{`  Recipient: ${getSignalRecipient()}`}</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color="#6366f1">{'◆ Signal Bridge'}</Text>
      <Text color="yellow">{'  ◌ Not active'}</Text>
      <Text>{''}</Text>
      <Text bold>{'Setup:'}</Text>
      <Box flexDirection="column" marginLeft={2}>
        <Text>{`  1. Install signal-cli: https://github.com/AsamK/signal-cli`}</Text>
        <Text color={cliAvailable ? 'green' : 'red'}>
          {`     ${cliAvailable ? '✓' : '✗'} signal-cli ${cliAvailable ? 'found on PATH' : 'not found on PATH'}`}
        </Text>
        <Text>{'  2. Register your number:'}</Text>
        <Text dimColor>{'       signal-cli -u +15551234567 register'}</Text>
        <Text>{'  3. Verify (enter code received via SMS):'}</Text>
        <Text dimColor>{'       signal-cli -u +15551234567 verify <CODE>'}</Text>
        <Text>{'  4. Set environment variables:'}</Text>
        <Text color="cyan">{'       export SIGNAL_NUMBER=+15551234567'}</Text>
        <Text color="cyan">{'       export SIGNAL_RECIPIENT=+15559876543'}</Text>
        <Text>{'  5. Restart localclawd'}</Text>
      </Box>
      {configured ? (
        <Box flexDirection="column" marginTop={1}>
          <Text color="yellow">{'  Env vars are set but the bridge failed to start.'}</Text>
          <Text dimColor>{'  Check that signal-cli is installed and the number is registered.'}</Text>
        </Box>
      ) : null}
    </Box>
  )
}

function SignalSent({ text, onReady }: { text: string; onReady: () => void }): React.ReactNode {
  React.useEffect(() => {
    const id = setTimeout(onReady, 100)
    return () => clearTimeout(id)
  }, [onReady])

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color="#6366f1">{'◆ Signal — Sent'}</Text>
      <Text dimColor>{`  "${text.slice(0, 80)}${text.length > 80 ? '…' : ''}"`}</Text>
    </Box>
  )
}

export const call: LocalJSXCommandCall = async (onDone, _context, args) => {
  const text = (args ?? '').trim()
  if (!text) {
    return <SignalStatus onReady={() => onDone(undefined)} />
  }

  if (!isSignalActive()) {
    return (
      <Box marginTop={1}>
        <Text color="red">{'✗ Signal: bridge not active. Run /signal for setup instructions.'}</Text>
      </Box>
    )
  }

  await sendSignalMessage(text)
  return <SignalSent text={text} onReady={() => onDone(undefined)} />
}
