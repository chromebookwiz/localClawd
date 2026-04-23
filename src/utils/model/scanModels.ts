const MODEL_SCAN_TIMEOUT_MS = 5000

async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = MODEL_SCAN_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  // Merge caller's signal with our timeout signal
  const callerSignal = options.signal as AbortSignal | undefined
  if (callerSignal) {
    callerSignal.addEventListener('abort', () => controller.abort(), { once: true })
  }
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

function buildHeaders(apiKey: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey && apiKey !== 'ollama') {
    headers['Authorization'] = `Bearer ${apiKey}`
  }
  return headers
}

function ollamaNativeBase(v1BaseUrl: string): string {
  return v1BaseUrl.replace(/\/v1\/?$/, '')
}

// ─── Model list scan ────────────────────────────────────────────────────────

export type ModelScanResult =
  | { ok: true; models: string[] }
  | { ok: false; error: string }

export async function fetchAvailableModels(
  baseUrl: string,
  provider: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<ModelScanResult> {
  const trimmed = baseUrl.replace(/\/$/, '')

  if (provider === 'ollama') {
    const nativeBase = ollamaNativeBase(trimmed)
    try {
      const res = await fetchWithTimeout(`${nativeBase}/api/tags`, {
        headers: buildHeaders(apiKey),
        signal,
      })
      if (res.ok) {
        const json = await res.json() as { models?: Array<{ name: string }> }
        const models = (json.models ?? []).map((m) => m.name).filter(Boolean)
        if (models.length > 0) return { ok: true, models }
      }
    } catch (err) {
      if (signal?.aborted) return { ok: false, error: 'Cancelled.' }
      // fall through to OpenAI-compat attempt
    }

    try {
      const res = await fetchWithTimeout(`${trimmed}/models`, {
        headers: buildHeaders(apiKey),
        signal,
      })
      if (res.ok) {
        const json = await res.json() as { data?: Array<{ id: string }> }
        const models = (json.data ?? []).map((m) => m.id).filter(Boolean)
        if (models.length > 0) return { ok: true, models }
      }
    } catch (err) {
      if (signal?.aborted) return { ok: false, error: 'Cancelled.' }
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('abort') || msg.includes('timeout')) {
        return { ok: false, error: `Timed out connecting to Ollama at ${nativeBase}. Is Ollama running?` }
      }
      return { ok: false, error: `Could not reach Ollama at ${nativeBase}: ${msg}` }
    }

    return { ok: false, error: `No models found at ${nativeBase}. Make sure Ollama is running and has at least one model pulled.` }
  }

  // vLLM / OpenAI-compatible: GET /models
  try {
    const res = await fetchWithTimeout(`${trimmed}/models`, {
      headers: buildHeaders(apiKey),
      signal,
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return {
        ok: false,
        error: `Endpoint returned HTTP ${res.status}${body ? ': ' + body.slice(0, 200) : ''}`,
      }
    }
    const json = await res.json() as { data?: Array<{ id: string }> }
    const models = (json.data ?? []).map((m) => m.id).filter(Boolean)
    if (models.length === 0) {
      return { ok: false, error: `The endpoint responded but returned no models. Check that your server is fully loaded.` }
    }
    return { ok: true, models }
  } catch (err) {
    if (signal?.aborted) return { ok: false, error: 'Cancelled.' }
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('abort') || msg.includes('timeout')) {
      return { ok: false, error: `Timed out connecting to ${trimmed}. Is the server running?` }
    }
    return { ok: false, error: `Could not reach ${trimmed}: ${msg}` }
  }
}

// ─── Local network endpoint scan ────────────────────────────────────────────

export type DiscoveredEndpoint = {
  url: string
  models: string[]
}

export type NetworkScanProgress = {
  scanned: number
  total: number
  found: number
}

/**
 * Deprecated: the old /24 port scanner was both slow and incomplete. Setup
 * now uses explicit URL entry + preset/history picker (see LocalBackendSetup).
 * This stub is kept so nothing that still imports it crashes at build time.
 */
export async function scanLocalNetworkForVllm(
  _subnet: string = '',
  _abortSignal?: AbortSignal,
  _onProgress?: (progress: NetworkScanProgress) => void,
): Promise<DiscoveredEndpoint[]> {
  return []
}
