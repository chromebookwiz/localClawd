import { randomUUID } from 'crypto'
import type { ClientOptions } from '@anthropic-ai/sdk'
import {
  getLocalLLMApiKey,
  getLocalLLMBaseUrl,
  getLocalLLMModel,
  getLocalLLMProvider,
  isLocalLLMProviderEnabled,
} from '../../utils/model/providers.js'

type AnthropicTextBlock = {
  type: 'text'
  text: string
}

type AnthropicToolUseBlock = {
  type: 'tool_use'
  id?: string
  name: string
  input?: unknown
}

type AnthropicToolResultBlock = {
  type: 'tool_result'
  tool_use_id: string
  content?: unknown
  is_error?: boolean
}

type AnthropicContentBlock =
  | AnthropicTextBlock
  | AnthropicToolUseBlock
  | AnthropicToolResultBlock
  | Record<string, unknown>

type AnthropicMessage = {
  role: 'user' | 'assistant'
  content: string | AnthropicContentBlock[]
}

type AnthropicRequest = {
  model?: string
  messages?: AnthropicMessage[]
  system?: string | Array<{ type?: string; text?: string }>
  tools?: Array<{
    name: string
    description?: string
    input_schema?: Record<string, unknown>
  }>
  tool_choice?:
    | { type: 'auto' | 'any' }
    | { type: 'tool'; name: string }
    | Record<string, unknown>
  max_tokens?: number
  temperature?: number
  stop_sequences?: string[]
  stream?: boolean
  output_config?: {
    format?: {
      type?: string
      schema?: Record<string, unknown>
    }
  }
}

type OpenAIChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: string | null
  tool_calls?: OpenAIToolCall[]
  tool_call_id?: string
}

