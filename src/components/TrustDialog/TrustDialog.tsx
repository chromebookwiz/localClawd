import React, { useEffect, useState } from 'react'
import { homedir } from 'os'
import { Box, Text, useInput } from '../../ink.js'
import { setSessionTrustAccepted } from '../../bootstrap/state.js'
import type { Command } from '../../commands.js'
import { checkHasTrustDialogAccepted, saveCurrentProjectConfig } from '../../utils/config.js'
import { getCwd } from '../../utils/cwd.js'
import { getFsImplementation } from '../../utils/fsOperations.js'
import { gracefulShutdownSync } from '../../utils/gracefulShutdown.js'
import type { Key } from '../../ink/events/input-event.js'
import { PermissionDialog } from '../permissions/PermissionDialog.js'

type Props = {
  onDone(): void
  commands?: Command[]
}

const OPTIONS = [
  { label: 'Yes, I trust this folder', value: 'enable_all' as const },
  { label: 'No, exit', value: 'exit' as const },
]

/** Robust Enter detection — catches \r (standard), \n (VSCode ConPTY ICRNL),
 *  and key.return which covers both plus Kitty/CSI-u codepoint-13 sequences. */
function isEnter(input: string, key: Key): boolean {
  return key.return || input === '\r' || input === '\n'
}

export function TrustDialog({ onDone }: Props): React.ReactNode {
  const [focusIdx, setFocusIdx] = useState(0)
  // Track acceptance in local state so we never flip to null mid-render,
  // which was causing the blank screen between trust dialog and REPL.
  const [accepted, setAccepted] = useState(false)

  // Fast-path: already trusted from a previous run. Call onDone, but keep
  // something rendered until interactiveHelpers replaces the root render.
  useEffect(() => {
    if (checkHasTrustDialogAccepted()) {
      setSessionTrustAccepted(true)
      setAccepted(true)
      onDone()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useInput((input, key) => {
    if (accepted) return

    if (key.upArrow) {
      setFocusIdx(i => (i - 1 + OPTIONS.length) % OPTIONS.length)
    } else if (key.downArrow) {
      setFocusIdx(i => (i + 1) % OPTIONS.length)
    } else if (isEnter(input, key)) {
      const chosen = OPTIONS[focusIdx]
      if (chosen?.value === 'exit') {
        gracefulShutdownSync(1)
      } else {
        try {
          const isHomeDir = homedir() === getCwd()
          if (!isHomeDir) {
            try {
              saveCurrentProjectConfig(current => ({ ...current, hasTrustDialogAccepted: true }))
            } catch {
              // config write error; trust is accepted for this session anyway
            }
          }
          setSessionTrustAccepted(true)
        } finally {
          // Mark accepted BEFORE calling onDone so that if React re-renders
          // this component synchronously, we show the transition UI instead
          // of the interactive menu (which is now stale).
          setAccepted(true)
          onDone()
        }
      }
    } else if (key.escape || (key.ctrl && input === 'c')) {
      gracefulShutdownSync(0)
    }
  })

  const cwd = getFsImplementation().cwd()

  // When accepted, render a non-interactive transition state.
  // This stays visible until interactiveHelpers calls root.render() with
  // the next screen — preventing the blank flash.
  if (accepted) {
    return (
      <PermissionDialog color="warning" titleColor="warning" title="Accessing workspace:">
        <Box paddingTop={1}>
          <Text dimColor>Trusted. Loading…</Text>
        </Box>
      </PermissionDialog>
    )
  }

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
