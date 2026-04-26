/**
 * Embeddings via the configured local LLM endpoint.
 *
 * Modern OpenAI-compatible servers (vLLM, Ollama, LM Studio,
 * llama.cpp's server, OpenAI proper) expose `/v1/embeddings`. We POST
 * to it and cache the result keyed by sha256(text).
 *
 * Cache lives at ~/.localclawd/embeddings.json (a flat record map; no
 * SQLite needed — this is keyed lookup, not range scan, and we cap
 * at 5000 entries to keep the file under ~50MB).
 *
 * Capability is feature-detected on first use; if the endpoint
 * doesn't support embeddings (404 / model-not-found), we remember
 * that and skip silently. Callers should be ok with `null` returns.
 *
 * Cosine similarity is computed in pure JS — fine for the candidate
 * sets we deal with (top-50 from FTS5 prefilter, not millions).
 */

import { mkdir, readFile, writeFile } from 'fs/promises'
import { createHash } from 'crypto'
import { join } from 'path'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { logForDebugging } from '../../utils/debug.js'
import {
  getLocalLLMBaseUrl,
  getLocalLLMApiKey,
} from '../../utils/model/providers.js'

const CACHE_PATH = join(getClaudeConfigHomeDir(), 'embeddings.json')
const MAX_CACHE_ENTRIES = 5000

interface CacheFile {
  version: 1
  model: string
  vectors: Record<string, number[]>  // sha256 hex → vector
  order: string[]                    // LRU eviction
}

let _cache: CacheFile | null = null
let _capability: 'unknown' | 'available' | 'unavailable' = 'unknown'
let _embeddingModel = ''

// ─── Cache I/O ───────────────────────────────────────────────────────────────

async function loadCache(): Promise<CacheFile> {
  if (_cache) return _cache
  try {
    const raw = await readFile(CACHE_PATH, 'utf-8')
    const parsed = JSON.parse(raw) as CacheFile
    if (parsed.version === 1) { _cache = parsed; return parsed }
  } catch { /* fresh */ }
  _cache = { version: 1, model: '', vectors: {}, order: [] }
  return _cache
}

async function saveCache(cache: CacheFile): Promise<void> {
  await mkdir(getClaudeConfigHomeDir(), { recursive: true })
  await writeFile(CACHE_PATH, JSON.stringify(cache), 'utf-8')
}

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

function evictIfNeeded(cache: CacheFile): void {
  while (cache.order.length > MAX_CACHE_ENTRIES) {
    const evicted = cache.order.shift()
    if (evicted) delete cache.vectors[evicted]
  }
}

// ─── Endpoint capability ─────────────────────────────────────────────────────

/**
 * Pick a sensible default embedding model name for the configured
 * provider. The user can override via LOCALCLAWD_EMBED_MODEL.
 */
function defaultEmbedModel(): string {
  const override = process.env.LOCALCLAWD_EMBED_MODEL
  if (override) return override
  const baseUrl = getLocalLLMBaseUrl()
  if (baseUrl.includes('groq.com')) return 'nomic-embed-text-v1.5'
  if (baseUrl.includes('openai.com')) return 'text-embedding-3-small'
  if (baseUrl.includes('11434')) return 'nomic-embed-text'  // typical Ollama default
  return 'nomic-embed-text-v1.5'  // wide-support default
}

async function probeEndpoint(): Promise<boolean> {
  if (_capability === 'available') return true
  if (_capability === 'unavailable') return false

  const baseUrl = getLocalLLMBaseUrl()
  if (!baseUrl) { _capability = 'unavailable'; return false }
  _embeddingModel = defaultEmbedModel()

  const apiKey = getLocalLLMApiKey()
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({ model: _embeddingModel, input: 'probe' }),
      signal: AbortSignal.timeout(15_000),
    })
    if (res.ok) {
      _capability = 'available'
      logForDebugging(`[embed] endpoint supports ${_embeddingModel}`)
      return true
    }
    logForDebugging(`[embed] probe failed: ${res.status}`)
    _capability = 'unavailable'
    return false
  } catch (e) {
    logForDebugging(`[embed] probe error: ${e}`)
    _capability = 'unavailable'
    return false
  }
}

export async function isEmbeddingAvailable(): Promise<boolean> {
  return probeEndpoint()
}

export function embeddingCapabilityKnown(): 'unknown' | 'available' | 'unavailable' {
  return _capability
}

export function getEmbeddingModel(): string {
  return _embeddingModel || defaultEmbedModel()
}

// ─── Embed ──────────────────────────────────────────────────────────────────

/**
 * Embed a piece of text. Returns null if embedding endpoint is
 * unavailable or the request fails. Cached by sha256(text), so repeat
 * calls for the same text are free.
 */
export async function embedText(text: string): Promise<number[] | null> {
  if (!text.trim()) return null
  const ok = await probeEndpoint()
  if (!ok) return null

  const key = hashText(text)
  const cache = await loadCache()
  const cached = cache.vectors[key]
  if (cached) {
    // LRU bump
    const idx = cache.order.indexOf(key)
    if (idx !== -1) cache.order.splice(idx, 1)
    cache.order.push(key)
    return cached
  }

  const baseUrl = getLocalLLMBaseUrl()
  const apiKey = getLocalLLMApiKey()
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({ model: _embeddingModel, input: text.slice(0, 8000) }),
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) return null
    const data = (await res.json()) as { data?: Array<{ embedding: number[] }> }
    const vec = data.data?.[0]?.embedding
    if (!Array.isArray(vec) || vec.length === 0) return null

    cache.vectors[key] = vec
    cache.order.push(key)
    cache.model = _embeddingModel
    evictIfNeeded(cache)
    // Best-effort save; don't block on failure
    void saveCache(cache).catch(() => {})

    return vec
  } catch (e) {
    logForDebugging(`[embed] error: ${e}`)
    return null
  }
}

// ─── Cosine ─────────────────────────────────────────────────────────────────

export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!
    const y = b[i]!
    dot += x * y
    na += x * x
    nb += y * y
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb)
  return denom === 0 ? 0 : dot / denom
}

/** Score `query` against each `candidate` text. Returns parallel array
 *  of scores in [-1, 1]. Returns null if embeddings are unavailable. */
export async function embedSimilarity(
  query: string,
  candidates: readonly string[],
): Promise<number[] | null> {
  const qVec = await embedText(query)
  if (!qVec) return null
  const out: number[] = []
  for (const c of candidates) {
    const cv = await embedText(c)
    out.push(cv ? cosine(qVec, cv) : 0)
  }
  return out
}
