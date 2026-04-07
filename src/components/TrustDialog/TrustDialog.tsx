import React, { useState, useEffect, useRef } from 'react'
import { homedir } from 'os'
import { Box, Text } from '../../ink.js'
import { setSessionTrustAccepted } from '../../bootstrap/state.js'
import type { Command } from '../../commands.js'
import { checkHasTrustDialogAccepted, saveCurrentProjectConfig } from '../../utils/config.js'
import { getCwd } from '../../utils/cwd.js'
import { getFsImplementation } from '../../utils/fsOperations.js'
import { gracefulShutdownSync } from '../../utils/gracefulShutdown.js'
import { PermissionDialog } from '../permissions/PermissionDialog.js'

type Props = {
  onDone(): void
  commands?: Command[]
}

const OPTIONS = [
  { label: 'Yes, I trust this folder', value: 'enable_all' as const },
  { label: 'No, exit', value: 'exit' as const },
]

function acceptTrust(onDone: () => void): void {
  try {
    const isHomeDir = homedir() === getCwd()
    if (isHomeDir) {
      setSessionTrustAccepted(true)
    } else {
      try {
        saveCurrentProjectConfig(current => ({ ...current, hasTrustDialogAccepted: true }))
      } catch {
        // config write error; trust is accepted for this session anyway
      }
      setSessionTrustAccepted(true)
    }
  } finally {
    onDone()
  }
}

export function TrustDialog({ onDone }: Props): React.ReactNode {
  const hasTrustDialogAccepted = checkHasTrustDialogAccepted()
  const [focusIdx, setFocusIdx] = useState(0)

  // Mutable ref so the stdin handler always sees the latest state without
  // needing to re-register on every render.
  const stateRef = useRef({ focusIdx: 0, done: false })

  // Fast-path: already trusted — resolve immediately without rendering.
  useEffect(() => {
    if (hasTrustDialogAccepted) {
      setSessionTrustAccepted(true)
      onDone()
    }
  }, [])

  useEffect(() => {
    if (hasTrustDialogAccepted) return

    // Ensure stdin is flowing so 'data' events fire in all terminal environments
    // (VSCode integrated terminal, embedded views, piped stdin, etc.)
    if (!process.stdin.readableFlowing) {
      process.stdin.resume()
    }

    const onData = (chunk: Buffer | string) => {
      const str = typeof chunk === 'string' ? chunk : chunk.toString('utf8')

      if (str === '\x1b[A' || str === '\x1bOA') {
        // Up arrow
        const next = (stateRef.current.focusIdx - 1 + OPTIONS.length) % OPTIONS.length
        stateRef.current.focusIdx = next
        setFocusIdx(next)
      } else if (str === '\x1b[B' || str === '\x1bOB') {
        // Down arrow
        const next = (stateRef.current.focusIdx + 1) % OPTIONS.length
        stateRef.current.focusIdx = next
        setFocusIdx(next)
      } else if (str === '\r' || str === '\n' || str === '\r\n') {
        // Enter — guard against double-fire
        if (stateRef.current.done) return
        stateRef.current.done = true
        const chosen = OPTIONS[stateRef.current.focusIdx]
        if (chosen?.value === 'exit') {
          gracefulShutdownSync(1)
        } else {
          acceptTrust(onDone)
        }
      } else if (str === '\x1b' || str === '\x1b\x1b') {
        // Escape — exit
        gracefulShutdownSync(0)
      } else if (str === '\x03') {
        // Ctrl+C — exit
        gracefulShutdownSync(1)
      }
    }

    process.stdin.on('data', onData)
    return () => {
      process.stdin.off('data', onData)
    }
  }, [hasTrustDialogAccepted, onDone])

  if (hasTrustDialogAccepted) return null

  const cwd = getFsImplementation().cwd()

  return (
    <PermissionDialog color="warning" titleColor="warning" title="Accessing workspace:">
      <Box flexDirection="column" gap={1} paddingTop={1}>
        <Text bold>{cwd}</Text>

        <Text>
          Quick safety check: Is this a project you created or one you trust?
          (Like your own code, a well-known open source project, or work from your team.)
          If not, take a moment to review what{"'"}s in this folder first.
        </Text>

        <Text>{"localClawd'll be able to read, edit, and execute files here."}</Text>

        <Box flexDirection="column">
          {OPTIONS.map((opt, i) => (
            <Box key={opt.value} gap={1}>
              <Text color="yellow">{i === focusIdx ? '▶' : ' '}</Text>
              <Text bold={i === focusIdx} color={i === focusIdx ? 'white' : undefined}>
                {opt.label}
              </Text>
            </Box>
          ))}
        </Box>

        <Text dimColor>↑↓ navigate · Enter confirm · Esc cancel</Text>
      </Box>
    </PermissionDialog>
  )
}
