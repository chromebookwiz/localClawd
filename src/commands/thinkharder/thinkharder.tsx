/**
 * /thinkharder — 3-iteration refinement pipeline with final review gate.
 *
 * Injects a structured meta-message that enforces a four-phase development
 * cycle PER FILE OR CHANGE before any Edit/Write/Bash call:
 *
 *   PHASE 1 — DRAFT:    Write the initial implementation. Think out loud.
 *   PHASE 2 — CRITIQUE: Self-review for correctness, edge cases, style,
 *                        performance, and security. List all issues found.
 *   PHASE 3 — REFINE:   Apply every fix identified in the critique.
 *   PHASE 4 — VERIFY:   Final check that refinements are correct and the
 *                        critiqueissues are resolved. Confirm with ✓ marks.
 *
 * Only AFTER completing all four phases should the model use Edit/Write/Bash
 * to persist the result. This prevents the common failure mode of writing
 * first-draft code directly to disk.
 *
 * The pipeline is enforced via a re-queued meta-message that includes the
 * current iteration counter, so the model knows which phase it is in and
 * can track progress across tool calls.
 *
 * /thinknormal resets to the default pipeline: no extra prompts, lattice
 * memory is fallback-only as designed.
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
[THINK HARDER — 3-ITERATION REFINEMENT PIPELINE ACTIVE]

Every code change or file edit must pass through all four phases before
being written to disk. Do NOT call Edit, Write, or Bash with new code until
Phase 4 is complete.

══════════════════════════════════════════════════════════
PHASE 1 — DRAFT
══════════════════════════════════════════════════════════
Write the initial implementation in full inside a code block.
Think aloud: describe your approach, key decisions, and any tradeoffs.
Do NOT call any write tool yet.

══════════════════════════════════════════════════════════
PHASE 2 — CRITIQUE  (self-review)
══════════════════════════════════════════════════════════
Critically review your draft. For each issue found, write:
  ✗ [CATEGORY] Description of the issue

Categories: CORRECTNESS | EDGE CASE | PERFORMANCE | SECURITY |
            STYLE | NAMING | MISSING LOGIC | TYPE SAFETY

If the draft is perfect (rare), write: ✓ No issues found — proceeding.

══════════════════════════════════════════════════════════
PHASE 3 — REFINE
══════════════════════════════════════════════════════════
Apply every fix from Phase 2. For each fix:
  → [CATEGORY] What you changed and why

Write the complete refined implementation inside a code block.

══════════════════════════════════════════════════════════
PHASE 4 — VERIFY  (final gate)
══════════════════════════════════════════════════════════
For each issue listed in Phase 2, confirm:
  ✓ [CATEGORY] Resolved: description of fix applied

Only after ALL issues are marked ✓ may you call Edit/Write/Bash to
persist the code. If new issues are discovered during verification,
loop back to Phase 3.

══════════════════════════════════════════════════════════
ADDITIONAL RULES
══════════════════════════════════════════════════════════
• READ every file before editing it — never guess current contents.
• CHECK memory files at the start of each new task for relevant context.
• After writing a change, verify it by reading the file back.
• Prefer small, focused edits over large sweeping rewrites.
• Explain each non-trivial decision briefly for the user.

Begin Phase 1 now.`

const THINKNORMAL_PROMPT = `\
[THINK HARDER DEACTIVATED — default pipeline restored]

Resume standard operation:
• Normal tool use and response pipeline apply.
• Lattice memory scoring is available as a fallback only (not invoked by default).
• You may write code without the 3-phase refinement cycle, though careful
  reasoning is always encouraged.`

// ─── UI Components ───────────────────────────────────────────────────────────

function ThinkHarderBanner({ onReady }: { onReady: () => void }): React.ReactNode {
  React.useEffect(() => {
    const id = setTimeout(onReady, 0)
    return () => clearTimeout(id)
  }, [onReady])

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color="magenta">
        {'◆ Think Harder — 3-iteration refinement pipeline ACTIVE'}
      </Text>
      <Box flexDirection="column" marginLeft={2}>
        <Text dimColor>{'Phase 1 DRAFT  → Phase 2 CRITIQUE  → Phase 3 REFINE  → Phase 4 VERIFY  → Write'}</Text>
        <Text dimColor>{'Each code change must pass all four phases before being saved.'}</Text>
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
