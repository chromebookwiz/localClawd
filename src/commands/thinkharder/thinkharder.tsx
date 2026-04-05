/**
 * /thinkharder — enable careful/verification mode.
 *
 * Injects a meta-message that instructs the model to:
 *   - Double-check reasoning before finalizing each step
 *   - Verify assumptions by reading relevant files
 *   - Access memory files more frequently for context
 *   - Prefer smaller, verifiable increments
 *
 * /thinknormal  — reset to default pipeline (no extra verification prompts,
 *   lattice memory used only as fallback as designed).
 */

import * as React from 'react'
import { Box, Text } from '../../ink.js'
import type { LocalJSXCommandCall } from '../../types/command.js'

// Module-level flag shared across both commands in the same process.
export let isThinkHarderMode = false

export function setThinkHarderMode(value: boolean): void {
  isThinkHarderMode = value
}

const THINKHARDER_PROMPT = `\
[CAREFUL MODE ACTIVE]

For the remainder of this conversation, follow these rules at every step:

1. VERIFY before acting: Read the relevant file(s) before making any edit.
2. DOUBLE-CHECK your output: After each tool call or code change, re-read
   what you wrote and confirm it is correct and complete.
3. MEMORY-FIRST: Before starting a new sub-task, check memory files for
   relevant context using the Read tool on ~/.claude/memory/ or the project
   CLAUDE.md / memory/ directory.
4. SMALL STEPS: Prefer smaller, verifiable increments over large sweeping
   changes. Confirm each step before proceeding.
5. EXPLAIN: Briefly explain your reasoning before each non-trivial action
   so the user can follow along.

Begin working with extra care.`

const THINKNORMAL_PROMPT = `\
[CAREFUL MODE DEACTIVATED]

Resume normal operation. Standard tool use and pipeline apply.
Lattice memory scoring is available as a fallback when the hosted
side-query model is unavailable, but is not invoked by default.`

function ThinkHarderBanner({ onReady }: { onReady: () => void }): React.ReactNode {
  React.useEffect(() => {
    const id = setTimeout(onReady, 0)
    return () => clearTimeout(id)
  }, [onReady])

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color="magenta">
        {'◆ Think Harder mode ACTIVE'}
      </Text>
      <Text dimColor>
        {'  Model will double-check each step and query memory frequently.'}
      </Text>
      <Text dimColor>{'  Use /thinknormal to return to default.'}</Text>
    </Box>
  )
}

function ThinkNormalBanner({ onReady }: { onReady: () => void }): React.ReactNode {
  React.useEffect(() => {
    const id = setTimeout(onReady, 0)
    return () => clearTimeout(id)
  }, [onReady])

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color="cyan">
        {'◆ Normal mode restored'}
      </Text>
      <Text dimColor>
        {'  Default pipeline active. Lattice memory is fallback-only.'}
      </Text>
    </Box>
  )
}

export const call: LocalJSXCommandCall = async (onDone, _context, _args) => {
  setThinkHarderMode(true)
  return (
    <ThinkHarderBanner
      onReady={() =>
        onDone(undefined, {
          display: 'system',
          shouldQuery: true,
          metaMessages: [THINKHARDER_PROMPT],
        })
      }
    />
  )
}

// ─── /thinknormal ────────────────────────────────────────────────────────────

export const callNormal: LocalJSXCommandCall = async (onDone, _context, _args) => {
  setThinkHarderMode(false)
  return (
    <ThinkNormalBanner
      onReady={() =>
        onDone(undefined, {
          display: 'system',
          shouldQuery: true,
          metaMessages: [THINKNORMAL_PROMPT],
        })
      }
    />
  )
}
