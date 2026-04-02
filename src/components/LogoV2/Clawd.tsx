import * as React from 'react'
import { Box, Text } from '../../ink.js'
import { env } from '../../utils/env.js'

export type ClawdPose = 'default' | 'arms-up' | 'look-left' | 'look-right'

type Props = {
  pose?: ClawdPose
}

const POSES: Record<ClawdPose, string[]> = {
  default: ['  ◇  ', ' ◇◆◇ ', '  ◇  '],
  'arms-up': [' ◇ ◇ ', '  ◆  ', ' ◇ ◇ '],
  'look-left': ['  ◈  ', ' ◇◆◇ ', '  ◇  '],
  'look-right': ['  ◇  ', ' ◇◆◈ ', '  ◇  '],
}

const APPLE_TERMINAL_POSES: Record<ClawdPose, string[]> = {
  default: ['  ▗▖  ', ' ▗█▖ ', '  ▝▘  '],
  'arms-up': [' ▗ ▖ ', '  █  ', ' ▝ ▘ '],
  'look-left': ['  ▗▖  ', ' ▐█▖ ', '  ▝▘  '],
  'look-right': ['  ▗▖  ', ' ▗█▌ ', '  ▝▘  '],
}

export function Clawd({ pose = 'default' }: Props) {
  const rows =
    env.terminal === 'Apple_Terminal' ? APPLE_TERMINAL_POSES[pose] : POSES[pose]

  return (
    <Box flexDirection="column">
      {rows.map((row, index) => (
        <Text key={`${pose}-${index}`} color="clawd_body">
          {row}
        </Text>
      ))}
    </Box>
  )
}