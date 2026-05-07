import type { LocalJSXCommandCall } from '../../types/command.js'
import {
  isSignalActive,
  isSignalConfigured,
  isSignalCliAvailable,
  sendSignalMessage,
  getSignalRecipient,
} from '../../services/signal/signalBot.js'

export const call: LocalJSXCommandCall = async (onDone, _context, args) => {
  const text = (args ?? '').trim()

  if (!text) {
    const active = isSignalActive()
    const configured = isSignalConfigured()
    const cliAvailable = isSignalCliAvailable()

    if (active) {
      onDone(
        `◆ Signal Bridge\n\n  ● Active\n  Recipient: ${getSignalRecipient()}`,
        { display: 'system' },
      )
      return null
    }

    const lines = [
      '◆ Signal Bridge',
      '',
      '  ◌ Not active',
      '',
      'Setup:',
      '  1. Install signal-cli: https://github.com/AsamK/signal-cli',
      `     ${cliAvailable ? '✓' : '✗'} signal-cli ${cliAvailable ? 'found on PATH' : 'not found on PATH'}`,
      '  2. Register your number:',
      '       signal-cli -u +15551234567 register',
      '  3. Verify (enter code received via SMS):',
      '       signal-cli -u +15551234567 verify <CODE>',
      '  4. Set environment variables:',
      '       export SIGNAL_NUMBER=+15551234567',
      '       export SIGNAL_RECIPIENT=+15559876543',
      '  5. Restart localclawd',
    ]
    if (configured) {
      lines.push('')
      lines.push('  Env vars are set but the bridge failed to start.')
      lines.push('  Check that signal-cli is installed and the number is registered.')
    }
    onDone(lines.join('\n'), { display: 'system' })
    return null
  }

  if (!isSignalActive()) {
    onDone('✗ Signal: bridge not active. Run /signal for setup instructions.', { display: 'system' })
    return null
  }

  try {
    await sendSignalMessage(text)
  } catch (e) {
    onDone(`✗ Signal send failed: ${e instanceof Error ? e.message : String(e)}`, { display: 'system' })
    return null
  }

  onDone(`◆ Signal — Sent: "${text.slice(0, 80)}${text.length > 80 ? '…' : ''}"`, { display: 'system' })
  return null
}
