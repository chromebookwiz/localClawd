const SCAN_TIMEOUT_MS = 5000

async function fetchWithTimeout(url: string, options: RequestInit = {}): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), SCAN_TIMEOUT_MS)
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
  // Strip trailing /v1 or /v1/ to get the Ollama root
  return v1BaseUrl.replace(/\/v1\/?$/, '')
}

export type ModelScanResult =
  | { ok: true; models: string[] }
  | { ok: false; error: string }

export async function fetchAvailableModels(
  baseUrl: string,
  provider: string,
  apiKey: string,
): Promise<ModelScanResult> {
  const trimmed = baseUrl.replace(/\/$/, '')

  if (provider === 'ollama') {
    // Try native Ollama /api/tags first
    const nativeBase = ollamaNativeBase(trimmed)
    try {
      const res = await fetchWithTimeout(`${nativeBase}/api/tags`, {
        headers: buildHeaders(apiKey),
      })
      if (res.ok) {
        const json = await res.json() as { models?: Array<{ name: string }> }
        const models = (json.models ?? []).map((m) => m.name).filter(Boolean)
        if (models.length > 0) return { ok: true, models }
      }
    } catch {
      // fall through to OpenAI-compat attempt
    }

    // Fallback: /v1/models (Ollama also exposes this)
    try {
      const res = await fetchWithTimeout(`${trimmed}/models`, {
        headers: buildHeaders(apiKey),
      })
      if (res.ok) {
        const json = await res.json() as { data?: Array<{ id: string }> }
        const models = (json.data ?? []).map((m) => m.id).filter(Boolean)
        if (models.length > 0) return { ok: true, models }
      }
    } catch (err) {
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
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('abort') || msg.includes('timeout')) {
      return { ok: false, error: `Timed out connecting to ${trimmed}. Is the server running?` }
    }
    return { ok: false, error: `Could not reach ${trimmed}: ${msg}` }
  }
}
