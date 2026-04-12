import React from 'react'
import { Box, Text, useTheme } from 'src/ink.js'
import { AnimatedClawd } from './AnimatedClawd.js'

const WELCOME_V2_WIDTH = 58

export function WelcomeLogo() {
  const [theme] = useTheme()
  const isLightTheme = ['light', 'light-daltonized', 'light-ansi'].includes(theme)
  const accentColor = isLightTheme ? 'blue' : '#6366f1'

  return (
    <Box width={WELCOME_V2_WIDTH} flexDirection="column" gap={0}>
      <Box gap={1}>
        <Text bold color={accentColor}>localclawd</Text>
        <Text dimColor>v{MACRO.VERSION}</Text>
      </Box>
      <Text dimColor>{'─'.repeat(48)}</Text>
      <Box marginTop={1}>
        <AnimatedClawd />
      </Box>
    </Box>
  )
}
