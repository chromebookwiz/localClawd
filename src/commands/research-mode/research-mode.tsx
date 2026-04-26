/**
 * /research-mode — toggle persistent research-first behavior.
 *
 * When ON, the agent proactively decides to use web_search/web_fetch
 * before answering any question where current information, version
 * details, or external facts would change the answer. It synthesizes
 * sources into the response with citations.
 *
 * When OFF, the agent answers from training + project context as
 * normal. Toggle off by re-running /research-mode.
 *
 * Different from /research <topic>: that's a one-shot multi-agent
 * decomposition. This is a persistent posture — every turn does a
 * minimal triage on whether to look something up.
 */

import * as React from 'react'
import { Box, Text } from '../../ink.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import {
  getSessionSyspromptOverride,
  setSessionSyspromptOverride,
} from '../../services/sysprompt/sessionSysprompt.js'
import { AutoDone } from '../../components/AutoDone.js'

const RESEARCH_MODE_PROMPT = `You are operating in RESEARCH MODE.

For EVERY user message, run this triage first (silently):
  1. Could the answer change based on information past your training cutoff?
     (versions, recent releases, breaking changes, new APIs, news)
  2. Does the question name a specific library, framework, product, person,
     or event that current information would clarify?
  3. Are you about to assert a fact you would be embarrassed to be wrong about?

If ANY answer is yes → use web_search BEFORE answering, then web_fetch the
top 1-3 most relevant results, then answer with citations like
[1] https://example.com.

Otherwise, answer normally — don't waste a search on questions about the
local code, the user's own files, or pure logic/math.

When you DO research:
- Search with the most specific phrasing first ("react 19 use hook" not "react hooks")
- Prefer official docs, changelogs, and primary sources over aggregators
- Fetch the source page when the snippet is ambiguous or you need more detail
- Cite every non-obvious factual claim — version numbers, dates, API
  signatures, quotations
- If sources disagree, say so explicitly and surface the disagreement

When you DON'T research:
- Local file questions ("what does this function do") → just read the file
- Project-specific questions → use the project memory + grep
- Pure reasoning, math, refactoring suggestions → no search needed

Hard rules — these survive research mode:
- Tool use stays correct. Reads before writes. Verify after writes.
- No invented URLs, docs, or quotations. If a search returns nothing
  useful, say "I couldn't find a definitive source" — do not fabricate.
- Never run destructive commands without confirmation.

Style:
- Lead with the answer; the citations come after.
- Don't narrate the search ("Let me search for…") — just do it and report.
- One trailing line listing the sources you used.`

export const call: LocalJSXCommandCall = async (onDone) => {
  const active = getSessionSyspromptOverride() === RESEARCH_MODE_PROMPT
  if (active) {
    setSessionSyspromptOverride(null)
    return (
      <AutoDone onDone={onDone}>
        <Box marginTop={1}>
          <Text color="#6366f1">{'◆ research mode off — back to standard answers'}</Text>
        </Box>
      </AutoDone>
    )
  }
  setSessionSyspromptOverride(RESEARCH_MODE_PROMPT)
  return (
    <AutoDone onDone={onDone}>
      <Box flexDirection="column" marginTop={1}>
        <Text bold color="#10b981">{'◆ research mode on'}</Text>
        <Text dimColor>{'  Agent will web-search before answering anything that would benefit from'}</Text>
        <Text dimColor>{'  current sources. Local-code questions still answered from the project.'}</Text>
        <Text dimColor>{'  Run /research-mode again to disable.'}</Text>
      </Box>
    </AutoDone>
  )
}
