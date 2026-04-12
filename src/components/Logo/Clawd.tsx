import * as React from 'react'
import { Box, Text } from '../../ink.js'
import { env } from '../../utils/env.js'

export type ClawdPose =
  | 'default'
  | 'look-left'
  | 'look-right'
  | 'pinch'
  | 'pinch-left'
  | 'pinch-right'
  | 'bounce'
export const CLAWD_HEIGHT = 5

type Props = {
  pose?: ClawdPose
}

type ClawdSegment = {
  text: string
  color: string
}

type ClawdRow = readonly ClawdSegment[]

const PALETTE = {
  claw: '#fb7185',
  shellTop: '#f87171',
  shell: '#ef4444',
  belly: '#fca5a5',
  legs: '#dc2626',
  eyes: '#111827',
} as const

function segment(text: string, color: string): ClawdSegment {
  return { text, color }
}

function bodyRows(leftEye: string, rightEye: string): ClawdRow[] {
  return [
    [
      segment('  ', PALETTE.claw),
      segment('▄▄▄▄▄', PALETTE.shellTop),
      segment('  ', PALETTE.claw),
    ],
    [
      segment('▐', PALETTE.shell),
      segment(leftEye, PALETTE.eyes),
      segment('█ █', PALETTE.shell),
      segment(rightEye, PALETTE.eyes),
      segment('▌', PALETTE.shell),
    ],
    [segment('▐█████▌', PALETTE.shell)],
    [segment('▝▚▄▄▄▞▘', PALETTE.belly)],
    [
      segment('▖▌', PALETTE.legs),
      segment(' ', PALETTE.legs),
      segment('▖▌', PALETTE.legs),
      segment(' ', PALETTE.legs),
      segment('▐▗', PALETTE.legs),
      segment(' ', PALETTE.legs),
      segment('▐▗', PALETTE.legs),
    ],
  ]
}

function createPose(leftEye: string, rightEye: string, pinched: boolean): ClawdRow[] {
  const [top, face, shellBottom, belly, legs] = bodyRows(leftEye, rightEye)

  if (pinched) {
    return [
      [
        segment(' ', PALETTE.claw),
        segment('▗▌', PALETTE.claw),
        ...top,
        segment('▐▖', PALETTE.claw),
        segment(' ', PALETTE.claw),
      ],
      [
        segment(' ', PALETTE.claw),
        segment('▝▙', PALETTE.claw),
        ...face,
        segment('▟▘', PALETTE.claw),
        segment(' ', PALETTE.claw),
      ],
      [
        segment('  ', PALETTE.claw),
        segment('▌', PALETTE.claw),
        ...shellBottom,
        segment('▐', PALETTE.claw),
        segment('  ', PALETTE.claw),
      ],
      [segment('   ', PALETTE.claw), ...belly, segment('   ', PALETTE.claw)],
      [segment('  ', PALETTE.legs), ...legs],
    ]
  }

  return [
    [
      segment('▘▌', PALETTE.claw),
      ...top,
      segment('▐▝', PALETTE.claw),
    ],
    [
      segment('▖▌', PALETTE.claw),
      segment(' ', PALETTE.claw),
      ...face,
      segment(' ', PALETTE.claw),
      segment('▐▗', PALETTE.claw),
    ],
    [
      segment('  ', PALETTE.claw),
      segment('▌', PALETTE.claw),
      ...shellBottom,
      segment('▐', PALETTE.claw),
      segment('  ', PALETTE.claw),
    ],
    [segment('   ', PALETTE.claw), ...belly, segment('   ', PALETTE.claw)],
    [segment('  ', PALETTE.legs), ...legs],
  ]
}

const POSES: Record<ClawdPose, ClawdRow[]> = {
  default: createPose('▖', '▗', false),
  'look-left': createPose('▘', '▘', false),
  'look-right': createPose('▝', '▝', false),
  pinch: createPose('▖', '▗', true),
  'pinch-left': createPose('▘', '▘', true),
  'pinch-right': createPose('▝', '▝', true),
  bounce: createPose('▖', '▗', false),
}

// Apple Terminal renders some block chars differently; keep the same block art.
const APPLE_TERMINAL_POSES: Record<ClawdPose, ClawdRow[]> = POSES

export function Clawd({ pose = 'default' }: Props) {
  const rows =
    env.terminal === 'Apple_Terminal' ? APPLE_TERMINAL_POSES[pose] : POSES[pose]

  return (
    <Box flexDirection="column">
      {rows.map((row, index) => (
        <Text key={`${pose}-${index}`}>
          {row.map((part, partIndex) => (
            <Text key={`${pose}-${index}-${partIndex}`} color={part.color}>
              {part.text}
            </Text>
          ))}
        </Text>
      ))}
    </Box>
  )
}
