/**
 * /hermes — show the localclawd feature map.
 *
 * Combines what was shipped (inspired by Hermes / Nous Research and
 * openclawd) with what's still on the roadmap, so users can see the
 * gap at a glance.
 */

import * as React from 'react'
import { Box, Text } from '../../ink.js'
import type { LocalJSXCommandCall } from '../../types/command.js'

const SHIPPED: Array<[string, string]> = [
  ['TUI', 'multiline editing, slash-command autocomplete, streaming tool output'],
  ['Persistent project memory', 'per-project state, key-file index, task history'],
  ['Self-curated memory lattice', 'tag-scored recall across projects'],
  ['Chat bridges', 'Telegram + Slack + Discord (polling, no webhooks)'],
  ['Scheduled automations', '/schedule cron-like prompts, delivered to any bridge'],
  ['Session search', '/sessionsearch term-scored recall across all past conversations'],
  ['Subagent delegation', 'Agent tool spawns isolated subagents in parallel'],
  ['Keepgoing loop', '/keepgoing autonomous multi-round work with stop signals'],
  ['Thinkharder pipeline', '/thinkharder 5-phase verification loop'],
  ['Skills system', '/skills create, load, and invoke reusable capabilities'],
  ['Interactive setup', '/telegram /slack /discord all use a 4-step wizard'],
  ['/stop /kill from any bridge', 'Halt or terminate from phone/chat'],
  ['Local-endpoint backends', 'vLLM, Ollama, LM Studio, any OpenAI-compatible URL'],
  ['No telemetry', 'Analytics + feature flags + 1P event logging all no-op'],
]

const ROADMAP: Array<[string, string]> = [
  ['WhatsApp bridge', 'needs Twilio or WhatsApp Web scraping — paid/fragile'],
  ['Signal bridge', 'needs signal-cli daemon installed locally'],
  ['Voice memo transcription', 'Whisper/STT integration for Telegram/Slack/Discord voice'],
  ['Docker backend', 'run the agent in an isolated container'],
  ['SSH backend', 'drive a remote machine from the local TUI'],
  ['Daytona backend', 'serverless-persistent cloud environment'],
  ['Modal backend', 'wake-on-demand GPU sandboxes'],
  ['Singularity backend', 'HPC container runtime'],
  ['FTS5 session search', 'upgrade /sessionsearch to node:sqlite + full-text index'],
  ['LLM session summarization', 'auto-summarize old sessions into recall index'],
  ['Honcho user modeling', 'dialectic user-state model across sessions'],
  ['Skill self-improvement loop', 'skills observe + edit themselves after each use'],
  ['agentskills.io compat', 'import/export skills in the open-standard format'],
  ['Atropos RL environments', 'trajectory generation for fine-tuning'],
  ['Trajectory compression', 'dataset-ready compression of tool-calling traces'],
  ['Python RPC tool bridge', 'call agent tools from scripts without burning context'],
]

function FeatureList({
  title,
  items,
  color,
}: {
  title: string
  items: Array<[string, string]>
  color: string
}): React.ReactNode {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color={color}>{title}</Text>
      <Box flexDirection="column" marginLeft={2}>
        {items.map(([name, desc], i) => (
          <Box key={i}>
            <Text color={color}>{`  ${name.padEnd(30)}`}</Text>
            <Text dimColor>{desc}</Text>
          </Box>
        ))}
      </Box>
    </Box>
  )
}

function HermesView({ onReady }: { onReady: () => void }): React.ReactNode {
  React.useEffect(() => {
    const id = setTimeout(onReady, 0)
    return () => clearTimeout(id)
  }, [onReady])

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color="#a78bfa">{'◆ localclawd — feature map'}</Text>
      <Text dimColor>
        {'A blend of the upstream coding CLI, openclawd, and ideas from Nous Research\'s Hermes agent.'}
      </Text>
      <FeatureList title="Shipped" items={SHIPPED} color="green" />
      <FeatureList title="Roadmap" items={ROADMAP} color="yellow" />
      <Box marginTop={1}>
        <Text dimColor>
          {'Character file: SOUL.md at the repo root. /hermes to see this map again.'}
        </Text>
      </Box>
    </Box>
  )
}

export const call: LocalJSXCommandCall = async (onDone) => {
  return <HermesView onReady={() => onDone(undefined)} />
}
