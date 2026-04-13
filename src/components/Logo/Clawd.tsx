import * as React from 'react'
import { Box, Text } from '../../ink.js'

export type ClawdPose = 'default'
export const CLAWD_HEIGHT = 5

type Props = {
  pose?: ClawdPose
}

// localclawd logo — goomba-style character, 5 rows × 10 chars, symmetric left↔right.
//
// Row 0: cap dome        ··▄████▄··
// Row 1: head            ·▗██████▖·
// Row 2: face/eyes       ·▐·▄··▄·▌·  (▄ = small eyes)
// Row 3: chin/frown      ·▐··▄▄··▌·  (▄▄ = frowning mouth)
// Row 4: feet            ··▐▌··▐▌··

const ROWS: readonly string[] = [
  '  ▄████▄  ',
  ' ▗██████▖ ',
  ' ▐ ▄  ▄ ▌ ',
  ' ▐  ▄▄  ▌ ',
  '  ▐▌  ▐▌  ',
]

// Indigo palette matching the app accent color (#6366f1)
const ROW_COLORS: readonly string[] = [
  '#6366f1',   // main indigo — cap
  '#6366f1',   // head
  '#818cf8',   // lighter — face (makes eye dots visible)
  '#6366f1',   // chin
  '#818cf8',   // lighter — feet
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
