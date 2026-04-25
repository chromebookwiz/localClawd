/**
 * /skills-import <path>
 *
 * Reads a markdown skill file (with YAML frontmatter) and writes it to
 * ~/.claude/skills/<name>.md.
 */

import * as React from 'react'
import { Box, Text } from '../../ink.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import { importSkill } from '../../services/skills/skillPortable.js'
import { resolve } from 'path'
import { getOriginalCwd } from '../../bootstrap/state.js'

function Result({
  lines, color, onReady,
}: {
  lines: string[]
  color: string
  onReady: () => void
}): React.ReactNode {
  React.useEffect(() => {
    const id = setTimeout(onReady, 0)
    return () => clearTimeout(id)
  }, [onReady])

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color={color}>{'◆ Skills Import'}</Text>
      <Box flexDirection="column" marginLeft={2}>
        {lines.map((line, i) => (
          <Text key={i} dimColor={line.startsWith('  ')}>{line}</Text>
        ))}
      </Box>
    </Box>
  )
}

export const call: LocalJSXCommandCall = async (onDone, _ctx, args) => {
  const input = (args ?? '').trim()
  if (!input) {
    return (
      <Result
        lines={['Usage: /skills-import <path-to-md-file>']}
        color="yellow"
        onReady={() => onDone(undefined)}
      />
    )
  }

  const filePath = resolve(getOriginalCwd(), input)
  const result = await importSkill(filePath)
  if (!result.ok) {
    return <Result lines={[result.error]} color="red" onReady={() => onDone(undefined)} />
  }

  return (
    <Result
      lines={[
        `Imported skill "${result.name}"`,
        `  → ${result.path}`,
        '',
        'Use it via /skills or invoke directly with the skill name.',
      ]}
      color="green"
      onReady={() => onDone(undefined)}
    />
  )
}
