import * as React from 'react'
import { Box, Text } from '../../ink.js'

export type ClawdPose = 'default'
export const CLAWD_HEIGHT = 5

type Props = {
  pose?: ClawdPose
}

// Claude-style asterisk — 5 rows × 9 chars, symmetric top↔bottom and left↔right.
//
// Row 0: upper arm tips  ▖▖     ▗▗  (lower quads at top of cell = tips of upward arms)
// Row 1: upper body      ▗▟█████▙▖
// Row 2: waist           ·▐▛███▜▌·
// Row 3: lower body      ▝▜█████▛▘
// Row 4: lower arm tips  ▘▘     ▝▝  (upper quads at bottom of cell = tips of downward arms)

const ROWS: readonly string[] = [
  '▖▖     ▗▗',
  '▗▟█████▙▖',
  ' ▐▛███▜▌ ',
  '▝▜█████▛▘',
  '▘▘     ▝▝',
]

// Indigo palette matching the app accent color (#6366f1)
const ROW_COLORS: readonly string[] = [
  '#818cf8',   // lighter indigo for arm tips
  '#6366f1',   // main indigo
  '#6366f1',
  '#6366f1',
  '#818cf8',   // lighter indigo for arm tips
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
