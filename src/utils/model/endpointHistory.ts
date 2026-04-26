/**
 * Endpoint history — remembers URLs the user has entered so they don't
 * have to retype them. Stored at ~/.localclawd/endpoints.json.
 */

import { mkdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { getClaudeConfigHomeDir } from '../envUtils.js'

const HISTORY_PATH = join(getClaudeConfigHomeDir(), 'endpoints.json')
const MAX_ENTRIES = 10

export interface EndpointHistoryEntry {
  url: string
  provider: string
  lastUsed: number
}

interface HistoryFile {
  version: 1
  entries: EndpointHistoryEntry[]
}

export async function loadEndpointHistory(): Promise<EndpointHistoryEntry[]> {
  try {
    const raw = await readFile(HISTORY_PATH, 'utf-8')
    const parsed = JSON.parse(raw) as HistoryFile
    if (parsed.version !== 1) return []
    return parsed.entries ?? []
  } catch {
    return []
  }
}

export async function recordEndpointUse(
  url: string,
  provider: string,
): Promise<void> {
  try {
    const existing = await loadEndpointHistory()
    const filtered = existing.filter(e => e.url !== url)
    filtered.unshift({ url, provider, lastUsed: Date.now() })
    const capped = filtered.slice(0, MAX_ENTRIES)
    await mkdir(getClaudeConfigHomeDir(), { recursive: true })
    await writeFile(
      HISTORY_PATH,
      JSON.stringify({ version: 1, entries: capped }, null, 2),
      'utf-8',
    )
  } catch {
    // Best-effort — don't break setup if history write fails
  }
}

/** Common presets to suggest when the user has no history yet. */
export function commonPresetsForProvider(provider: string): string[] {
  switch (provider) {
    case 'vllm':
      return [
        'http://127.0.0.1:8000/v1',
        'http://localhost:8000/v1',
        'http://<hostname>.local:8000/v1',
      ]
    case 'ollama':
      return [
        'http://127.0.0.1:11434/v1',
        'http://localhost:11434/v1',
        'http://<hostname>.local:11434/v1',
      ]
    case 'openai':
      return [
        'https://api.openai.com/v1',
        'https://api.groq.com/openai/v1',
        'https://openrouter.ai/api/v1',
      ]
    default:
      return []
  }
}