type OpenAIToolCall = {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

type OpenAIChatRequest = {
  model: string
  messages: OpenAIChatMessage[]
  max_tokens?: number
  temperature?: number
  stop?: string[]
  stream?: boolean
  stream_options?: {
    include_usage?: boolean
  }
  tools?: Array<{
    type: 'function'
    function: {
      name: string
      description?: string
      parameters?: Record<string, unknown>
    }
  }>
  tool_choice?:
    | 'auto'
    | 'required'
    | {
        type: 'function'
        function: { name: string }
      }
  response_format?:
    | { type: 'json_object' }
    | {
        type: 'json_schema'
        json_schema: {
          name: string
          strict: boolean
          schema: Record<string, unknown>
        }
      }
}

type OpenAIChatResponse = {
  id?: string
  model?: string
  choices?: Array<{
    message?: {
      content?: string | null
      tool_calls?: OpenAIToolCall[]
    }
    finish_reason?: string | null
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
}

type OpenAIStreamChunk = {
  id?: string
  model?: string
  choices?: Array<{
    index?: number
    delta?: {
      content?: string
      tool_calls?: Array<{
        index?: number
        id?: string
        type?: 'function'
        function?: {
          name?: string
          arguments?: string
        }
      }>
    }
    finish_reason?: string | null
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
}

const encoder = new TextEncoder()

function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`
}

function joinText(parts: string[]): string {
  return parts.filter(Boolean).join('\n\n').trim()
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }
  if (value == null) {
    return ''
  }
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function flattenToolResultContent(content: unknown): string {
  if (typeof content === 'string') {
    return content
  }
  if (!Array.isArray(content)) {
    return stringifyUnknown(content)
  }
  return content
    .map(block => {
      if (!block || typeof block !== 'object') {
        return stringifyUnknown(block)
      }
      const typedBlock = block as Record<string, unknown>
      if (typedBlock.type === 'text' && typeof typedBlock.text === 'string') {
        return typedBlock.text
      }
      return stringifyUnknown(block)
    })
    .filter(Boolean)
    .join('\n')
}

function anthropicBlockToText(block: AnthropicContentBlock): string {
  if ((block as AnthropicTextBlock).type === 'text') {
    return (block as AnthropicTextBlock).text
  }
  return stringifyUnknown(block)
}

function systemToString(system: AnthropicRequest['system']): string {
  if (typeof system === 'string') {
    return system
  }
  if (!Array.isArray(system)) {
    return ''
  }
  return joinText(
    system
      .map(block => (block.type === 'text' && block.text ? block.text : ''))
      .filter(Boolean),
  )
}

function convertAnthropicMessagesToOpenAI(
  messages: AnthropicMessage[] | undefined,
  system: AnthropicRequest['system'],
): OpenAIChatMessage[] {
  const result: OpenAIChatMessage[] = []
  const systemPrompt = systemToString(system)
  if (systemPrompt) {
    result.push({ role: 'system', content: systemPrompt })
  }
  for (const message of messages ?? []) {
    const contentBlocks = Array.isArray(message.content)
      ? message.content
      : [{ type: 'text', text: message.content }]
    if (message.role === 'assistant') {
      const textParts: string[] = []
      const toolCalls: OpenAIToolCall[] = []
      for (const block of contentBlocks) {
        if ((block as AnthropicToolUseBlock).type === 'tool_use') {
          const toolBlock = block as AnthropicToolUseBlock
          toolCalls.push({
            id: toolBlock.id || randomUUID(),
            type: 'function',
            function: {
              name: toolBlock.name,
              arguments: JSON.stringify(toolBlock.input ?? {}),
            },
          })
          continue
        }
        if ((block as Record<string, unknown>).type === 'thinking') {
          continue
        }
        textParts.push(anthropicBlockToText(block))
      }
      if (textParts.length > 0 || toolCalls.length > 0) {
        result.push({
          role: 'assistant',
          content: textParts.length > 0 ? joinText(textParts) : null,
          ...(toolCalls.length > 0 && { tool_calls: toolCalls }),
        })
      }
      continue
    }

    let pendingUserText: string[] = []
    const flushUserText = () => {
      if (pendingUserText.length === 0) {
        return
      }
      result.push({ role: 'user', content: joinText(pendingUserText) })
      pendingUserText = []
    }

    for (const block of contentBlocks) {
      if ((block as AnthropicToolResultBlock).type === 'tool_result') {
        flushUserText()
        const toolResult = block as AnthropicToolResultBlock
        result.push({
          role: 'tool',
          tool_call_id: toolResult.tool_use_id,
          content: flattenToolResultContent(toolResult.content),
        })
        continue
      }
      pendingUserText.push(anthropicBlockToText(block))
    }
    flushUserText()
  }
  return result
}

function convertTools(
  tools: AnthropicRequest['tools'],
): OpenAIChatRequest['tools'] | undefined {
  if (!tools || tools.length === 0) {
    return undefined
  }
  return tools.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      ...(tool.description ? { description: tool.description } : {}),
      ...(tool.input_schema ? { parameters: tool.input_schema } : {}),
    },
  }))
}

function convertToolChoice(
  toolChoice: AnthropicRequest['tool_choice'],
): OpenAIChatRequest['tool_choice'] {
  if (!toolChoice || typeof toolChoice !== 'object') {
    return 'auto'
  }
  if (toolChoice.type === 'any') {
    return 'required'
  }
  if (toolChoice.type === 'tool' && 'name' in toolChoice) {
    return {
      type: 'function',
      function: { name: String(toolChoice.name) },
    }
  }
  return 'auto'
}

function convertOutputFormat(
  outputConfig: AnthropicRequest['output_config'],
): OpenAIChatRequest['response_format'] | undefined {
  const format = outputConfig?.format
  if (!format || format.type !== 'json_schema' || !format.schema) {
    return undefined
  }
  return {
    type: 'json_schema',
    json_schema: {
      name: 'claude_code_output',
      strict: true,
      schema: format.schema,
    },
  }
}

function convertAnthropicRequest(body: AnthropicRequest): OpenAIChatRequest {
  const model = getLocalLLMModel() || body.model || 'local-model'
  return {
    model,
    messages: convertAnthropicMessagesToOpenAI(body.messages, body.system),
    ...(body.max_tokens ? { max_tokens: body.max_tokens } : {}),
    ...(body.temperature !== undefined ? { temperature: body.temperature } : {}),
    ...(body.stop_sequences?.length ? { stop: body.stop_sequences } : {}),
    ...(body.stream ? { stream: true, stream_options: { include_usage: true } } : {}),
    ...(body.tools?.length ? { tools: convertTools(body.tools) } : {}),
    ...(body.tools?.length ? { tool_choice: convertToolChoice(body.tool_choice) } : {}),
    ...(body.output_config ? { response_format: convertOutputFormat(body.output_config) } : {}),
  }
}

function estimateTokensFromRequest(body: AnthropicRequest): number {
  const serialized = JSON.stringify({
    system: body.system,
    messages: body.messages,
    tools: body.tools,
  })
  return Math.max(1, Math.ceil(serialized.length / 4))
}

function mapFinishReason(reason: string | null | undefined): string | null {
  switch (reason) {
    case 'stop':
      return 'end_turn'
    case 'length':
      return 'max_tokens'
    case 'tool_calls':
      return 'tool_use'
    default:
      return null
  }
}

function toAnthropicUsage(usage: OpenAIChatResponse['usage'] | OpenAIStreamChunk['usage']) {
  return {
    input_tokens: usage?.prompt_tokens ?? 0,
    output_tokens: usage?.completion_tokens ?? 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  }
}

function buildAnthropicMessageFromOpenAI(response: OpenAIChatResponse, model: string) {
  const choice = response.choices?.[0]
  const content: Array<Record<string, unknown>> = []
  const assistantMessage = choice?.message
  if (assistantMessage?.content) {
    content.push({ type: 'text', text: assistantMessage.content })
  }
  for (const toolCall of assistantMessage?.tool_calls ?? []) {
    let parsedArgs: unknown = {}
    try {
      parsedArgs = JSON.parse(toolCall.function.arguments || '{}')
    } catch {
      parsedArgs = toolCall.function.arguments || '{}'
    }
    content.push({
      type: 'tool_use',
      id: toolCall.id,
      name: toolCall.function.name,
      input: parsedArgs,
    })
  }
  return {
    id: response.id || `msg_${randomUUID()}`,
    type: 'message',
    role: 'assistant',
    model,
    content,
    stop_reason: mapFinishReason(choice?.finish_reason),
    stop_sequence: null,
    usage: toAnthropicUsage(response.usage),
  }
}

function parseProviderError(payload: unknown): string {
  if (!payload || typeof payload !== 'object') {
    return 'Local backend request failed'
  }
  const record = payload as Record<string, unknown>
  if (typeof record.error === 'string') {
    return record.error
  }
  if (
    record.error &&
    typeof record.error === 'object' &&
    typeof (record.error as Record<string, unknown>).message === 'string'
  ) {
    return String((record.error as Record<string, unknown>).message)
  }
  if (typeof record.message === 'string') {
    return record.message
  }
  return 'Local backend request failed'
}

async function normalizeErrorResponse(response: Response): Promise<Response> {
  let message = `Local backend request failed with status ${response.status}`
  try {
    const payload = await response.clone().json()
    message = parseProviderError(payload)
  } catch {
    try {
      const text = await response.clone().text()
      if (text.trim()) {
        message = text.trim()
      }
    } catch {
      // ignore body parse failures
    }
  }
  return new Response(
    JSON.stringify({
      type: 'error',
      error: {
        type: 'api_error',
        message,
      },
    }),
    {
      status: response.status,
      headers: {
        'content-type': 'application/json',
        'request-id': response.headers.get('x-request-id') || randomUUID(),
      },
    },
  )
}

function encodeSse(event: string, data: unknown): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

async function* iterateSseEvents(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }
    buffer += decoder.decode(value, { stream: true })
    while (true) {
      const match = /\r?\n\r?\n/.exec(buffer)
      if (!match || match.index === undefined) {
        break
      }
      const boundary = match.index
      const rawEvent = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + match[0].length)
      const dataLines = rawEvent
        .split(/\r?\n/)
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trim())
      if (dataLines.length === 0) {
        continue
      }
      const payload = dataLines.join('\n')
      if (payload === '[DONE]') {
        return
      }
      yield payload
    }
  }
}

function createStreamingResponse(
  upstream: Response,
  model: string,
): Response {
  const requestId = upstream.headers.get('x-request-id') || randomUUID()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const messageId = `msg_${randomUUID()}`
      const contentBlockIndexes = new Map<number, { type: 'text' | 'tool_use' }>()
      let nextIndex = 0
      let finalUsage = toAnthropicUsage(undefined)
      let finalStopReason: string | null = null

      controller.enqueue(
        encodeSse('message_start', {
          type: 'message_start',
          message: {
            id: messageId,
            type: 'message',
            role: 'assistant',
            model,
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: finalUsage,
          },
        }),
      )

      try {
        if (!upstream.body) {
          throw new Error('Local backend stream had no body')
        }

        for await (const rawPayload of iterateSseEvents(upstream.body)) {
          const chunk = JSON.parse(rawPayload) as OpenAIStreamChunk
          if (chunk.usage) {
            finalUsage = toAnthropicUsage(chunk.usage)
          }
          const choice = chunk.choices?.[0]
          if (!choice) {
            continue
          }
          if (choice.delta?.content) {
            let textIndex = [...contentBlockIndexes.entries()].find(
              ([, block]) => block.type === 'text',
            )?.[0]
            if (textIndex === undefined) {
              textIndex = nextIndex++
              contentBlockIndexes.set(textIndex, { type: 'text' })
              controller.enqueue(
                encodeSse('content_block_start', {
                  type: 'content_block_start',
                  index: textIndex,
                  content_block: {
                    type: 'text',
                    text: '',
                  },
                }),
              )
            }
            controller.enqueue(
              encodeSse('content_block_delta', {
                type: 'content_block_delta',
                index: textIndex,
                delta: {
                  type: 'text_delta',
                  text: choice.delta.content,
                },
              }),
            )
          }

          for (const toolCall of choice.delta?.tool_calls ?? []) {
            const toolIndex = toolCall.index ?? nextIndex
            if (!contentBlockIndexes.has(toolIndex)) {
              contentBlockIndexes.set(toolIndex, { type: 'tool_use' })
              nextIndex = Math.max(nextIndex, toolIndex + 1)
              controller.enqueue(
                encodeSse('content_block_start', {
                  type: 'content_block_start',
                  index: toolIndex,
                  content_block: {
                    type: 'tool_use',
                    id: toolCall.id || `toolu_${randomUUID()}`,
                    name: toolCall.function?.name || 'tool',
                    input: {},
                  },
                }),
              )
            }
            if (toolCall.function?.arguments) {
              controller.enqueue(
                encodeSse('content_block_delta', {
                  type: 'content_block_delta',
                  index: toolIndex,
                  delta: {
                    type: 'input_json_delta',
                    partial_json: toolCall.function.arguments,
                  },
                }),
              )
            }
          }

          if (choice.finish_reason) {
            finalStopReason = mapFinishReason(choice.finish_reason)
          }
        }

        for (const [index] of [...contentBlockIndexes.entries()].sort(
          (a, b) => a[0] - b[0],
        )) {
          controller.enqueue(
            encodeSse('content_block_stop', {
              type: 'content_block_stop',
              index,
            }),
          )
        }
        controller.enqueue(
          encodeSse('message_delta', {
            type: 'message_delta',
            delta: {
              stop_reason: finalStopReason,
              stop_sequence: null,
            },
            usage: finalUsage,
          }),
        )
        controller.enqueue(encodeSse('message_stop', { type: 'message_stop' }))
        controller.close()
      } catch (error) {
        controller.error(error)
      }
    },
  })

  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream',
      connection: 'keep-alive',
      'cache-control': 'no-cache',
      'request-id': requestId,
    },
  })
}

function buildProviderHeaders(): HeadersInit {
  const provider = getLocalLLMProvider()
  const apiKey = getLocalLLMApiKey(provider)
  return {
    'content-type': 'application/json',
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  }
}

async function parseAnthropicRequest(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<AnthropicRequest | null> {
  const body = init?.body
  if (typeof body === 'string') {
    return JSON.parse(body) as AnthropicRequest
  }
  if (body instanceof Uint8Array) {
    return JSON.parse(Buffer.from(body).toString('utf8')) as AnthropicRequest
  }
  if (input instanceof Request) {
    const text = await input.clone().text()
    return text ? (JSON.parse(text) as AnthropicRequest) : null
  }
  return null
}

export function buildLocalLLMFetch(
  inner: typeof globalThis.fetch,
): ClientOptions['fetch'] {
  return async (input, init) => {
    if (!isLocalLLMProviderEnabled()) {
      return inner(input, init)
    }

    const url = input instanceof Request ? input.url : String(input)
    const pathname = new URL(url).pathname
    if (
      !pathname.endsWith('/v1/messages') &&
      !pathname.endsWith('/v1/messages/count_tokens')
    ) {
      return inner(input, init)
    }

    const requestBody = await parseAnthropicRequest(input, init)
    if (!requestBody) {
      return new Response(
        JSON.stringify({
          type: 'error',
          error: {
            type: 'invalid_request_error',
            message: 'Missing request body',
          },
        }),
        {
          status: 400,
          headers: {
            'content-type': 'application/json',
            'request-id': randomUUID(),
          },
        },
      )
    }

    if (pathname.endsWith('/v1/messages/count_tokens')) {
      return new Response(
        JSON.stringify({ input_tokens: estimateTokensFromRequest(requestBody) }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'request-id': randomUUID(),
          },
        },
      )
    }

    const openAiRequest = convertAnthropicRequest(requestBody)
    const upstream = await inner(
      `${normalizeBaseUrl(getLocalLLMBaseUrl())}/chat/completions`,
      {
        method: 'POST',
        headers: buildProviderHeaders(),
        body: JSON.stringify(openAiRequest),
        signal: init?.signal,
      },
    )

    if (!upstream.ok) {
      return normalizeErrorResponse(upstream)
    }

    const model = openAiRequest.model
    if (requestBody.stream) {
      return createStreamingResponse(upstream, model)
    }

    const payload = (await upstream.json()) as OpenAIChatResponse
    const anthropicResponse = buildAnthropicMessageFromOpenAI(payload, model)
    return new Response(JSON.stringify(anthropicResponse), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'request-id':
          upstream.headers.get('x-request-id') || payload.id || randomUUID(),
      },
    })
  }
}