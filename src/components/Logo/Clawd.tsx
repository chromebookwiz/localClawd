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

// Indigo palette matching the app accent color (#6366f1)
const ROW_COLORS: readonly string[] = [
  '#6366f1',   // main indigo — cap
  '#6366f1',   // solid head
  '#6366f1',   // eye row (background shows through the ▛▜ cutout gaps)
  '#6366f1',   // solid chin
  '#818cf8',   // lighter — stub feet
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
