/**
 * Telegram Agent — a separate, lightweight agent that owns the Telegram
 * conversation. It always replies to the user and may optionally steer or
 * prompt the main agent (which is doing the actual coding work).
 *
 * Context separation: history is stored in this module + persisted to
 * ~/.claude/telegram/history.json. It does NOT share context with the
 * main agent's transcript.
 *
 * Capabilities (decided per-message by the model):
 *   - reply to the user (always)
 *   - PROMPT  → enqueue a new task for the main agent (priority 'next')
 *   - STEER   → interrupt the main agent with new instructions (priority 'now')
 *   - none    → just chat / answer status questions
 */

import { logForDebugging } from '../../utils/debug.js'
import {
  getLocalLLMBaseUrl,
  getLocalLLMApiKey,
  getLocalLLMModel,
} from '../../utils/model/providers.js'
import {
  enqueue,
  getCommandQueueLength,
  getCommandQueueSnapshot,
} from '../../utils/messageQueueManager.js'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { homedir } from 'os'
import { join, dirname } from 'path'

const HISTORY_LIMIT = 24
const HISTORY_FILE = join(homedir(), '.claude', 'telegram', 'history.json')

type Turn = { role: 'user' | 'assistant'; content: string }

let _history: Turn[] = []
let _historyLoaded = false
let _activityLog: string[] = []

export function recordMainAgentActivity(line: string): void {
  if (!line.trim()) return
  _activityLog.push(line.trim().slice(0, 200))
  if (_activityLog.length > 8) _activityLog = _activityLog.slice(-8)
}

async function loadHistory(): Promise<void> {
  if (_historyLoaded) return
  _historyLoaded = true
  try {
    const raw = await readFile(HISTORY_FILE, 'utf-8')
    const parsed = JSON.parse(raw) as Turn[]
    if (Array.isArray(parsed)) _history = parsed.slice(-HISTORY_LIMIT)
  } catch {
    /* no prior history — fine */
  }
}

async function persistHistory(): Promise<void> {
  try {
    await mkdir(dirname(HISTORY_FILE), { recursive: true })
    await writeFile(HISTORY_FILE, JSON.stringify(_history.slice(-HISTORY_LIMIT)), 'utf-8')
  } catch (e) {
    logForDebugging(`[telegram-agent] persist history failed: ${e}`, { level: 'warn' })
  }
}

function buildSystemPrompt(): string {
  const queueLen = getCommandQueueLength()
  const queueSnap = getCommandQueueSnapshot()
  const queuePreview = queueSnap
    .slice(0, 3)
    .map(q => `- ${(q.value ?? '').slice(0, 80)}`)
    .join('\n') || '  (none)'
  const recent = _activityLog.length > 0 ? _activityLog.slice(-5).join('\n') : '(no recent updates)'

  return [
    'You are the Telegram assistant for localclawd, a local-first coding agent.',
    '',
    'You are a SEPARATE agent from the MAIN agent. The MAIN agent runs in the user\'s',
    'terminal and does the actual coding. Your job is to chat with the user over Telegram',
    'and, when appropriate, forward instructions to the MAIN agent.',
    '',
    'Capabilities — decide which to use for THIS message:',
    '  • reply: always required; brief, conversational, helpful',
    '  • action=prompt: enqueue a NEW task for the main agent (it picks it up after current work)',
    '  • action=steer:  INTERRUPT the main agent with urgent new instructions (use sparingly)',
    '  • action=none:   just chat — questions, status checks, acknowledgements',
    '',
    'Rules:',
    '  • Always reply to the user, even if you also enqueue/steer.',
    '  • If the user asks "what are you working on" or "status", answer from the snapshot below.',
    '  • If the user gives a coding task, default to action=prompt.',
    '  • If the user says "stop", "wait", "actually do X instead", use action=steer.',
    '  • If the user is just chatting / clarifying, action=none.',
    '',
    'Strict output format (no extra text outside these tags):',
    '<reply>',
    'your reply to the user — short, no markdown headers',
    '</reply>',
    '<action type="prompt|steer|none">',
    'exact instruction text for the main agent (omit body when type=none)',
    '</action>',
    '',
    '────── MAIN AGENT SNAPSHOT ──────',
    `Queued tasks: ${queueLen}`,
    queuePreview,
    '',
    'Recent activity:',
    recent,
    '─────────────────────────────────',
  ].join('\n')
}

async function callLLM(systemPrompt: string, history: Turn[]): Promise<string | null> {
  try {
    const baseUrl = getLocalLLMBaseUrl()
    const model = getLocalLLMModel()
    const apiKey = getLocalLLMApiKey()
    if (!baseUrl || !model) return null

    const messages = [
      { role: 'system', content: systemPrompt },
      ...history.slice(-HISTORY_LIMIT),
    ]
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: 500,
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(60_000),
    })
    if (!res.ok) {
      logForDebugging(`[telegram-agent] LLM HTTP ${res.status}`, { level: 'warn' })
      return null
    }
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
    return data.choices?.[0]?.message?.content ?? null
  } catch (e) {
    logForDebugging(`[telegram-agent] LLM call failed: ${e}`, { level: 'warn' })
    return null
  }
}

type ParsedResponse = {
  reply: string
  actionType: 'prompt' | 'steer' | 'none'
  actionText: string
}

function parseResponse(raw: string): ParsedResponse {
  const replyMatch = raw.match(/<reply>([\s\S]*?)<\/reply>/i)
  const actionMatch = raw.match(/<action\s+type="(prompt|steer|none)"\s*>([\s\S]*?)<\/action>/i)

  const reply = (replyMatch?.[1] ?? raw).trim()
  const actionType = (actionMatch?.[1] ?? 'none') as 'prompt' | 'steer' | 'none'
  const actionText = (actionMatch?.[2] ?? '').trim()

  return { reply, actionType, actionText }
}

/**
 * Main entry point — handle a Telegram user message.
 * Returns the reply text to send back to Telegram, and performs any
 * side-effect (enqueue / steer) on the main agent's queue.
 */
export async function respondToTelegramMessage(userText: string): Promise<{
  reply: string
  action: { type: 'prompt' | 'steer' | 'none'; text: string }
}> {
  await loadHistory()

  _history.push({ role: 'user', content: userText })

  const systemPrompt = buildSystemPrompt()
  const raw = await callLLM(systemPrompt, _history)

  if (!raw) {
    const fallback = 'I couldn\'t reach the model. Forwarding your message to the main agent.'
    _history.push({ role: 'assistant', content: fallback })
    await persistHistory()
    enqueue({ value: userText, mode: 'prompt', priority: 'next' })
    return { reply: fallback, action: { type: 'prompt', text: userText } }
  }

  const parsed = parseResponse(raw)
  _history.push({ role: 'assistant', content: raw })
  if (_history.length > HISTORY_LIMIT) _history = _history.slice(-HISTORY_LIMIT)
  await persistHistory()

  if (parsed.actionType === 'prompt' && parsed.actionText) {
    enqueue({ value: parsed.actionText, mode: 'prompt', priority: 'next' })
  } else if (parsed.actionType === 'steer' && parsed.actionText) {
    enqueue({ value: parsed.actionText, mode: 'prompt', priority: 'now' })
  }

  return {
    reply: parsed.reply || 'Got it.',
    action: { type: parsed.actionType, text: parsed.actionText },
  }
}

export function clearTelegramHistory(): void {
  _history = []
  void persistHistory()
}
