import React from 'react'
import { Box, Text, useTheme } from 'src/ink.js'
import { Clawd } from './Clawd.js'

const WELCOME_V2_WIDTH = 58

const GEOMETRIC_BANNER = [
  '◇   ◇◇◇   ◇◇◇    ◇◇◇   ◇   ◇',
  '◇   ◇   ◇ ◇      ◇   ◇ ◇◇  ◇',
  '◇   ◇   ◇ ◇      ◇◇◇◇◇ ◇ ◇ ◇',
  ' ◇ ◇   ◇  ◇      ◇   ◇ ◇  ◇◇',
  '  ◇   ◇◇◇    ◇◇◇ ◇   ◇ ◇   ◇',
]

export function WelcomeV2() {
  const [theme] = useTheme()
  const isLightTheme = ['light', 'light-daltonized', 'light-ansi'].includes(theme)

  return (
    <Box width={WELCOME_V2_WIDTH} flexDirection="column">
      <Text>
        <Text color="claude">Welcome to localClawd </Text>
        <Text dimColor={true}>v{MACRO.VERSION}</Text>
      </Text>
      <Text dimColor={true}>──────────────────────────────────────────────────────────</Text>
      {GEOMETRIC_BANNER.map((line, index) => (
        <Text key={index} color={isLightTheme ? 'clawd_body' : 'claude'}>
          {line}
        </Text>
      ))}
      <Box marginTop={1}>
        <Clawd />
        <Box marginLeft={2} flexDirection="column">
          <Text dimColor={true}>Local-first coding, wired for NVIDIA Spark and Ollama.</Text>
          <Text dimColor={true}>Vision and browser screenshots flow through when your model supports them.</Text>
        </Box>
      </Box>
    </Box>
  )
}