/**
 * /skills-export <name> [dest-dir]
 *
 * Writes ~/.claude/skills/<name>.md to <dest-dir>/<name>.md as a
 * portable, agentskills.io-compatible markdown file.
 */

import * as React from 'react'
import { Box, Text } from '../../ink.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import { exportSkill, listSkills } from '../../services/skills/skillPortable.js'
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
      <Text bold color={color}>{'◆ Skills Export'}</Text>
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
    const skills = await listSkills()
    const lines: string[] = ['Usage: /skills-export <name> [dest-dir]', '']
    if (skills.length > 0) {
      lines.push('Available skills:')
      for (const s of skills.slice(0, 20)) lines.push(`  ${s}`)
    } else {
      lines.push('No user skills found at ~/.claude/skills/')
    }
    return <Result lines={lines} color="yellow" onReady={() => onDone(undefined)} />
  }

  const parts = input.split(/\s+/)
  const name = parts[0]!
  const destDir = parts[1] ?? getOriginalCwd()

  const result = await exportSkill(name, destDir)
  if (!result.ok) {
    return (
      <Result
        lines={[result.error]}
        color="red"
        onReady={() => onDone(undefined)}
      />
    )
  }

  return (
    <Result
      lines={[
        `Exported skill "${name}"`,
        `  → ${result.path}`,
        '',
        'Move this file to another machine and run /skills-import <file> to load it.',
      ]}
      color="green"
      onReady={() => onDone(undefined)}
    />
  )
}
