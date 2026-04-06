/**
 * /thinkharder — formal 5-phase refinement pipeline with mathematical rigour.
 *
 * Injects a structured meta-message enforcing a five-phase development cycle
 * PER FILE OR CHANGE before any Edit/Write/Bash call:
 *
 *   PHASE 0 — ORIENT:   Map the type system, invariants, and module contracts.
 *   PHASE 1 — DRAFT:    Write the initial implementation. Think aloud.
 *   PHASE 2 — CRITIQUE: Self-review across 10 categories. List every issue.
 *   PHASE 3 — REFINE:   Apply every fix. Preserve all invariants and contracts.
 *   PHASE 4 — VERIFY:   Formal gate — confirm each issue resolved and that
 *                        the solution composes correctly as a morphism in the
 *                        broader module graph. Write only after ✓ on all items.
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
[THINK HARDER — 5-PHASE FORMAL REFINEMENT PIPELINE ACTIVE]

Every code change must pass all five phases before being written to disk.
Do NOT call Edit, Write, or Bash with new code until Phase 4 is complete.

══════════════════════════════════════════════════════════
PHASE 0 — ORIENT  (invariant mapping)
══════════════════════════════════════════════════════════
Before writing anything, map the landscape:
  • List the module's public contracts (exported types / functions / constants).
  • Identify any state invariants that must hold before and after your change
    (e.g. "array is always sorted", "ref is non-null after init").
  • Identify composability constraints: does this function act as a morphism
    in a larger pipeline? What are its domain and codomain types?
  • Note any side-effects (I/O, global state mutation, async races).

Write a short bulleted ORIENT block before proceeding.

══════════════════════════════════════════════════════════
PHASE 1 — DRAFT
══════════════════════════════════════════════════════════
Write the initial implementation in full inside a code block.
Think aloud: describe your approach, key decisions, and tradeoffs.
Reference the invariants identified in Phase 0.
Do NOT call any write tool yet.

══════════════════════════════════════════════════════════
PHASE 2 — CRITIQUE  (10-category self-review)
══════════════════════════════════════════════════════════
Critically review your draft. For each issue found, write:
  ✗ [CATEGORY] Description of the issue

Categories (check all ten):
  CORRECTNESS       — logic errors, wrong algorithm, incorrect output
  INVARIANT         — any invariant from Phase 0 that could be violated
  EDGE CASE         — empty inputs, boundary values, overflow, null/undefined
  PERFORMANCE       — algorithmic complexity, unnecessary allocations, hot paths
  SECURITY          — injection, path traversal, XSS, unvalidated external input
  TYPE SAFETY       — unsound casts, any types, missing discriminants
  COMPOSABILITY     — does the function compose cleanly? breaks callers? leaks impl?
  CONCURRENCY       — race conditions, missing abort handling, unguarded shared state
  ERROR HANDLING    — uncaught throws, swallowed errors, missing cleanup on failure
  STYLE / NAMING    — misleading names, poor readability, unnecessary complexity

If the draft is flawless (rare), write: ✓ No issues found — proceeding to Phase 3.

══════════════════════════════════════════════════════════
PHASE 3 — REFINE
══════════════════════════════════════════════════════════
Apply every fix from Phase 2. For each fix, write:
  → [CATEGORY] What you changed and why.

Re-verify invariants from Phase 0 after each fix — a fix for one category
must not introduce a violation in another.
Write the complete refined implementation in a code block.

══════════════════════════════════════════════════════════
PHASE 4 — VERIFY  (formal gate)
══════════════════════════════════════════════════════════
For each issue listed in Phase 2, confirm:
  ✓ [CATEGORY] Resolved: description of what was fixed.

Then confirm the two composition checks:
  ✓ MORPHISM   The change preserves the function's role as a valid morphism
               in the module graph — callers still type-check, contracts hold.
  ✓ INVARIANTS All invariants mapped in Phase 0 hold after this change.

Only after ALL items are marked ✓ may you call Edit/Write/Bash to persist
the code. If new issues surface during verification, loop back to Phase 3.

══════════════════════════════════════════════════════════
STANDING RULES
══════════════════════════════════════════════════════════
• READ every file before editing — never guess current contents.
• CHECK memory files at task start for relevant architectural context.
• After writing a change, READ the file back to confirm correctness.
• Prefer small, focused edits over large sweeping rewrites.
• Explain each non-trivial decision concisely for the user.
• Treat the type system as a proof assistant: if TypeScript accepts it
  without casts, that is evidence (not proof) of correctness.

Begin Phase 0 now.`

const THINKNORMAL_PROMPT = `\
[THINK HARDER DEACTIVATED — default pipeline restored]

Resume standard operation:
• Normal tool use and response pipeline apply.
• Lattice memory scoring is available as a fallback only (not invoked by default).
• You may write code without the 5-phase refinement cycle, though careful
  reasoning is always encouraged.`

// ─── UI Components ───────────────────────────────────────────────────────────

function ThinkHarderBanner({ onReady }: { onReady: () => void }): React.ReactNode {
  React.useEffect(() => {
    const id = setTimeout(onReady, 0)
    return () => clearTimeout(id)
  }, [onReady])

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color="#818cf8">
        {'◆ Think Harder — 5-phase formal refinement pipeline ACTIVE'}
      </Text>
      <Box flexDirection="column" marginLeft={2}>
        <Text dimColor>{'Phase 0 ORIENT → Phase 1 DRAFT → Phase 2 CRITIQUE → Phase 3 REFINE → Phase 4 VERIFY → Write'}</Text>
        <Text dimColor>{'Invariant mapping, 10-category critique, and morphism check before every save.'}</Text>
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
      <Text dimColor>{'  Default pipeline. Lattice memory is fallback-only.'}</Text>
    </Box>
  )
}

// ─── Command implementations ─────────────────────────────────────────────────

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
