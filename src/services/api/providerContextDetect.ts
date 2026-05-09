/**
 * Auto-detect context window size from vLLM/Ollama /v1/models endpoint.
 * Called once at startup; result stored via setLocalProviderContextWindow.
 *
 * vLLM exposes max_model_len on each model entry.
 * Ollama exposes context_length inside model_info / options.
 * If detection fails (non-vLLM backend, network error) we do nothing —
 * the caller falls back to /contextsize config or the 131 072 default.
 */

import { logForDebugging } from '../../utils/debug.js'
import {
  getLocalLLMBaseUrl,
  getLocalLLMApiKey,
  getLocalLLMModel,
  getLocalLLMProvider,
} from '../../utils/model/providers.js'
import { setLocalProviderContextWindow } from '../../utils/context.js'
import { getGlobalConfig } from '../../utils/config.js'

function normalizeUrl(base: string): string {
  return base.replace(/\/+$/, '')
}

async function fetchJson(url: string, apiKey?: string): Promise<unknown> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(4000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

/**
 * Parse context length from a vLLM /v1/models response.
 * The model list entry has max_model_len at the top level.
 */
function parseVllmContextWindow(data: unknown, modelHint?: string): number | null {
  if (!data || typeof data !== 'object') return null
  const d = data as Record<string, unknown>
  const models: unknown[] = Array.isArray(d['data']) ? (d['data'] as unknown[]) : []
  if (models.length === 0) return null

  // Prefer the model that matches our configured model name
  let entry = modelHint
    ? (models.find(
        m =>
          typeof m === 'object' &&
          m !== null &&
          ((m as Record<string, unknown>)['id'] === modelHint ||
            String((m as Record<string, unknown>)['id']).includes(modelHint)),
      ) as Record<string, unknown> | undefined)
    : undefined
  if (!entry) entry = models[0] as Record<string, unknown>

  const maxLen = entry['max_model_len']
  if (typeof maxLen === 'number' && maxLen > 0) return maxLen
  return null
}

/**
 * Parse context length from an Ollama /api/show or /v1/models response.
 * Ollama /v1/models wraps a standard OpenAI list but with context info inside model_info.
 */
function parseOllamaContextWindow(data: unknown, modelHint?: string): number | null {
  if (!data || typeof data !== 'object') return null
  const d = data as Record<string, unknown>

  // /v1/models list style
  const models: unknown[] = Array.isArray(d['data']) ? (d['data'] as unknown[]) : []
  for (const m of models) {
    if (!m || typeof m !== 'object') continue
    const entry = m as Record<string, unknown>
    if (modelHint && entry['id'] !== modelHint) continue
    const info = entry['model_info'] as Record<string, unknown> | undefined
    const ctxLen =
      info?.['context_length'] ??
      info?.['llama.context_length'] ??
      (entry['context_length'] as number | undefined)
    if (typeof ctxLen === 'number' && ctxLen > 0) return ctxLen
  }
  return null
}

let _detected = false

/**
 * Auto-detect context window and store it if larger than the current setting.
 * Safe to call multiple times — only runs detection once per process.
 */
export async function autoDetectProviderContextWindow(): Promise<void> {
  if (_detected) return
  _detected = true

  try {
    const configured = getGlobalConfig().compactContextWindowTokens
    if (configured && configured > 0) {
      logForDebugging(
        `[context] Skipping auto-detect because context window is user-configured: ${configured} tokens`,
      )
      return
    }

    const provider = getLocalLLMProvider()
    const baseUrl = normalizeUrl(getLocalLLMBaseUrl(provider))
    const apiKey = getLocalLLMApiKey(provider)
    const modelHint = getLocalLLMModel(provider)

    const data = await fetchJson(`${baseUrl}/models`, apiKey)

    let detected: number | null = null
    if (provider === 'ollama') {
      detected = parseOllamaContextWindow(data, modelHint)
    } else {
      // vllm and generic OpenAI-compatible
      detected = parseVllmContextWindow(data, modelHint)
    }

    if (detected && detected > 0) {
      setLocalProviderContextWindow(detected)
      logForDebugging(
        `[context] Auto-detected context window from ${provider} /models: ${detected} tokens`,
      )
    }
  } catch (err) {
    logForDebugging(`[context] Auto-detect context window failed (non-fatal): ${err}`)
  }
}
