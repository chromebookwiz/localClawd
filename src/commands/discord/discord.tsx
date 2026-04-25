/**
 * /discord — Discord bridge: status, send messages, and interactive setup.
 */

import * as React from 'react'
import { Box, Text } from '../../ink.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import {
  isDiscordActive,
  isDiscordConfigured,
  sendDiscordMessage,
  getDiscordChannelId,
  validateDiscordToken,
  validateDiscordChannel,
  initDiscordWithCredentials,
} from '../../services/discord/discordBot.js'
import { Select } from '../../components/CustomSelect/index.js'
import { Dialog } from '../../components/design-system/Dialog.js'
import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'
import { AutoDone } from '../../components/AutoDone.js'

type SetupStep =
  | 'instructions'
  | 'token'
  | 'channel'
  | 'userid'
  | 'validating'
  | 'done'
  | 'error'

function DiscordSetup({ onDone }: { onDone: (msg?: string) => void }): React.ReactNode {
  const [step, setStep] = React.useState<SetupStep>('instructions')
  const [token, setToken] = React.useState('')
  const [channelId, setChannelId] = React.useState('')
  const [userId, setUserId] = React.useState('')
  const [botName, setBotName] = React.useState('')
  const [channelName, setChannelName] = React.useState('')
  const [error, setError] = React.useState('')

  if (step === 'instructions') {
    return (
      <Dialog title="Discord Setup" onCancel={() => onDone()} hideInputGuide>
        <Box flexDirection="column">
          <Text bold>{'Create a Discord bot:'}</Text>
          <Text>{''}</Text>
          <Text>{'  1. Go to https://discord.com/developers/applications → New Application'}</Text>
          <Text>{'  2. Sidebar → Bot → "Reset Token" → copy the bot token'}</Text>
          <Text>{'  3. Enable "Message Content Intent" under Privileged Gateway Intents'}</Text>
          <Text>{'  4. Sidebar → OAuth2 → URL Generator:'}</Text>
          <Text dimColor>{'        Scopes: bot'}</Text>
          <Text dimColor>{'        Bot Permissions: Send Messages, Read Messages, Add Reactions'}</Text>
          <Text>{'  5. Open the generated URL, invite the bot to your server'}</Text>
          <Text>{'  6. Enable Developer Mode in Discord → right-click channel → Copy Channel ID'}</Text>
        </Box>
        <Select
          options={[{ label: 'I have my token — continue', value: 'continue' }]}
          onChange={() => setStep('token')}
        />
      </Dialog>
    )
  }

  if (step === 'token') {
    return (
      <Dialog title="Discord Setup — Bot Token" onCancel={() => onDone()} hideInputGuide>
        <Box flexDirection="column">
          <Text>{'Paste your bot token:'}</Text>
        </Box>
        <Select
          options={[
            {
              label: 'Bot Token',
              value: 'token',
              type: 'input' as const,
              placeholder: 'MTAxxxxx...',
              onChange: (v: string) => setToken(v),
            },
          ]}
          onChange={async () => {
            const trimmed = token.trim()
            if (!trimmed) return
            setStep('validating')
            const result = await validateDiscordToken(trimmed)
            if (result.ok) {
              setBotName(result.username)
              setStep('channel')
            } else {
              setError(`Invalid token: ${result.error}`)
              setStep('error')
            }
          }}
        />
      </Dialog>
    )
  }

  if (step === 'channel') {
    return (
      <Dialog
        title={`Discord Setup — Bot: ${botName}`}
        onCancel={() => onDone()}
        hideInputGuide
      >
        <Box flexDirection="column">
          <Text bold>{'Enter channel ID:'}</Text>
          <Text>{''}</Text>
          <Text dimColor>{'  Right-click channel → Copy Channel ID (requires Developer Mode)'}</Text>
          <Text dimColor>{'  Make sure the bot is a member of the server and can see the channel.'}</Text>
        </Box>
        <Select
          options={[
            {
              label: 'Channel ID',
              value: 'channel',
              type: 'input' as const,
              placeholder: '1234567890123456789',
              onChange: (v: string) => setChannelId(v),
            },
          ]}
          onChange={async () => {
            const trimmed = channelId.trim()
            if (!trimmed) return
            setStep('validating')
            const result = await validateDiscordChannel(token.trim(), trimmed)
            if (result.ok) {
              setChannelName(result.name)
              setStep('userid')
            } else {
              setError(`Channel check failed: ${result.error}`)
              setStep('error')
            }
          }}
        />
      </Dialog>
    )
  }

  if (step === 'userid') {
    return (
      <Dialog
        title={`Discord Setup — Channel: ${channelName}`}
        onCancel={() => onDone()}
        hideInputGuide
      >
        <Box flexDirection="column">
          <Text bold>{'Optional: restrict to a specific user'}</Text>
          <Text>{''}</Text>
          <Text dimColor>{'  Right-click your username → Copy User ID.'}</Text>
          <Text dimColor>{'  Leave blank to accept messages from anyone in the channel.'}</Text>
        </Box>
        <Select
          options={[
            {
              label: 'User ID (optional)',
              value: 'userid',
              type: 'input' as const,
              placeholder: '1234567890123456789  (or leave blank)',
              onChange: (v: string) => setUserId(v),
            },
          ]}
          onChange={async () => {
            setStep('validating')
            const result = await initDiscordWithCredentials(
              token.trim(),
              channelId.trim(),
              userId.trim() || undefined,
            )
            if (result.ok) {
              await saveConfig(token.trim(), channelId.trim(), userId.trim() || undefined)
              setStep('done')
            } else {
              setError(`Connection failed: ${result.error}`)
              setStep('error')
            }
          }}
        />
      </Dialog>
    )
  }

  if (step === 'validating') {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text bold color="#6366f1">{'◆ Discord Setup — Validating...'}</Text>
      </Box>
    )
  }

  if (step === 'error') {
    return (
      <Dialog title="Discord Setup — Error" onCancel={() => onDone()} hideInputGuide>
        <Box flexDirection="column">
          <Text color="red">{error}</Text>
        </Box>
        <Select
          options={[{ label: 'Retry from the beginning', value: 'retry' }]}
          onChange={() => {
            setError(''); setToken(''); setChannelId(''); setUserId('')
            setStep('instructions')
          }}
        />
      </Dialog>
    )
  }

  return (
    <DiscordSetupDone
      botName={botName}
      channelName={channelName}
      channelId={channelId}
      onReady={() => onDone(undefined)}
    />
  )
}

