/**
 * /telegram — Telegram bridge status and manual send.
 *
 * Usage:
 *   /telegram           — show bot status
 *   /telegram <text>    — send a message to your Telegram chat
 *   /tg <text>          — alias
 *
 * Setup:
 *   1. Create a bot via @BotFather, copy the token
 *   2. Get your chat ID via @userinfobot
 *   3. Set env vars: TELEGRAM_BOT_TOKEN=xxx TELEGRAM_CHAT_ID=yyy
 *   4. Restart localclawd
 */

import * as React from 'react'
import { Box, Text } from '../../ink.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import {
  isTelegramActive,
  isTelegramConfigured,
  sendTelegramMessage,
  getTelegramChatId,
} from '../../services/telegram/telegramBot.js'

function TelegramStatus({ onReady }: { onReady: () => void }): React.ReactNode {
  const active = isTelegramActive()
  const configured = isTelegramConfigured()

  React.useEffect(() => {
    const id = setTimeout(onReady, 100)
    return () => clearTimeout(id)
  }, [onReady])

  if (active) {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text bold color="#6366f1">{'◆ Telegram Bridge'}</Text>
        <Text color="green">{'  ● Active — bot is polling'}</Text>
        <Text dimColor>{`  Chat ID: ${getTelegramChatId()}`}</Text>
        <Text dimColor>{'  Messages from your phone are queued and injected into /keepgoing rounds.'}</Text>
        <Text dimColor>{'  The agent sends a status update to Telegram after each /keepgoing round.'}</Text>
      </Box>
    )
  }

  if (configured) {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text bold color="#6366f1">{'◆ Telegram Bridge'}</Text>
        <Text color="yellow">{'  ◌ Configured but not active (init failed — check logs)'}</Text>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color="#6366f1">{'◆ Telegram Bridge — Not configured'}</Text>
      <Box flexDirection="column" marginLeft={2}>
        <Text dimColor>{'Set these environment variables to enable:'}</Text>
        <Text dimColor>{'  TELEGRAM_BOT_TOKEN   — from @BotFather'}</Text>
        <Text dimColor>{'  TELEGRAM_CHAT_ID     — your ID from @userinfobot'}</Text>
        <Text dimColor>{''}</Text>
        <Text dimColor>{'Then restart localclawd. The agent will:'}</Text>
        <Text dimColor>{'  • Send status updates to your phone after each /keepgoing round'}</Text>
        <Text dimColor>{'  • Inject Telegram messages as input in autonomous mode'}</Text>
      </Box>
    </Box>
  )
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

export const call: LocalJSXCommandCall = async (onDone, _context, args) => {
  const text = args?.trim() ?? ''

  if (!text) {
    return <TelegramStatus onReady={() => onDone(undefined)} />
  }

  if (!isTelegramActive()) {
    return (
      <TelegramError
        msg="Bot is not active. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID."
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
