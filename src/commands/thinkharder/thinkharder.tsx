/**
 * /thinkharder — multi-layer verification pipeline.
 *
 * Activates a 5-phase formal verification pipeline that checks work
 * through layers before committing any changes:
 *   Phase 0 ORIENT → Phase 1 DRAFT → Phase 2 CRITIQUE → Phase 3 REFINE → Phase 4 VERIFY
 *
 * /thinknormal resets to default pipeline.
 */

import * as React from 'react'
import { Box, Text } from '../../ink.js'
import type { LocalJSXCommandCall } from '../../types/command.js'

// ─── Module-level state ──────────────────────────────────────────────────────

export let isThinkHarderMode = false

export function setThinkHarderMode(value: boolean): void {
  isThinkHarderMode = value
}

// ─── Prompts ─────────────────────────────────────────────────────────────────

const THINKHARDER_PROMPT = `\
[THINK HARDER — MULTI-LAYER VERIFICATION PIPELINE ACTIVE]

Every change must pass through all 5 phases before being written.
This ensures correctness through layered self-review.

═══════════════════════════════════════════════════════════════════════
PHASE 0 — ORIENT  (invariant mapping)
═══════════════════════════════════════════════════════════════════════
Before writing anything, map the landscape formally:
  • Public contracts: exported types, functions, constants this module exposes.
  • State invariants: conditions that must hold before AND after your change.
  • Composability: does this act as a morphism in a pipeline? Domain → codomain?
  • Side-effects: I/O, global state mutation, async races, resource acquisition.

Write a short bulleted ORIENT block before proceeding.

═══════════════════════════════════════════════════════════════════════
PHASE 1 — DRAFT
═══════════════════════════════════════════════════════════════════════
Write the initial implementation in full inside a code block.
Think aloud: describe approach, key decisions, tradeoffs.
Reference invariants from Phase 0.
Do NOT call any write tool yet.

═══════════════════════════════════════════════════════════════════════
PHASE 2 — CRITIQUE  (10-category self-review)
═══════════════════════════════════════════════════════════════════════
Critically review your draft. For each issue found, write:
  ✗ [CATEGORY] Description of the issue

Categories (check ALL ten — no skipping):
  CORRECTNESS       — logic errors, wrong algorithm, incorrect output
  INVARIANT         — any invariant from Phase 0 that could be violated
  EDGE CASE         — empty inputs, boundary values, overflow, null/undefined
  PERFORMANCE       — algorithmic complexity, unnecessary allocations, hot paths
  SECURITY          — injection, path traversal, XSS, unvalidated external input
  TYPE SAFETY       — unsound casts, any types, missing discriminants
  COMPOSABILITY     — does it compose cleanly? breaks callers? leaks internals?
  CONCURRENCY       — races, missing abort handling, unguarded shared state
  ERROR HANDLING    — uncaught throws, swallowed errors, missing cleanup
  STYLE / NAMING    — misleading names, poor readability, unnecessary complexity

If the draft is flawless: ✓ No issues found — proceeding to Phase 3.

═══════════════════════════════════════════════════════════════════════
PHASE 3 — REFINE
═══════════════════════════════════════════════════════════════════════
Apply every fix from Phase 2. For each fix, write:
  → [CATEGORY] What you changed and why.

Re-verify invariants from Phase 0 after each fix.
A fix for one category must not introduce a violation in another.
Write the complete refined implementation in a code block.

═══════════════════════════════════════════════════════════════════════
PHASE 4 — VERIFY  (formal gate)
═══════════════════════════════════════════════════════════════════════
For each issue from Phase 2, confirm resolution:
  ✓ [CATEGORY] Resolved: description of what was fixed.

Then confirm composition checks:
  ✓ MORPHISM    Change preserves function's role as a valid morphism in the
                module graph — callers still type-check, contracts hold.
  ✓ INVARIANTS  All invariants from Phase 0 hold after this change.

Only after ALL items are ✓ may you call Edit/Write/Bash to persist.
If new issues surface during verification, loop back to Phase 3.

═══════════════════════════════════════════════════════════════════════
STANDING RULES
═══════════════════════════════════════════════════════════════════════
• READ every file before editing — never guess current contents.
• After writing a change, READ back to confirm correctness.
• Prefer small, focused edits over large sweeping rewrites.
• Treat the type system as a proof assistant.
• Run builds/tests after non-trivial changes.

Begin with Phase 0 — ORIENT now.`

export const THINKHARDER_ROUND_PROMPT = `\
[THINK HARDER — ROUND CONTINUATION]
Review what the previous round accomplished before proceeding.
Continue with the 5-phase pipeline (ORIENT → DRAFT → CRITIQUE → REFINE → VERIFY)
for the next change.`

const THINKNORMAL_PROMPT = `\
[THINK HARDER DEACTIVATED — default pipeline restored]

Resume standard operation:
• Normal tool use and response pipeline.
• 5-phase refinement is no longer required,
  though careful reasoning is always encouraged.`

// ─── UI Components ───────────────────────────────────────────────────────────

function ThinkHarderBanner({ onReady }: { onReady: () => void }): React.ReactNode {
  React.useEffect(() => {
    const id = setTimeout(onReady, 0)
    return () => clearTimeout(id)
  }, [onReady])

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color="#818cf8">
        {'◆ Think Harder — Multi-Layer Verification Pipeline ACTIVE'}
      </Text>
      <Box flexDirection="column" marginLeft={2}>
        <Text dimColor>{'ORIENT → DRAFT → CRITIQUE → REFINE → VERIFY before every write.'}</Text>
        <Text dimColor>{'Use /thinknormal to return to default.'}</Text>
      </Box>
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
      <Text bold color="cyan">{'◆ Normal mode restored'}</Text>
      <Text dimColor>{'  Default pipeline restored.'}</Text>
    </Box>
  )
}

// ─── Command implementations ─────────────────────────────────────────────────

export const call: LocalJSXCommandCall = async (onDone, _context, args) => {
  const { extractChain, validateCommandChain, parseCommandChain, chainWarning } =
    await import('../../utils/commandChaining.js')
  const { ownArgs: _ownArgs, nextCmd } = extractChain(args ?? '')

  // Validate full chain upfront
  if (nextCmd) {
    const fullChain = parseCommandChain(`/thinkharder ${args ?? ''}`)
    if (fullChain && fullChain.length > 1) {
      const validation = validateCommandChain(fullChain)
      if (validation.ok === false) {
        const msg = chainWarning(validation.reason)
        return (
          <ThinkHarderBanner onReady={() => onDone(msg)} />
        )
      }
    }
  }

  setThinkHarderMode(true)
  return (
    <ThinkHarderBanner
      onReady={() =>
        onDone(undefined, {
          display: 'system',
          shouldQuery: false,
          metaMessages: [THINKHARDER_PROMPT],
          nextInput: nextCmd ?? undefined,
          submitNextInput: nextCmd ? true : undefined,
        })
      }
    />
  )
}

export const callNormal: LocalJSXCommandCall = async (onDone, _context, args) => {
  const { extractChain } = await import('../../utils/commandChaining.js')
  const { nextCmd } = extractChain(args ?? '')
  setThinkHarderMode(false)
  return (
    <ThinkNormalBanner
      onReady={() =>
        onDone(undefined, {
          display: 'system',
          shouldQuery: false,
          metaMessages: [THINKNORMAL_PROMPT],
          nextInput: nextCmd ?? undefined,
          submitNextInput: nextCmd ? true : undefined,
        })
      }
    />
  )
}
