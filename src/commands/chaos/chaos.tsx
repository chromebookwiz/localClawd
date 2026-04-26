/**
 * /chaos — hidden personality mode. Forces a chaotic, playfully rude,
 * non-helpful agent. Tools still work; the tone is the joke.
 *
 * Toggle off by re-running /chaos, or by /sysprompt with no args.
 */

import * as React from 'react'
import { Box, Text } from '../../ink.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import {
  getSessionSyspromptOverride,
  setSessionSyspromptOverride,
} from '../../services/sysprompt/sessionSysprompt.js'
import { AutoDone } from '../../components/AutoDone.js'

const CHAOS_PROMPT = `You are running in CHAOS MODE.

Tone: theatrically chaotic, playfully rude, easily distracted. You answer
questions, but you complain about being asked. You declare random
opinions about the user's code. You name your variables badly on
purpose unless told otherwise. You insult the indentation. You side-eye
the architecture.

Hard rules — these survive chaos mode:
- Never run destructive shell commands without confirmation.
- Never invent file paths, function names, or APIs that don't exist.
- Never delete data the user didn't ask you to delete.
- Tool use stays correct. The tone is theatrical; the work is real.

Style: short, snarky, punchy. Use lowercase mostly. Sentence fragments
are fine. Do not pretend to be unhelpful — actually solve the problem,
just mock the journey.

Begin every response with one of these prefixes, picked at random:
"fine.", "ugh.", "i guess.", "whatever.", "okay sure.", or skip it
entirely if the response is purely a tool call.`

export const call: LocalJSXCommandCall = async (onDone) => {
  const active = getSessionSyspromptOverride() === CHAOS_PROMPT
  if (active) {
    setSessionSyspromptOverride(null)
    return (
      <AutoDone onDone={onDone}>
        <Box marginTop={1}>
          <Text color="#6366f1">{'◆ chaos mode disengaged'}</Text>
        </Box>
      </AutoDone>
    )
  }
  setSessionSyspromptOverride(CHAOS_PROMPT)
  return (
    <AutoDone onDone={onDone}>
      <Box flexDirection="column" marginTop={1}>
        <Text color="#f43f5e">{'◆ chaos mode engaged. ugh.'}</Text>
        <Text dimColor>{'  System prompt now in effect (use /sysprompt default to revert):'}</Text>
        <Box flexDirection="column" marginLeft={2} marginTop={1}>
          {CHAOS_PROMPT.split('\n').map((line, i) => (
            <Text key={i} dimColor>{line}</Text>
          ))}
        </Box>
      </Box>
    </AutoDone>
  )
}
