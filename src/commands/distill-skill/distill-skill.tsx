/**
 * /distill-skill — propose a reusable skill from the most recent
 * session's transcript.
 *
 * Uses the local LLM to extract a name, description, step-by-step
 * instructions, and tags from what was just accomplished. The user
 * can copy the output into the skills system or ignore it.
 */

import * as React from 'react'
import { Box, Text } from '../../ink.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import { distillRecentSessionToSkill } from '../../services/skills/skillDistill.js'

function DistillResult({
  skill,
  onReady,
}: {
  skill: { name: string; description: string; instructions: string; tags: string[] } | null
  onReady: () => void
}): React.ReactNode {
  React.useEffect(() => {
    const id = setTimeout(onReady, 0)
    return () => clearTimeout(id)
  }, [onReady])

  if (!skill) {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text bold color="yellow">{'◆ Distill Skill'}</Text>
        <Box flexDirection="column" marginLeft={2}>
          <Text dimColor>{'No distillable pattern found in the most recent session.'}</Text>
          <Text dimColor>{'This usually means the session was exploratory or too short.'}</Text>
        </Box>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color="green">{'◆ Distilled Skill Candidate'}</Text>
      <Box flexDirection="column" marginLeft={2}>
        <Text bold>{`Name:        ${skill.name}`}</Text>
        <Text>{`Description: ${skill.description}`}</Text>
        <Text>{`Tags:        ${skill.tags.join(', ') || '(none)'}`}</Text>
        <Text>{''}</Text>
        <Text bold>{'Instructions:'}</Text>
        {skill.instructions.split('\n').map((line, i) => (
          <Text key={i} dimColor>{`  ${line}`}</Text>
        ))}
      </Box>
      <Box marginTop={1} marginLeft={2}>
        <Text dimColor>{'Save with /skills, or copy the instructions elsewhere.'}</Text>
      </Box>
    </Box>
  )
}

export const call: LocalJSXCommandCall = async (onDone) => {
  const skill = await distillRecentSessionToSkill()
  return <DistillResult skill={skill} onReady={() => onDone(undefined)} />
}
