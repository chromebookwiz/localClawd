/**
 * /research <topic> — Head Researcher with parallel web search subroutines.
 *
 * Architecture:
 *   Head Researcher (this command)
 *     ├── Decomposes the research question into N sub-queries
 *     ├── Spawns one Agent per sub-query (parallel, run_in_background=true if N>2)
 *     │     Each sub-agent: web_search + web_fetch top results → structured summary
 *     └── Synthesizes all sub-reports into a final answer with citations
 *
 * Compatible chains:
 *   /thinkharder /research <topic>
 *   /research <topic> /keepgoing
 *   /sysprompt ... /research <topic>
 */

import * as React from 'react'
import { Box, Text } from '../../ink.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import { isThinkHarderMode } from '../thinkharder/thinkharder.js'
import {
  extractChain,
  validateCommandChain,
  parseCommandChain,
  chainWarning,
} from '../../utils/commandChaining.js'

// ─── Research prompt templates ────────────────────────────────────────────────

function buildResearchPrompt(topic: string, thinkHarder: boolean): string {
  const thinkHarderSection = thinkHarder
    ? `\nYou are in THINK HARDER mode. Apply rigorous multi-layer analysis:
  L0 Working: state the research question and key sub-questions
  L1 Episodic: what do you already know about this?
  L2 Semantic: what related concepts are relevant?
  L3 Procedural: what research methodology is most appropriate?\n`
    : ''

  return `\
[RESEARCH MISSION — HEAD RESEARCHER]
${thinkHarderSection}
You are the HEAD RESEARCHER for this mission:

RESEARCH QUESTION: ${topic}

━━━ YOUR MISSION ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. DECOMPOSE the research question into 3-5 targeted sub-queries that
   cover different angles (recent news, technical depth, background,
   applications, controversies, expert opinions, etc.)

2. SPAWN a subagent for each sub-query using the Agent tool with:
   - subagent_type: "general-purpose"
   - run_in_background: true (for parallel execution)
   - A focused prompt instructing the sub-agent to:
     a) Use web_search to find 3-5 relevant sources
     b) Use web_fetch on the top 2-3 results to extract key information
     c) Return a structured mini-report with: Summary, Key Facts, Sources

3. WAIT for all subagents to complete. Collect their reports.

4. SYNTHESIZE a comprehensive final research report:
   ━━━ RESEARCH REPORT: <TOPIC> ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   ## Executive Summary
   [2-3 paragraph synthesis of all findings]

   ## Key Findings
   [Numbered list of the most important discoveries]

   ## Details
   [Organized sections for each major sub-topic]

   ## Analysis
   [Critical evaluation, gaps, contradictions, implications]

   ## Sources
   [All URLs as markdown hyperlinks, organized by sub-topic]

   ## Confidence Level
   [Rate your confidence 1-10 and explain why]
   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

━━━ RULES ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- ALWAYS cite sources with markdown hyperlinks
- NEVER fabricate statistics or facts — mark uncertainty explicitly
- If a sub-agent fails, note it and compensate with broader research
- Prioritize recency: prefer sources from the last 12 months when relevant
- Cross-reference conflicting information and flag discrepancies

BEGIN: Start by stating the research question, then spawn your sub-agents.`
}

// ─── UI ───────────────────────────────────────────────────────────────────────

function ResearchBanner({
  topic,
  thinkHarder,
  chainCmd,
  onReady,
}: {
  topic: string
  thinkHarder: boolean
  chainCmd: string | null
  onReady: () => void
}): React.ReactNode {
  React.useEffect(() => {
    const id = setTimeout(onReady, 0)
    return () => clearTimeout(id)
  }, [onReady])

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color="blue">
        {`🔬 Research  ${thinkHarder ? '🧠 ThinkHarder ' : ''}${chainCmd ? `→ ${chainCmd}` : ''}`}
      </Text>
      <Text dimColor>{`  ↳ Topic: ${topic.slice(0, 80)}${topic.length > 80 ? '…' : ''}`}</Text>
      <Text dimColor>{'  ↳ Spawning parallel research sub-agents…'}</Text>
    </Box>
  )
}

function ResearchWarning({
  message,
  onReady,
}: {
  message: string
  onReady: () => void
}): React.ReactNode {
  React.useEffect(() => {
    const id = setTimeout(onReady, 0)
    return () => clearTimeout(id)
  }, [onReady])

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color="yellow">{message}</Text>
    </Box>
  )
}

// ─── Command entry point ──────────────────────────────────────────────────────

export const call: LocalJSXCommandCall = async (onDone, _context, args) => {
  const rawArgs = args?.trim() ?? ''

  // Extract chain
  const { ownArgs: topic, nextCmd } = extractChain(rawArgs)

  // Warn if no topic provided
  if (!topic) {
    const handleReady = () => onDone('Usage: /research <topic or question>')
    return (
      <ResearchWarning
        message="Usage: /research <topic or question>\nExample: /research latest advances in quantum computing"
        onReady={handleReady}
      />
    )
  }

  // Validate full chain
  if (nextCmd) {
    const fullChain = parseCommandChain(`/research ${rawArgs}`)
    if (fullChain && fullChain.length > 1) {
      const validation = validateCommandChain(fullChain)
      if (validation.ok === false) {
        const msg = chainWarning(validation.reason)
        return (
          <ResearchWarning message={msg} onReady={() => onDone(msg)} />
        )
      }
    }
  }

  const thinkHarder = isThinkHarderMode
  const prompt = buildResearchPrompt(topic, thinkHarder)

  const handleReady = () => {
    onDone(undefined, {
      display: 'system',
      shouldQuery: true,
      metaMessages: [prompt],
      nextInput: nextCmd ?? undefined,
      submitNextInput: nextCmd ? true : undefined,
    })
  }

  return (
    <ResearchBanner
      topic={topic}
      thinkHarder={thinkHarder}
      chainCmd={nextCmd}
      onReady={handleReady}
    />
  )
}
