import React, { useEffect, useState } from 'react'
import { Text } from '../../ink.js'

// Two triangles spinning in opposite directions — red leads, blue trails 180°
// Clockwise sequence for red:  ▲ ▷ ▼ ◁
// Counter-clockwise for blue:  ▽ ◁ △ ▷  (offset so they're always "interlocked")
const RED_FRAMES  = ['▲', '▷', '▼', '◁']
const BLUE_FRAMES = ['▽', '◁', '△', '▷']

const FRAME_MS = 140

type Props = {
  label?: string
}

export function TriangleSpinner({ label }: Props): React.ReactNode {
  const [frame, setFrame] = useState(0)

  useEffect(() => {
    const id = setInterval(() => setFrame(f => (f + 1) % RED_FRAMES.length), FRAME_MS)
    return () => clearInterval(id)
  }, [])

  return (
    <Text>
      <Text color="red">{RED_FRAMES[frame]}</Text>
      <Text color="blue">{BLUE_FRAMES[frame]}</Text>
      {label ? <Text dimColor> {label}</Text> : null}
    </Text>
  )
}
