import { join, normalize, sep } from 'path'
import {
  buildMemoryPrompt,
  ensureMemoryDirExists,
} from '../../memdir/memdir.js'
import { getProjectMemoryBaseDir } from '../../memdir/paths.js'

export type AgentMemoryScope = 'project'

function sanitizeAgentTypeForPath(agentType: string): string {
  return agentType.replace(/:/g, '-')
}

export function getAgentMemoryDir(
  agentType: string,
  _scope: AgentMemoryScope,
): string {
  const dirName = sanitizeAgentTypeForPath(agentType)
  return join(getProjectMemoryBaseDir(), 'agent-memory', dirName) + sep
}

export function isAgentMemoryPath(absolutePath: string): boolean {
  const normalizedPath = normalize(absolutePath)
  return normalizedPath.startsWith(join(getProjectMemoryBaseDir(), 'agent-memory') + sep)
}

export function getAgentMemoryEntrypoint(
  agentType: string,
  scope: AgentMemoryScope,
): string {
  return join(getAgentMemoryDir(agentType, scope), 'MEMORY.md')
}

export function getMemoryScopeDisplay(
  memory: AgentMemoryScope | undefined,
): string {
  switch (memory) {
    case 'project':
      return 'Project (.localclawd/agent-memory/)'
    default:
      return 'None'
  }
}

export function loadAgentMemoryPrompt(
  agentType: string,
  scope: AgentMemoryScope,
): string {
  const memoryDir = getAgentMemoryDir(agentType, scope)
  void ensureMemoryDirExists(memoryDir)

  return buildMemoryPrompt({
    displayName: 'Persistent Agent Memory',
    memoryDir,
    extraGuidelines: [
      '- This memory is project-scoped. Tailor memories to this project and keep them in the project .localclawd directory.',
    ],
  })
}
