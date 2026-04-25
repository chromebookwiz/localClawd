import * as React from 'react'
import { Box, Text } from '../../ink.js'

export type ClawdPose = 'default'
export const CLAWD_HEIGHT = 5

type Props = {
  pose?: ClawdPose
}

// localclawd logo — solid goomba-style, 5 rows × 10 chars, symmetric left↔right.
//
// Row 0: cap dome        ··▄████▄··
// Row 1: solid head      ·████████·
// Row 2: cutout eyes     █▛▜████▛▜█  (▛▜ pair = small square cutout in lower-center of each pair)
// Row 3: solid chin      ·████████·
// Row 4: stub feet       ··▐▌··▐▌··

const ROWS: readonly string[] = [
  '  ▄████▄  ',
  ' ████████ ',
  '█▛▜████▛▜█',
  ' ████████ ',
  '  ▐▌  ▐▌  ',
]

// Single accent color across the whole logo.
const LOGO_COLOR = '#6366f1'

export function Clawd({ pose: _pose = 'default' }: Props) {
  return (
    <Box flexDirection="column">
      {ROWS.map((row, index) => (
        <Text key={index} color={LOGO_COLOR}>
          {row}
        </Text>
      ))}
    </Box>
  )
}
