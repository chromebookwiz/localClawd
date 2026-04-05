const MODEL_SCAN_TIMEOUT_MS = 5000
const NETWORK_PROBE_TIMEOUT_MS = 600
const NETWORK_CONCURRENCY = 30

// Common vLLM / OpenAI-compat ports
const VLLM_PORTS = [8000, 8080, 4000, 5000, 1234, 3000, 7860, 8888]

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

async function probeVllmEndpoint(
  url: string,
  parentSignal: AbortSignal,
): Promise<string[] | null> {
  if (parentSignal.aborted) return null
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), NETWORK_PROBE_TIMEOUT_MS)
    // If parent aborts, abort this probe immediately
    const onParentAbort = () => controller.abort()
    parentSignal.addEventListener('abort', onParentAbort, { once: true })
    let res: Response
    try {
      res = await fetch(`${url}/models`, { signal: controller.signal })
    } finally {
      clearTimeout(timer)
      parentSignal.removeEventListener('abort', onParentAbort)
    }
    if (!res.ok) return null
    const json = await res.json() as { data?: Array<{ id: string }> }
    const models = (json.data ?? []).map((m) => m.id).filter(Boolean)
    return models.length > 0 ? models : null
  } catch {
    return null
  }
}

export async function scanLocalNetworkForVllm(
  subnet: string = '192.168.1',
  abortSignal: AbortSignal,
  onProgress?: (progress: NetworkScanProgress) => void,
): Promise<DiscoveredEndpoint[]> {
  const found: DiscoveredEndpoint[] = []
  const tasks: Array<{ host: number; port: number }> = []

  for (let host = 1; host <= 254; host++) {
    for (const port of VLLM_PORTS) {
      tasks.push({ host, port })
    }
  }

  const total = tasks.length
  let scanned = 0
  let taskIdx = 0

  async function worker(): Promise<void> {
    while (taskIdx < tasks.length) {
      if (abortSignal.aborted) return
      const task = tasks[taskIdx++]
      const url = `http://${subnet}.${task.host}:${task.port}/v1`
      const models = await probeVllmEndpoint(url, abortSignal)
      if (abortSignal.aborted) return
      scanned++
      if (models) {
        found.push({ url, models })
      }
      onProgress?.({ scanned, total, found: found.length })
    }
  }

  const workers = Array.from({ length: NETWORK_CONCURRENCY }, () => worker())
  await Promise.all(workers)
  return found
}
