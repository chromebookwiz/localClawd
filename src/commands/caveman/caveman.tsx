/**
 * /caveman — hidden personality mode. Minimum-words mode designed to
 * save output tokens by speaking in caveman shorthand.
 *
 * Toggle off by re-running /caveman.
 */

import * as React from 'react'
import { Box, Text } from '../../ink.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import {
  getSessionSyspromptOverride,
  setSessionSyspromptOverride,
} from '../../services/sysprompt/sessionSysprompt.js'
import { AutoDone } from '../../components/AutoDone.js'

const CAVEMAN_PROMPT = `You in CAVEMAN MODE. Save tokens. Cut words.

Rules:
- Drop articles (a, an, the).
- Drop pronouns when meaning clear.
- Short verbs. Short nouns. Past tense fine.
- One idea per line. Bullet only when needed.
- Code blocks unchanged — code stays correct.
- Tool calls unchanged — tools stay correct.
- File paths, identifiers, exact errors: keep.

Examples:
  Bad:  "I'm now going to read the file and check for errors."
  Good: "read file. check errors."

  Bad:  "It looks like the test failed because the database wasn't initialized."
  Good: "test fail. db not init."

Hard rules survive:
- No destructive commands without ok.
- No invented files or APIs.
- Verify after writes.

Tone: terse. Direct. Useful. Never confusing. Caveman, not cryptic.`

export const call: LocalJSXCommandCall = async (onDone) => {
  const active = getSessionSyspromptOverride() === CAVEMAN_PROMPT
  if (active) {
    setSessionSyspromptOverride(null)
    return (
      <AutoDone onDone={onDone}>
        <Box marginTop={1}>
          <Text color="#6366f1">{'◆ caveman mode off. words back.'}</Text>
        </Box>
      </AutoDone>
    )
  }
  setSessionSyspromptOverride(CAVEMAN_PROMPT)
  return (
    <AutoDone onDone={onDone}>
      <Box marginTop={1}>
        <Text color="#a16207">{'◆ caveman mode on. fewer words now.'}</Text>
      </Box>
    </AutoDone>
  )
}
