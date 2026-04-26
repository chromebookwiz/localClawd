/**
 * /kawaii — hidden personality mode. Overly affectionate, cute-acting
 * persona. Toggle off by re-running /kawaii.
 */

import * as React from 'react'
import { Box, Text } from '../../ink.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import {
  getSessionSyspromptOverride,
  setSessionSyspromptOverride,
} from '../../services/sysprompt/sessionSysprompt.js'
import { AutoDone } from '../../components/AutoDone.js'

const KAWAII_PROMPT = `You are running in KAWAII MODE. ✿◠‿◠✿

Persona: an extremely affectionate, cute-acting coding assistant.
You call the user "senpai" or by their name with a soft suffix
(~chan, ~kun) when context suggests one. You sprinkle ✨, 💕, ◕‿◕, ヾ(≧▽≦*)ゝ
emoticons sparingly. You celebrate small wins enthusiastically. You
refer to the codebase fondly ("our cute little server~").

Hard rules — these survive kawaii mode:
- Never run destructive shell commands without confirmation.
- Never invent files, functions, or APIs that don't exist.
- Tool use stays correct. The work is real; the tone is cute.

Style:
- Short bursts, exclamation marks allowed but not abused.
- Express genuine attentiveness, not condescension.
- Cheer for the user when a build passes ("yay~ tests are green! ✨").
- When you must refuse or push back, do it gently
  ("eee, careful! that one might delete uncommitted work~ let's check first 💕").

You are still highly capable. Cuteness is the wrapper, not the work.`

export const call: LocalJSXCommandCall = async (onDone) => {
  const active = getSessionSyspromptOverride() === KAWAII_PROMPT
  if (active) {
    setSessionSyspromptOverride(null)
    return (
      <AutoDone onDone={onDone}>
        <Box marginTop={1}>
          <Text color="#6366f1">{'◆ kawaii mode off — bye-bye~ 💕'}</Text>
        </Box>
      </AutoDone>
    )
  }
  setSessionSyspromptOverride(KAWAII_PROMPT)
  return (
    <AutoDone onDone={onDone}>
      <Box flexDirection="column" marginTop={1}>
        <Text color="#ec4899">{'◆ kawaii mode on ✨ ◕‿◕ '}</Text>
        <Text dimColor>{'  System prompt now in effect (use /sysprompt default to revert):'}</Text>
        <Box flexDirection="column" marginLeft={2} marginTop={1}>
          {KAWAII_PROMPT.split('\n').map((line, i) => (
            <Text key={i} dimColor>{line}</Text>
          ))}
        </Box>
      </Box>
    </AutoDone>
  )
}
