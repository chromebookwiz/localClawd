import type { Message } from './message.js'

export type ShellProgress = {
  type: 'bash_progress' | 'powershell_progress'
  output: string
  fullOutput: string
  elapsedTimeSeconds?: number
  totalLines?: number
  totalBytes?: number
  timeoutMs?: number
  taskId?: string
  [key: string]: unknown
}

export type BashProgress = ShellProgress & {
  type: 'bash_progress'
}

export type PowerShellProgress = ShellProgress & {
  type: 'powershell_progress'
}

export type AgentToolProgress = {
  type: 'agent_progress'
  message: Message
  prompt?: string
  [key: string]: unknown
}

export type SkillToolProgress = {
  type: 'skill_progress'
  message: Message
  prompt?: string
  [key: string]: unknown
}

export type MCPProgress = {
  type: 'mcp_progress'
  message?: string
  serverName?: string
  toolName?: string
  [key: string]: unknown
}

export type REPLToolProgress = {
  type: 'repl_progress'
  message?: string
  [key: string]: unknown
}

export type TaskOutputProgress = {
  type: 'task_output_progress'
  taskId?: string
  content?: string
  [key: string]: unknown
}

export type WebSearchProgress = {
  type: 'web_search_progress'
  message?: string
  query?: string
  urls?: string[]
  [key: string]: unknown
}

export type SdkWorkflowProgress = {
  kind?: string
  status?: string
  [key: string]: unknown
}

export type ToolProgressData =
  | AgentToolProgress
  | BashProgress
  | MCPProgress
  | PowerShellProgress
  | REPLToolProgress
  | SkillToolProgress
  | TaskOutputProgress
  | WebSearchProgress
  | ({ type: string } & Record<string, unknown>)
