/**
 * /telegram — Telegram bridge: status, send messages, and interactive setup.
 *
 * Usage:
 *   /telegram           — show status; if not configured, start interactive setup
 *   /telegram setup     — force interactive setup
 *   /telegram <text>    — send a message to your Telegram chat
 *   /tg <text>          — alias
 */

import * as React from 'react'
import { Box, Text } from '../../ink.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import {
  isTelegramActive,
  isTelegramConfigured,
  sendTelegramMessage,
  getTelegramChatId,
  validateTelegramToken,
  initTelegramWithCredentials,
} from '../../services/telegram/telegramBot.js'
import { Select } from '../../components/CustomSelect/index.js'
import { Dialog } from '../../components/design-system/Dialog.js'
import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'

// ─── Setup steps ─────────────────────────────────────────────────────────────

type SetupStep = 'instructions' | 'token' | 'chatid' | 'validating' | 'done' | 'error'

function TelegramSetup({ onDone }: { onDone: (msg?: string) => void }): React.ReactNode {
  const [step, setStep] = React.useState<SetupStep>('instructions')
  const [token, setToken] = React.useState('')
  const [chatId, setChatId] = React.useState('')
  const [botUsername, setBotUsername] = React.useState('')
  const [error, setError] = React.useState('')

  // Step 1: Show instructions and prompt for token
  if (step === 'instructions') {
    return (
      <Dialog title="Telegram Setup" onCancel={() => onDone()} hideInputGuide>
        <Box flexDirection="column">
          <Text bold>{'Step 1: Create a Telegram Bot'}</Text>
          <Text>{''}</Text>
          <Text>{'  1. Open Telegram and search for @BotFather'}</Text>
          <Text>{'  2. Send /newbot and follow the prompts'}</Text>
          <Text>{'  3. Copy the bot token (looks like 123456:ABC-DEF...)'}</Text>
          <Text>{''}</Text>
          <Text dimColor>{'Press Enter when you have your token ready.'}</Text>
        </Box>
        <Select
          options={[{ label: 'I have my bot token — continue', value: 'continue' }]}
          onChange={() => setStep('token')}
        />
      </Dialog>
    )
  }

  // Step 2: Enter bot token
  if (step === 'token') {
    return (
      <Dialog title="Telegram Setup — Bot Token" onCancel={() => onDone()} hideInputGuide>
        <Box flexDirection="column">
          <Text>{'Paste your bot token from @BotFather:'}</Text>
        </Box>
        <Select
          options={[
            {
              label: 'Bot Token',
              value: 'token',
              type: 'input' as const,
              placeholder: '123456789:ABCdefGHI...',
              onChange: (v: string) => setToken(v),
            },
          ]}
          onChange={async () => {
            const trimmed = token.trim()
            if (!trimmed) return
            setStep('validating')
            const result = await validateTelegramToken(trimmed)
            if (result.ok) {
              setBotUsername(result.username)
              setStep('chatid')
            } else {
              setError(`Invalid token: ${result.error}`)
              setStep('error')
            }
          }}
        />
      </Dialog>
    )
  }

  // Step 3: Enter chat ID
  if (step === 'chatid') {
    return (
      <Dialog title={`Telegram Setup — Connected to @${botUsername}`} onCancel={() => onDone()} hideInputGuide>
        <Box flexDirection="column">
          <Text bold>{'Step 2: Get your Chat ID'}</Text>
          <Text>{''}</Text>
          <Text>{'  1. Open Telegram and search for @userinfobot'}</Text>
          <Text>{'  2. Send it any message — it replies with your ID'}</Text>
          <Text>{'  3. Enter the numeric ID below'}</Text>
        </Box>
        <Select
          options={[
            {
              label: 'Chat ID',
              value: 'chatid',
              type: 'input' as const,
              placeholder: '123456789',
              onChange: (v: string) => setChatId(v),
            },
          ]}
          onChange={async () => {
            const id = parseInt(chatId.trim(), 10)
            if (isNaN(id)) {
              setError('Chat ID must be a number')
              setStep('error')
              return
            }
            setStep('validating')
            const result = await initTelegramWithCredentials(token.trim(), id)
            if (result.ok) {
              // Save to a persistent config file
              await saveTelegramConfig(token.trim(), id)
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

  // Validating...
  if (step === 'validating') {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text bold color="#6366f1">{'◆ Telegram Setup — Validating...'}</Text>
      </Box>
    )
  }

  // Error
  if (step === 'error') {
    return (
      <Dialog title="Telegram Setup — Error" onCancel={() => onDone()} hideInputGuide>
        <Box flexDirection="column">
          <Text color="red">{error}</Text>
          <Text>{''}</Text>
          <Text dimColor>{'Press Enter to retry or Esc to cancel.'}</Text>
        </Box>
        <Select
          options={[
            { label: 'Retry from the beginning', value: 'retry' },
          ]}
          onChange={() => {
            setError('')
            setToken('')
            setChatId('')
            setStep('instructions')
          }}
        />
      </Dialog>
    )
  }

  // Done!
  return (
    <TelegramSetupDone
      botUsername={botUsername}
      chatId={chatId}
      onReady={() => onDone(undefined)}
    />
  )
}

function TelegramSetupDone({
  botUsername,
  chatId,
  onReady,
}: {
  botUsername: string
  chatId: string
  onReady: () => void
}): React.ReactNode {
  React.useEffect(() => {
    const id = setTimeout(onReady, 100)
    return () => clearTimeout(id)
  }, [onReady])

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color="green">{'◆ Telegram Connected!'}</Text>
      <Box flexDirection="column" marginLeft={2}>
        <Text>{`  Bot: @${botUsername}`}</Text>
        <Text>{`  Chat ID: ${chatId}`}</Text>
        <Text>{''}</Text>
        <Text>{'  Credentials saved to ~/.claude/telegram.json'}</Text>
        <Text>{'  They will be loaded automatically on next startup.'}</Text>
        <Text>{''}</Text>
        <Text dimColor>{'  To persist across shell restarts, also add to your profile:'}</Text>
        <Text color="cyan">{`  export TELEGRAM_BOT_TOKEN=<token>`}</Text>
        <Text color="cyan">{`  export TELEGRAM_CHAT_ID=${chatId}`}</Text>
        <Text>{''}</Text>
        <Text bold>{'  Commands from Telegram:'}</Text>
        <Text dimColor>{'    /stop  — stop current task'}</Text>
        <Text dimColor>{'    /kill  — stop ALL localclawd instances'}</Text>
        <Text dimColor>{'    Any other message — inject into /keepgoing or /director'}</Text>
      </Box>
    </Box>
  )
}

async function saveTelegramConfig(token: string, chatId: number): Promise<void> {
  const configDir = join(homedir(), '.claude')
  await mkdir(configDir, { recursive: true })
  const configPath = join(configDir, 'telegram.json')
  await writeFile(configPath, JSON.stringify({ token, chatId }, null, 2), 'utf-8')
}

// ─── Status display ──────────────────────────────────────────────────────────

function TelegramStatus({
  onDone,
}: {
  onDone: (msg?: string) => void
}): React.ReactNode {
  const active = isTelegramActive()
  const configured = isTelegramConfigured()
  const [showSetup, setShowSetup] = React.useState(false)

  if (showSetup) {
    return <TelegramSetup onDone={onDone} />
  }

  if (active) {
    return (
      <Dialog title="Telegram Bridge" onCancel={() => onDone()} hideInputGuide>
        <Box flexDirection="column">
          <Text color="green">{'● Active — bot is polling'}</Text>
          <Text dimColor>{`Chat ID: ${getTelegramChatId()}`}</Text>
          <Text>{''}</Text>
          <Text dimColor>{'Messages from Telegram are injected into /keepgoing and /director rounds.'}</Text>
          <Text dimColor>{'Status updates sent to your phone after each round.'}</Text>
          <Text dimColor>{'Send /stop to stop current task, /kill to stop all instances.'}</Text>
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
      <Dialog title="Telegram Bridge" onCancel={() => onDone()} hideInputGuide>
        <Box flexDirection="column">
          <Text color="yellow">{'◌ Configured but not active (init failed — check token/chat ID)'}</Text>
          <Text>{''}</Text>
          <Text dimColor>{'The saved credentials may be invalid or expired.'}</Text>
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

  // Not configured — this shouldn't reach here since we redirect to setup
  return null
}

function TelegramSent({
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
      <Text bold color="#6366f1">{'◆ Telegram — Sent'}</Text>
      <Text dimColor>{`  "${text.slice(0, 80)}${text.length > 80 ? '…' : ''}"`}</Text>
    </Box>
  )
}

function TelegramError({
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
      <Text color="red">{`✗ Telegram: ${msg}`}</Text>
    </Box>
  )
}

// ─── Command entry point ─────────────────────────────────────────────────────

export const call: LocalJSXCommandCall = async (onDone, _context, args) => {
  const text = args?.trim() ?? ''

  // /telegram setup — force setup flow
  if (text === 'setup') {
    return <TelegramSetup onDone={(msg) => onDone(msg)} />
  }

  // /telegram with no args — show status or start setup
  if (!text) {
    if (!isTelegramConfigured() && !isTelegramActive()) {
      // Not configured — start interactive setup
      return <TelegramSetup onDone={(msg) => onDone(msg)} />
    }
    return <TelegramStatus onDone={(msg) => onDone(msg)} />
  }

  // /telegram <text> — send a message
  if (!isTelegramActive()) {
    return (
      <TelegramError
        msg="Bot is not active. Run /telegram to set it up."
        onReady={() => onDone(undefined)}
      />
    )
  }

  try {
    await sendTelegramMessage(text)
    return <TelegramSent text={text} onReady={() => onDone(undefined)} />
  } catch (e) {
    return (
      <TelegramError
        msg={String(e)}
        onReady={() => onDone(undefined)}
      />
    )
  }
}
