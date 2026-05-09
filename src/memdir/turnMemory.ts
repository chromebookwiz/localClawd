import { randomUUID } from 'crypto'
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'fs/promises'
import { basename, dirname, join, relative } from 'path'
import type { AssistantMessage, Message, UserMessage } from '../types/message.js'
import { getUserMessageText } from '../utils/messages.js'
import { getAutoMemPath, getProjectMemoryConfigPath, isAutoMemoryEnabled } from './paths.js'
import { findRelevantMemories } from './findRelevantMemories.js'
import { scanMemoryFiles } from './memoryScan.js'

const TURN_MEMORY_DIR = 'turns'
const MAX_FIELD_CHARS = 2000
const MAX_SUMMARY_CHARS = 260
const MAX_SEARCH_RESULTS = 8

type MemoryConfig = {
  enabled: boolean
}

export type TurnMemorySaveResult = {
  path: string
}

function truncate(text: string, maxChars: number): string {
  const cleaned = text.replace(/\s+/g, ' ').trim()
  if (cleaned.length <= maxChars) return cleaned
  return `${cleaned.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`
}

function yamlQuote(text: string): string {
  return JSON.stringify(text.replace(/\r?\n/g, ' '))
}

function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return slug || 'turn'
}

function extractAssistantText(messages: readonly AssistantMessage[]): string {
  return messages
    .flatMap(message => {
      const content = message.message.content
      if (typeof content === 'string') return [content]
      return content
        .filter(block => block.type === 'text' && typeof block.text === 'string')
        .map(block => block.text)
    })
    .join('\n')
    .trim()
}

function latestUserText(messages: readonly Message[]): string {
  const user = messages.findLast(
    (message): message is UserMessage => message.type === 'user' && !message.isMeta,
  )
  return user ? (getUserMessageText(user) ?? '') : ''
}

function tagsFor(text: string): string[] {
  const stop = new Set([
    'about',
    'after',
    'again',
    'also',
    'because',
    'before',
    'being',
    'could',
    'doing',
    'from',
    'have',
    'into',
    'just',
    'localclawd',
    'make',
    'only',
    'should',
    'that',
    'the',
    'their',
    'there',
    'this',
    'turn',
    'what',
    'when',
    'with',
    'would',
  ])
  const counts = new Map<string, number>()
  for (const raw of text.toLowerCase().match(/[a-z0-9][a-z0-9_-]{2,}/g) ?? []) {
    if (stop.has(raw)) continue
    counts.set(raw, (counts.get(raw) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 12)
    .map(([tag]) => tag)
}

async function writeConfig(config: MemoryConfig): Promise<void> {
  const configPath = getProjectMemoryConfigPath()
  await mkdir(dirname(configPath), { recursive: true })
  await writeFile(
    configPath,
    `${JSON.stringify({ ...config, updatedAt: new Date().toISOString() }, null, 2)}\n`,
    'utf8',
  )
}

export async function setProjectMemoryEnabled(enabled: boolean): Promise<void> {
  await writeConfig({ enabled })
}

export async function clearProjectMemory(): Promise<void> {
  const memoryDir = getAutoMemPath()
  const configPath = getProjectMemoryConfigPath()
  let config: MemoryConfig = { enabled: true }
  try {
    config = JSON.parse(await readFile(configPath, 'utf8')) as MemoryConfig
  } catch {
    // Missing or malformed config should not block clearing memories.
  }
  await rm(memoryDir, { recursive: true, force: true })
  await writeConfig({ enabled: config.enabled !== false })
}

export async function getProjectMemoryStatus(): Promise<{
  enabled: boolean
  memoryDir: string
  fileCount: number
  bytes: number
}> {
  const memoryDir = getAutoMemPath()
  let fileCount = 0
  let bytes = 0
  try {
    const entries = await readdir(memoryDir, { recursive: true })
    await Promise.all(
      entries.map(async entry => {
        const path = join(memoryDir, entry)
        const info = await stat(path).catch(() => null)
        if (!info?.isFile()) return
        fileCount++
        bytes += info.size
      }),
    )
  } catch {
    // Empty or missing memory directory.
  }
  return {
    enabled: isAutoMemoryEnabled(),
    memoryDir,
    fileCount,
    bytes,
  }
}

export async function saveTurnMemory(params: {
  messagesForQuery: readonly Message[]
  assistantMessages: readonly AssistantMessage[]
  summary: string
  querySource: string
  agentId?: string
}): Promise<TurnMemorySaveResult | null> {
  if (!isAutoMemoryEnabled() || params.agentId) {
    return null
  }
  if (
    params.querySource !== 'sdk' &&
    !params.querySource.startsWith('repl_main_thread')
  ) {
    return null
  }

  const userText = truncate(latestUserText(params.messagesForQuery), MAX_FIELD_CHARS)
  const assistantText = truncate(extractAssistantText(params.assistantMessages), MAX_FIELD_CHARS)
  const summary = truncate(params.summary || assistantText, MAX_SUMMARY_CHARS)
  if (!userText && !assistantText) {
    return null
  }

  const now = new Date()
  const iso = now.toISOString()
  const id = `${iso.replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`
  const tags = tagsFor(`${userText} ${assistantText} ${summary}`)
  const filename = `${id}-${slugify(summary)}.md`
  const dir = join(getAutoMemPath(), TURN_MEMORY_DIR)
  const path = join(dir, filename)
  const description = summary
  const frontmatter = [
    '---',
    `name: ${yamlQuote(`Turn ${iso}`)}`,
    `description: ${yamlQuote(description)}`,
    'type: project',
    tags.length > 0 ? `tags: [${tags.map(yamlQuote).join(', ')}]` : 'tags: []',
    '---',
    '',
  ].join('\n')
  const body = [
    `# Turn Memory: ${iso}`,
    '',
    '## User Request',
    userText || '(No user text captured.)',
    '',
    '## What Was Done',
    assistantText || summary,
    '',
  ].join('\n')

  await mkdir(dir, { recursive: true })
  await writeFile(path, `${frontmatter}${body}`, 'utf8')
  return { path }
}

export async function searchProjectMemory(query: string): Promise<string[]> {
  const controller = new AbortController()
  const memoryDir = getAutoMemPath()
  const relevant = await findRelevantMemories(query, memoryDir, controller.signal)
  const selected =
    relevant.length > 0
      ? relevant.slice(0, MAX_SEARCH_RESULTS)
      : (await scanMemoryFiles(memoryDir, controller.signal)).slice(0, MAX_SEARCH_RESULTS).map(
          memory => ({ path: memory.filePath, mtimeMs: memory.mtimeMs }),
        )

  return Promise.all(
    selected.map(async item => {
      const content = await readFile(item.path, 'utf8').catch(() => '')
      const title = basename(item.path)
      const rel = relative(memoryDir, item.path)
      const summary = content
        .split('\n')
        .filter(line => line.trim() && !line.startsWith('---') && !line.includes(': '))
        .slice(0, 4)
        .join(' ')
      return `${rel || title}: ${truncate(summary, 240)}`
    }),
  )
}
