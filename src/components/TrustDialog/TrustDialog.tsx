import React, { useEffect, useState } from 'react'
import { homedir } from 'os'
import { Box, Text, useInput } from '../../ink.js'
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

export function TrustDialog({ onDone }: Props): React.ReactNode {
  const hasTrustDialogAccepted = checkHasTrustDialogAccepted()
  const [focusIdx, setFocusIdx] = useState(0)

  // When already trusted, resolve on mount.
  useEffect(() => {
    if (hasTrustDialogAccepted) {
      setSessionTrustAccepted(true)
      onDone()
    }
  }, [hasTrustDialogAccepted, onDone])

  useInput((input, key) => {
    if (hasTrustDialogAccepted) return

    if (key.upArrow) {
      setFocusIdx(i => (i - 1 + OPTIONS.length) % OPTIONS.length)
    } else if (key.downArrow) {
      setFocusIdx(i => (i + 1) % OPTIONS.length)
    } else if (key.return) {
      const chosen = OPTIONS[focusIdx]
      if (chosen?.value === 'exit') {
        gracefulShutdownSync(1)
      } else {
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
    } else if (key.escape || (key.ctrl && input === 'c')) {
      gracefulShutdownSync(0)
    }
  })

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
