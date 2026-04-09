import { join } from 'path'
import { fileURLToPath } from 'url'
import { buildMcpToolName } from '../../services/mcp/mcpStringUtils.js'
import type { ScopedMcpServerConfig } from '../../services/mcp/types.js'

import { isInBundledMode } from '../bundledMode.js'
import { CLI_CU_CAPABILITIES, COMPUTER_USE_MCP_SERVER_NAME } from './common.js'
import { getChicagoCoordinateMode } from './gates.js'

type ComputerUseToolDefinition = {
  name: string
}

type BuildComputerUseToolsFn = (
  capabilities: typeof CLI_CU_CAPABILITIES,
  coordinateMode: ReturnType<typeof getChicagoCoordinateMode>,
) => ComputerUseToolDefinition[]

function getBuildComputerUseTools(): BuildComputerUseToolsFn | null {
  try {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const mod = require('@ant/computer-use-mcp') as {
      buildComputerUseTools?: BuildComputerUseToolsFn
    }
    /* eslint-enable @typescript-eslint/no-require-imports */
    return mod.buildComputerUseTools ?? null
  } catch {
    return null
  }
}

export function isComputerUseSupported(): boolean {
  return getBuildComputerUseTools() !== null
}

/**
 * Build the dynamic MCP config + allowed tool names. Mirror of
 * `setupClaudeInChrome`. The `mcp__computer-use__*` tools are added to
 * `allowedTools` so they bypass the normal permission prompt — the package's
 * `request_access` handles approval for the whole session.
 *
 * The MCP layer isn't ceremony: the API backend detects `mcp__computer-use__*`
 * tool names and emits a CU availability hint into the system prompt
 * (COMPUTER_USE_MCP_AVAILABILITY_HINT in the anthropic repo). Built-in tools
 * with different names wouldn't trigger it. Cowork uses the same names for the
 * same reason (apps/desktop/src/main/local-agent-mode/systemPrompt.ts:314).
 */
export function setupComputerUseMCP(): {
  mcpConfig: Record<string, ScopedMcpServerConfig>
  allowedTools: string[]
} {
  const buildComputerUseTools = getBuildComputerUseTools()
  if (!buildComputerUseTools) {
    throw new Error(
      'Computer Use MCP is unavailable in this build because computer-use support is not installed.',
    )
  }

  const allowedTools = buildComputerUseTools(
    CLI_CU_CAPABILITIES,
    getChicagoCoordinateMode(),
  ).map(t => buildMcpToolName(COMPUTER_USE_MCP_SERVER_NAME, t.name))

  // command/args are never spawned — client.ts intercepts by name and
  // uses the in-process server. The config just needs to exist with
  // type 'stdio' to hit the right branch. Mirrors Chrome's setup.
  const args = isInBundledMode()
    ? ['--computer-use-mcp']
    : [
        join(fileURLToPath(import.meta.url), '..', 'cli.js'),
        '--computer-use-mcp',
      ]

  return {
    mcpConfig: {
      [COMPUTER_USE_MCP_SERVER_NAME]: {
        type: 'stdio',
        command: process.execPath,
        args,
        scope: 'dynamic',
      } as const,
    },
    allowedTools,
  }
}
