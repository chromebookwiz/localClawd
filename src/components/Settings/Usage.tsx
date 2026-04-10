import * as React from 'react';
import { Box, Text } from '../../ink.js';
import { ConfigurableShortcutHint } from '../ConfigurableShortcutHint.js';

export function Usage(): React.ReactNode {
  return (
    <Box flexDirection="column" gap={1} width="100%">
      <Text dimColor={true}>
        Pricing, credits, team overages, and company billing controls are
        disabled in localclawd.
      </Text>
      <Text dimColor={true}>
        Session summaries track tokens only. Use /cost to view the current
        session token totals.
      </Text>
      <Text dimColor={true}>
        <ConfigurableShortcutHint
          action="confirm:no"
          context="Settings"
          fallback="Esc"
          description="cancel"
        />
      </Text>
    </Box>
  )
}
import * as React from 'react'
import { Box, Text } from '../../ink.js'
import { ConfigurableShortcutHint } from '../ConfigurableShortcutHint.js'

export function Usage(): React.ReactNode {
  return (
    <Box flexDirection="column" gap={1} width="100%">
      <Text dimColor={true}>
        Pricing, credits, team overages, and company billing controls are
        disabled in localclawd.
      </Text>
      <Text dimColor={true}>
        Session summaries track tokens only. Use /cost to view the current
        session token totals.
      </Text>
      <Text dimColor={true}>
        <ConfigurableShortcutHint
          action="confirm:no"
          context="Settings"
          fallback="Esc"
          description="cancel"
        />
      </Text>
    </Box>
  )
}