function DiscordSetupDone({
  botName,
  channelName,
  channelId,
  onReady,
}: {
  botName: string
  channelName: string
  channelId: string
  onReady: () => void
}): React.ReactNode {
  React.useEffect(() => {
    const id = setTimeout(onReady, 100)
    return () => clearTimeout(id)
  }, [onReady])

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color="green">{'◆ Discord Connected!'}</Text>
      <Box flexDirection="column" marginLeft={2}>
        <Text>{`  Bot: ${botName}`}</Text>
        <Text>{`  Channel: ${channelName} (${channelId})`}</Text>
        <Text>{''}</Text>
        <Text>{'  Saved to ~/.claude/discord.json'}</Text>
        <Text>{'  Loaded automatically on next startup.'}</Text>
      </Box>
    </Box>
  )
}

async function saveConfig(token: string, channelId: string, userId?: string): Promise<void> {
  const configDir = join(homedir(), '.claude')
  await mkdir(configDir, { recursive: true })
  await writeFile(
    join(configDir, 'discord.json'),
    JSON.stringify({ token, channelId, userId: userId ?? null }, null, 2),
    'utf-8',
  )
}

function DiscordStatus({
  onDone,
}: {
  onDone: (msg?: string) => void
}): React.ReactNode {
  const active = isDiscordActive()
  const configured = isDiscordConfigured()
  const [showSetup, setShowSetup] = React.useState(false)

  if (showSetup) return <DiscordSetup onDone={onDone} />

  if (active) {
    return (
      <Dialog title="Discord Bridge" onCancel={() => onDone()} hideInputGuide>
        <Box flexDirection="column">
          <Text color="green">{'● Active — polling channel'}</Text>
          <Text dimColor>{`Channel: ${getDiscordChannelId()}`}</Text>
          <Text>{''}</Text>
          <Text dimColor>{'Messages from Discord are injected into the current round.'}</Text>
          <Text dimColor>{'Commands: /stop /kill /status /schedules /help'}</Text>
        </Box>
        <Select
          options={[
            { label: 'OK', value: 'ok' },
            { label: 'Reconfigure', value: 'setup' },
          ]}
          onChange={(v: string) => {
            if (v === 'setup') setShowSetup(true)
            else onDone(undefined)
          }}
        />
      </Dialog>
    )
  }

  if (configured) {
    return (
      <Dialog title="Discord Bridge" onCancel={() => onDone()} hideInputGuide>
        <Box flexDirection="column">
          <Text color="yellow">{'◌ Configured but not active'}</Text>
          <Text dimColor>{'Token or channel may be invalid.'}</Text>
        </Box>
        <Select
          options={[
            { label: 'Reconfigure', value: 'setup' },
            { label: 'Cancel', value: 'cancel' },
          ]}
          onChange={(v: string) => {
            if (v === 'setup') setShowSetup(true)
            else onDone(undefined)
          }}
        />
      </Dialog>
    )
  }

  return null
}

export const call: LocalJSXCommandCall = async (onDone, _context, args) => {
  const text = args?.trim() ?? ''

  if (text === 'setup') {
    return <DiscordSetup onDone={(msg) => onDone(msg)} />
  }

  if (!text) {
    if (!isDiscordConfigured() && !isDiscordActive()) {
      return <DiscordSetup onDone={(msg) => onDone(msg)} />
    }
    return <DiscordStatus onDone={(msg) => onDone(msg)} />
  }

  if (!isDiscordActive()) {
    return (
      <AutoDone onDone={onDone}>
        <Box marginTop={1}>
          <Text color="red">{'✗ Discord: Bot is not active. Run /discord to set it up.'}</Text>
        </Box>
      </AutoDone>
    )
  }

  try {
    await sendDiscordMessage(text)
  } catch (e) {
    return (
      <AutoDone onDone={onDone}>
        <Box marginTop={1}><Text color="red">{`✗ Discord send failed: ${e instanceof Error ? e.message : String(e)}`}</Text></Box>
      </AutoDone>
    )
  }
  return (
    <AutoDone onDone={onDone}>
      <Box flexDirection="column" marginTop={1}>
        <Text bold color="#6366f1">{'◆ Discord — Sent'}</Text>
        <Text dimColor>{`  "${text.slice(0, 80)}${text.length > 80 ? '…' : ''}"`}</Text>
      </Box>
    </AutoDone>
  )
}
