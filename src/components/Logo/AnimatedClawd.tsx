import * as React from 'react'
import { useEffect, useRef, useState } from 'react'
import { Box } from '../../ink.js'
import { getInitialSettings } from '../../utils/settings/settings.js'
import { CLAWD_HEIGHT, Clawd, type ClawdPose } from './Clawd.js'

type Frame = { pose: ClawdPose; offset: number }
type Props = {
  idleIntervalMs?: number
}

/** Hold a pose for n frames (60 ms each). */
function hold(pose: ClawdPose, offset: number, frames: number): Frame[] {
  return Array.from({ length: frames }, () => ({ pose, offset }))
}

// Click animation: crouch, bounce, then snap the claws shut once.
const JUMP_WAVE: readonly Frame[] = [
  ...hold('default', 1, 2),
  ...hold('bounce', 0, 3),
  ...hold('default', 0, 1),
  ...hold('pinch', 0, 2),
  ...hold('default', 0, 2),
]

// Idle loop: eyes scan side-to-side and the forked claws pinch closed briefly.
const SCAN_AND_PINCH: readonly Frame[] = [
  ...hold('look-right', 0, 5),
  ...hold('pinch-right', 0, 2),
  ...hold('default', 0, 2),
  ...hold('look-left', 0, 5),
  ...hold('pinch-left', 0, 2),
  ...hold('default', 0, 3),
]

const CLICK_ANIMATIONS: readonly (readonly Frame[])[] = [JUMP_WAVE, SCAN_AND_PINCH]

const IDLE: Frame = { pose: 'default', offset: 0 }
const FRAME_MS = 60
const DEFAULT_IDLE_INTERVAL_MS = 60_000
const incrementFrame = (i: number) => i + 1

/**
 * Crab with click-triggered motion and an idle scan animation that shifts the
 * eyes side-to-side and pinches the claws every few seconds. Container height
 * is fixed at CLAWD_HEIGHT so the surrounding layout never shifts.
 */
export function AnimatedClawd({ idleIntervalMs = DEFAULT_IDLE_INTERVAL_MS }: Props): React.ReactNode {
  const { pose, bounceOffset, onClick } = useClawdAnimation(idleIntervalMs)
  return (
    <Box height={CLAWD_HEIGHT} flexDirection="column" onClick={onClick}>
      <Box marginTop={bounceOffset} flexShrink={0}>
        <Clawd pose={pose} />
      </Box>
    </Box>
  )
}

function useClawdAnimation(): {
  pose: ClawdPose
  bounceOffset: number
  onClick: () => void
}

function useClawdAnimation(idleIntervalMs: number): {
  pose: ClawdPose
  bounceOffset: number
  onClick: () => void
} {
  const [reducedMotion] = useState(
    () => getInitialSettings().prefersReducedMotion ?? false,
  )
  const [frameIndex, setFrameIndex] = useState(-1)
  const sequenceRef = useRef<readonly Frame[]>(JUMP_WAVE)

  const onClick = () => {
    if (reducedMotion || frameIndex !== -1) return
    sequenceRef.current =
      CLICK_ANIMATIONS[Math.floor(Math.random() * CLICK_ANIMATIONS.length)]!
    setFrameIndex(0)
  }

  // Frame ticker: advance one frame every FRAME_MS ms, then return to idle.
  useEffect(() => {
    if (frameIndex === -1) return
    if (frameIndex >= sequenceRef.current.length) {
      setFrameIndex(-1)
      return
    }
    const timer = setTimeout(setFrameIndex, FRAME_MS, incrementFrame)
    return () => clearTimeout(timer)
  }, [frameIndex])

  // Dashboard idle scan: run the eye sweep and claw pinch once per minute.
  useEffect(() => {
    if (reducedMotion || frameIndex !== -1) return
    const timer = setTimeout(() => {
      sequenceRef.current = SCAN_AND_PINCH
      setFrameIndex(0)
    }, idleIntervalMs)
    return () => clearTimeout(timer)
  }, [reducedMotion, frameIndex, idleIntervalMs])

  const seq = sequenceRef.current
  const current =
    frameIndex >= 0 && frameIndex < seq.length ? seq[frameIndex]! : IDLE
  return { pose: current.pose, bounceOffset: current.offset, onClick }
}
