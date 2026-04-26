/**
 * /slack — Slack bridge: status, send messages, and interactive setup.
 *
 * Usage:
 *   /slack              — show status; if not configured, start interactive setup
 *   /slack setup        — force interactive setup
 *   /slack <text>       — send a message to your Slack channel
 */

import * as React from 'react'
import { Box, Text } from '../../ink.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import {
  isSlackActive,
  isSlackConfigured,
  sendSlackMessage,
  getSlackChannelId,
  validateSlackToken,
  validateSlackChannel,
  initSlackWithCredentials,
} from '../../services/slack/slackBot.js'
import { Select } from '../../components/CustomSelect/index.js'
import { Dialog } from '../../components/design-system/Dialog.js'
import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'

// ─── Setup flow ──────────────────────────────────────────────────────────────

type SetupStep =
  | 'instructions'
  | 'token'
  | 'channel'
  | 'userid'
  | 'validating'
  | 'done'
  | 'error'

function SlackSetup({ onDone }: { onDone: (msg?: string) => void }): React.ReactNode {
  const [step, setStep] = React.useState<SetupStep>('instructions')
  const [token, setToken] = React.useState('')
  const [channelId, setChannelId] = React.useState('')
  const [userId, setUserId] = React.useState('')
  const [botName, setBotName] = React.useState('')
  const [teamName, setTeamName] = React.useState('')
  const [channelName, setChannelName] = React.useState('')
  const [error, setError] = React.useState('')

  if (step === 'instructions') {
    return (
      <Dialog title="Slack Setup" onCancel={() => onDone()} hideInputGuide>
        <Box flexDirection="column">
          <Text bold>{'Create a Slack app with these scopes:'}</Text>
          <Text>{''}</Text>
          <Text>{'  1. Go to https://api.slack.com/apps → Create New App → From scratch'}</Text>
          <Text>{'  2. Under "OAuth & Permissions", add Bot Token Scopes:'}</Text>
          <Text dimColor>{'        chat:write, channels:history, groups:history,'}</Text>
          <Text dimColor>{'        im:history, mpim:history, reactions:write,'}</Text>
          <Text dimColor>{'        im:read, channels:read'}</Text>
          <Text>{'  3. Install the app to your workspace — copy the Bot User OAuth Token (xoxb-...)'}</Text>
          <Text>{'  4. In Slack, invite the bot to a channel (or DM it directly), then copy the channel ID'}</Text>
          <Text dimColor>{'        Channel ID: right-click channel → View details → copy ID at bottom'}</Text>
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
      <Dialog title="Slack Setup — Bot Token" onCancel={() => onDone()} hideInputGuide>
        <Box flexDirection="column">
          <Text>{'Paste your Bot User OAuth Token:'}</Text>
        </Box>
        <Select
          options={[
            {
              label: 'Bot Token',
              value: 'token',
              type: 'input' as const,
              placeholder: 'xoxb-...',
              onChange: (v: string) => setToken(v),
            },
          ]}
          onChange={async () => {
            const trimmed = token.trim()
            if (!trimmed) return
            setStep('validating')
            const result = await validateSlackToken(trimmed)
            if (result.ok) {
              setBotName(result.botName)
              setTeamName(result.teamName)
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
        title={`Slack Setup — Connected as ${botName} in ${teamName}`}
        onCancel={() => onDone()}
        hideInputGuide
      >
        <Box flexDirection="column">
          <Text bold>{'Enter the channel or DM ID:'}</Text>
          <Text>{''}</Text>
          <Text dimColor>{'  Channel ID starts with C (public), G (private), or D (direct message)'}</Text>
          <Text dimColor>{'  Right-click the channel → View details → copy ID at the bottom'}</Text>
          <Text dimColor>{'  Make sure the bot is invited: /invite @your-bot-name'}</Text>
        </Box>
        <Select
          options={[
            {
              label: 'Channel ID',
              value: 'channel',
              type: 'input' as const,
              placeholder: 'C01234ABCDE',
              onChange: (v: string) => setChannelId(v),
            },
          ]}
          onChange={async () => {
            const trimmed = channelId.trim()
            if (!trimmed) return
            setStep('validating')
            const result = await validateSlackChannel(token.trim(), trimmed)
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
        title={`Slack Setup — Channel: ${channelName}`}
        onCancel={() => onDone()}
        hideInputGuide
      >
        <Box flexDirection="column">
          <Text bold>{'Optional: Restrict to a specific user'}</Text>
          <Text>{''}</Text>
          <Text dimColor>{'  Enter your Slack user ID (U...) to only accept messages from you.'}</Text>
          <Text dimColor>{'  Leave blank to accept messages from anyone in the channel.'}</Text>
          <Text dimColor>{'  Find your ID: click your profile → "..." menu → Copy member ID'}</Text>
        </Box>
        <Select
          options={[
            {
              label: 'User ID (optional)',
              value: 'userid',
              type: 'input' as const,
              placeholder: 'U01234ABCDE  (or leave blank)',
              onChange: (v: string) => setUserId(v),
            },
          ]}
          onChange={async () => {
            setStep('validating')
            const result = await initSlackWithCredentials(
              token.trim(),
              channelId.trim(),
              userId.trim() || undefined,
            )
            if (result.ok) {
              await saveSlackConfig(
                token.trim(),
                channelId.trim(),
                userId.trim() || undefined,
              )
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
        <Text bold color="#6366f1">{'◆ Slack Setup — Validating...'}</Text>
      </Box>
    )
  }

  if (step === 'error') {
    return (
      <Dialog title="Slack Setup — Error" onCancel={() => onDone()} hideInputGuide>
        <Box flexDirection="column">
          <Text color="red">{error}</Text>
          <Text>{''}</Text>
          <Text dimColor>{'Press Enter to retry or Esc to cancel.'}</Text>
        </Box>
        <Select
          options={[{ label: 'Retry from the beginning', value: 'retry' }]}
          onChange={() => {
            setError('')
            setToken('')
            setChannelId('')
            setUserId('')
            setStep('instructions')
          }}
        />
      </Dialog>
    )
  }

  return (
    <SlackSetupDone
      botName={botName}
      teamName={teamName}
      channelName={channelName}
      channelId={channelId}
      onReady={() => onDone(undefined)}
    />
  )
}

function SlackSetupDone({
  botName,
  teamName,
  channelName,
  channelId,
  onReady,
}: {
  botName: string
  teamName: string
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
      <Text bold color="green">{'◆ Slack Connected!'}</Text>
      <Box flexDirection="column" marginLeft={2}>
        <Text>{`  Bot: ${botName} (${teamName})`}</Text>
        <Text>{`  Channel: ${channelName} (${channelId})`}</Text>
        <Text>{''}</Text>
        <Text>{'  Credentials saved to ~/.claude/slack.json'}</Text>
        <Text>{'  They will be loaded automatically on next startup.'}</Text>
        <Text>{''}</Text>
        <Text dimColor>{'  To persist across shell restarts, also add to your profile:'}</Text>
        <Text color="cyan">{`  export SLACK_BOT_TOKEN=<token>`}</Text>
        <Text color="cyan">{`  export SLACK_CHANNEL_ID=${channelId}`}</Text>
        <Text>{''}</Text>
        <Text bold>{'  Commands from Slack:'}</Text>
        <Text dimColor>{'    /stop   — stop current task'}</Text>
        <Text dimColor>{'    /kill   — stop ALL localclawd instances'}</Text>
        <Text dimColor>{'    /status — show current status'}</Text>
        <Text dimColor>{'    Any other message — injected into /director'}</Text>
      </Box>
    </Box>
  )
}

async function saveSlackConfig(
  token: string,
  channelId: string,
  userId?: string,
): Promise<void> {
  const configDir = getClaudeConfigHomeDir()
  await mkdir(configDir, { recursive: true })
  const configPath = join(configDir, 'slack.json')
  await writeFile(
    configPath,
    JSON.stringify({ token, channelId, userId: userId ?? null }, null, 2),
    'utf-8',
  )
}

// ─── Status display ──────────────────────────────────────────────────────────

function SlackStatus({
  onDone,
}: {
  onDone: (msg?: string) => void
}): React.ReactNode {
  const active = isSlackActive()
  const configured = isSlackConfigured()
  const [showSetup, setShowSetup] = React.useState(false)

  if (showSetup) {
    return <SlackSetup onDone={onDone} />
  }

  if (active) {
    return (
      <Dialog title="Slack Bridge" onCancel={() => onDone()} hideInputGuide>
        <Box flexDirection="column">
          <Text color="green">{'● Active — polling channel'}</Text>
          <Text dimColor>{`Channel: ${getSlackChannelId()}`}</Text>
          <Text>{''}</Text>
          <Text dimColor>{'Messages from Slack start /director or inject into the current round.'}</Text>
          <Text dimColor>{'Status updates posted after each round.'}</Text>
          <Text dimColor>{'Send /stop to halt, /kill to stop all instances.'}</Text>
        </Box>
        <Select
          options={[
            { label: 'OK', value: 'ok' },
            { label: 'Reconfigure — run setup again', value: 'setup' },
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
      <Dialog title="Slack Bridge" onCancel={() => onDone()} hideInputGuide>
        <Box flexDirection="column">
          <Text color="yellow">{'◌ Configured but not active (init failed — check token/channel)'}</Text>
          <Text>{''}</Text>
          <Text dimColor>{'The saved credentials may be invalid or the bot lost access.'}</Text>
        </Box>
        <Select
          options={[
            { label: 'Reconfigure — run setup again', value: 'setup' },
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

function SlackSent({
  text,
  onReady,
}: {
  text: string
  onReady: () => void
}): React.ReactNode {
  React.useEffect(() => {
    const id = setTimeout(onReady, 100)
    return () => clearTimeout(id)
  }, [onReady])

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color="#6366f1">{'◆ Slack — Sent'}</Text>
      <Text dimColor>{`  "${text.slice(0, 80)}${text.length > 80 ? '…' : ''}"`}</Text>
    </Box>
  )
}

function SlackError({
  msg,
  onReady,
}: {
  msg: string
  onReady: () => void
}): React.ReactNode {
  React.useEffect(() => {
    const id = setTimeout(onReady, 100)
    return () => clearTimeout(id)
  }, [onReady])

  return (
    <Box marginTop={1}>
      <Text color="red">{`✗ Slack: ${msg}`}</Text>
    </Box>
  )
}

// ─── Command entry point ─────────────────────────────────────────────────────

export const call: LocalJSXCommandCall = async (onDone, _context, args) => {
  const text = args?.trim() ?? ''

  if (text === 'setup') {
    return <SlackSetup onDone={(msg) => onDone(msg)} />
  }

  if (!text) {
    if (!isSlackConfigured() && !isSlackActive()) {
      return <SlackSetup onDone={(msg) => onDone(msg)} />
    }
    return <SlackStatus onDone={(msg) => onDone(msg)} />
  }

  if (!isSlackActive()) {
    return (
      <SlackError
        msg="Bot is not active. Run /slack to set it up."
        onReady={() => onDone(undefined)}
      />
    )
  }

  try {
    await sendSlackMessage(text)
    return <SlackSent text={text} onReady={() => onDone(undefined)} />
  } catch (e) {
    return <SlackError msg={String(e)} onReady={() => onDone(undefined)} />
  }
}
