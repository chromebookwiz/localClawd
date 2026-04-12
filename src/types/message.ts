type ContentPart = {
  type: string
  text?: string
  name?: string
  id?: string
  tool_use_id?: string
  [key: string]: unknown
}

type ChatPayload = {
  role: 'user' | 'assistant' | 'system'
  content: string | ContentPart[]
  id?: string
  model?: string
  stop_reason?: string | null
  [key: string]: unknown
}

type BaseMessage = {
  uuid?: string
  timestamp?: string
  toolUseID?: string
  parentToolUseID?: string
  sessionId?: string
  isMeta?: boolean
  isVisibleInTranscriptOnly?: boolean
  [key: string]: unknown
}

export type MessageOrigin =
  | 'user'
  | 'assistant'
  | 'system'
  | 'attachment'
  | 'tool'
  | 'local'
  | 'remote'

export type UserMessage = BaseMessage & {
  type: 'user'
  message: ChatPayload & { role: 'user' }
  toolUseResult?: unknown
  mcpMeta?: unknown
}

export type AssistantMessage = BaseMessage & {
  type: 'assistant'
  message: ChatPayload & { role: 'assistant' }
}

export type AttachmentMessage = BaseMessage & {
  type: 'attachment'
  attachment: {
    type: string
    origin?: MessageOrigin | unknown
    commandMode?: string
    isMeta?: boolean
    [key: string]: unknown
  }
}

export type SystemMessageLevel = 'info' | 'warning' | 'error' | 'success'

export type SystemMessage = BaseMessage & {
  type: 'system'
  subtype?: string
  content?: string
  level?: SystemMessageLevel
}

export type SystemLocalCommandMessage = SystemMessage & {
  subtype: 'local_command'
  commandName?: string
  args?: string[]
  stdout?: string
}

export type ProgressMessage<P = unknown> = BaseMessage & {
  type: 'progress'
  data: P
}

export type TombstoneMessage = BaseMessage & {
  type: 'tombstone'
}

export type RequestStartEvent = BaseMessage & {
  type: 'request_start'
}

export type StreamEvent = BaseMessage & {
  type: string
}

export type StopHookInfo = {
  hookName?: string
  event?: string
  [key: string]: unknown
}

export type PartialCompactDirection = 'before' | 'after' | 'both'

export type SystemAgentsKilledMessage = SystemMessage
export type SystemAPIErrorMessage = SystemMessage & {
  isApiErrorMessage?: boolean
}
export type SystemApiMetricsMessage = SystemMessage
export type SystemAwaySummaryMessage = SystemMessage
export type SystemBridgeStatusMessage = SystemMessage
export type SystemCompactBoundaryMessage = SystemMessage
export type SystemInformationalMessage = SystemMessage
export type SystemMemorySavedMessage = SystemMessage
export type SystemMicrocompactBoundaryMessage = SystemMessage
export type SystemPermissionRetryMessage = SystemMessage
export type SystemScheduledTaskFireMessage = SystemMessage
export type SystemStopHookSummaryMessage = SystemMessage
export type SystemTurnDurationMessage = SystemMessage
export type ToolUseSummaryMessage = SystemMessage

export type NormalizedUserMessage = UserMessage
export type NormalizedAssistantMessage = AssistantMessage
export type NormalizedMessage = Message

export type Message =
  | UserMessage
  | AssistantMessage
  | AttachmentMessage
  | SystemMessage
  | ProgressMessage
  | TombstoneMessage

export type RenderableMessage = Exclude<Message, ProgressMessage>
