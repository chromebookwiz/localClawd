import * as React from 'react'
import { Box, Text } from '../../ink.js'

export type ClawdPose = 'default'
export const CLAWD_HEIGHT = 4

type Props = {
  pose?: ClawdPose
}

// localclawd logo — 5 rows × 9 chars, symmetric left↔right.
//
// Row 0: upper body      ▗▟█████▙▗
// Row 1: waist           ·▐▛███▜▌·
// Row 2: lower body      ▝▜█████▛▘
// Row 3: hip/connector   ··▐█·█▌··
// Row 4: legs            ··▐▌·▐▌··

const ROWS: readonly string[] = [
  '▗▟█████▙▗',
  ' ▐▛███▜▌ ',
  '▝▜█████▛▘',
  '  ▄▄ ▄▄  ',
]

// Indigo palette matching the app accent color (#6366f1)
const ROW_COLORS: readonly string[] = [
  '#6366f1',   // main indigo
  '#6366f1',
  '#6366f1',
  '#818cf8',   // lighter indigo for stub feet
]

export function Clawd({ pose: _pose = 'default' }: Props) {
  return (
    <Box flexDirection="column">
      {ROWS.map((row, index) => (
        <Text key={index} color={ROW_COLORS[index]}>
          {row}
        </Text>
      ))}
    </Box>
  )
}
