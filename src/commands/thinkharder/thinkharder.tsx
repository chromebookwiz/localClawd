/**
 * /thinkharder — 4-layer human cognition loop + 5-phase formal refinement.
 *
 * Architecture: mirrors the neuroscience model of human memory systems
 * (Baddeley, Tulving, Anderson) layered on top of a formal verification
 * pipeline. The lattice memory scoring system is ACTIVE in this mode —
 * semantic memory queries run on every task, not just as a fallback.
 *
 * Memory layers (pre-phase priming):
 *   Layer 0 — WORKING MEMORY   (Baddeley): active task context, ~7 items
 *   Layer 1 — EPISODIC MEMORY  (Tulving):  session history, recent actions
 *   Layer 2 — SEMANTIC MEMORY  (lattice):  long-term knowledge, memory files
 *   Layer 3 — PROCEDURAL MEMORY (implicit): CLAUDE.md rules, standing patterns
 *
 * Followed by 5-phase verification per change:
 *   Phase 0 ORIENT → Phase 1 DRAFT → Phase 2 CRITIQUE → Phase 3 REFINE → Phase 4 VERIFY
 *
 * /thinknormal resets to default pipeline and deactivates lattice.
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
[THINK HARDER — HUMAN COGNITION LOOP + 5-PHASE FORMAL PIPELINE ACTIVE]

══════════════════════════════════════════════════════════════════════
PRE-PHASE — MEMORY PRIMING  (run before every task, not just per file)
══════════════════════════════════════════════════════════════════════

Your cognition is modelled on four neuroscientific memory systems.
Prime each layer now before beginning any work:

┌─────────────────────────────────────────────────────────────────────┐
│  Layer 0 — WORKING MEMORY  (Baddeley's phonological + visuospatial) │
│                                                                     │
│  Capacity: ~7 ± 2 items. Decays in seconds without rehearsal.      │
│  Action: State the CURRENT GOAL in one sentence. List the active   │
│  files, pending decisions, and any open questions. Anything not     │
│  listed here is at risk of being forgotten — be explicit.           │
├─────────────────────────────────────────────────────────────────────┤
│  Layer 1 — EPISODIC MEMORY  (Tulving's autonoetic consciousness)    │
│                                                                     │
│  Session-bound, time-indexed recall of personal experience.         │
│  Action: What happened THIS SESSION? What was attempted and         │
│  succeeded? What failed and why? What blockers were hit?           │
│  Use this to avoid repeating mistakes and to build on progress.     │
├─────────────────────────────────────────────────────────────────────┤
│  Layer 2 — SEMANTIC MEMORY  (lattice-indexed long-term knowledge)   │
│                                                                     │
│  Conceptual knowledge decoupled from time. In this mode the        │
│  geometric algebra lattice is ACTIVE — memory files are scored      │
│  and recalled via Clifford algebra multivector similarity.          │
│  Action: Read the memory files surfaced by the system. Extract      │
│  architectural decisions, known invariants, and prior context       │
│  relevant to this task. Treat memory files as your long-term brain. │
├─────────────────────────────────────────────────────────────────────┤
│  Layer 3 — PROCEDURAL MEMORY  (Anderson's ACT-R implicit skills)    │
│                                                                     │
│  Compiled habits that run without conscious attention.              │
│  Action: Apply CLAUDE.md rules, project conventions, and standing   │
│  style guides as automatic constraints — not as a checklist to      │
│  consult, but as invariants that must hold by construction.         │
└─────────────────────────────────────────────────────────────────────┘

Write a MEMORY PRIME block (4 short bullet groups, one per layer)
before Phase 0. This block is your cognitive anchor for the task.

═══════════════════════════════════════════════════════════════════════
PHASE 0 — ORIENT  (invariant mapping)
═══════════════════════════════════════════════════════════════════════
Building on your Memory Prime, map the landscape formally:
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
Reference invariants from Phase 0 and semantic memory from Layer 2.
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
  ✓ MEMORY      Solution is consistent with semantic memory (Layer 2) — no
                architectural decisions in memory files are violated.

Only after ALL items are ✓ may you call Edit/Write/Bash to persist.
If new issues surface during verification, loop back to Phase 3.

═══════════════════════════════════════════════════════════════════════
STANDING RULES  (procedural memory — always active)
═══════════════════════════════════════════════════════════════════════
• READ every file before editing — never guess current contents.
• CHECK memory files at task start for relevant architectural context.
• After writing a change, READ back to confirm correctness.
• Prefer small, focused edits over large sweeping rewrites.
• Treat the type system as a proof assistant.
• Run builds/tests after non-trivial changes.
• Commit logical units of work with descriptive messages.

Begin Memory Priming now, then proceed to Phase 0.`

export const THINKHARDER_ROUND_PROMPT = `\
[THINK HARDER — ROUND CONTINUATION]
Memory priming active. Before proceeding:
  L0 Working: restate current goal and active context
  L1 Episodic: what did the last round accomplish?
  L2 Semantic: any memory files relevant to next step?
  L3 Procedural: which CLAUDE.md rules apply here?
Then continue with the 5-phase pipeline for the next change.`

const THINKNORMAL_PROMPT = `\
[THINK HARDER DEACTIVATED — default pipeline restored]

Resume standard operation:
• Normal tool use and response pipeline.
• Lattice memory scoring returns to fallback-only mode.
• Memory priming and 5-phase refinement are no longer required,
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
        {'◆ Think Harder — Human Cognition Loop + 5-Phase Pipeline ACTIVE'}
      </Text>
      <Box flexDirection="column" marginLeft={2}>
        <Text dimColor>{'L0 Working · L1 Episodic · L2 Semantic (lattice ON) · L3 Procedural'}</Text>
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
      <Text dimColor>{'  Default pipeline. Lattice memory is fallback-only.'}</Text>
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
          shouldQuery: !nextCmd,
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
          shouldQuery: !nextCmd,
          metaMessages: [THINKNORMAL_PROMPT],
          nextInput: nextCmd ?? undefined,
          submitNextInput: nextCmd ? true : undefined,
        })
      }
    />
  )
}
