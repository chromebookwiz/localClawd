export interface ComfyUISystemStats {
  system: { os: string; python_version: string }
  devices: Array<{ name: string; type: string; vram_total: number; vram_free: number }>
}

export interface ComfyUIQueueResult {
  prompt_id: string
  number: number
  node_errors: Record<string, unknown>
}

export interface ComfyUIHistoryItem {
  prompt: unknown
  outputs: Record<string, { images?: Array<{ filename: string; subfolder: string; type: string }> }>
  status: { status_str: string; completed: boolean; messages: unknown[] }
}

export interface ComfyUIObjectInfo {
  [nodeType: string]: {
    display_name: string
    input: { required?: Record<string, unknown>; optional?: Record<string, unknown> }
  }
}

export const DEFAULT_COMFYUI_URL = 'http://127.0.0.1:8000'
const PROBE_TIMEOUT_MS = 3000

export async function detectComfyUI(url = DEFAULT_COMFYUI_URL): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
    const res = await fetch(`${url}/system_stats`, { signal: controller.signal })
    clearTimeout(timer)
    return res.ok
  } catch {
    return false
  }
}

export async function getComfyUIStats(url: string): Promise<ComfyUISystemStats | null> {
  try {
    const res = await fetch(`${url}/system_stats`)
    if (!res.ok) return null
    return res.json() as Promise<ComfyUISystemStats>
  } catch {
    return null
  }
}

export async function queuePrompt(
  url: string,
  workflow: Record<string, unknown>,
  clientId = 'localclawd',
): Promise<ComfyUIQueueResult> {
  const res = await fetch(`${url}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: workflow, client_id: clientId }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`ComfyUI queue error ${res.status}: ${body || res.statusText}`)
  }
  return res.json() as Promise<ComfyUIQueueResult>
}

export async function getHistory(
  url: string,
  promptId: string,
): Promise<ComfyUIHistoryItem | null> {
  try {
    const res = await fetch(`${url}/history/${promptId}`)
    if (!res.ok) return null
    const data = (await res.json()) as Record<string, ComfyUIHistoryItem>
    return data[promptId] ?? null
  } catch {
    return null
  }
}

export async function pollForCompletion(
  url: string,
  promptId: string,
  maxWaitMs = 120_000,
  intervalMs = 2_000,
): Promise<ComfyUIHistoryItem | null> {
  const deadline = Date.now() + maxWaitMs
  while (Date.now() < deadline) {
    const item = await getHistory(url, promptId)
    if (item?.status?.completed) return item
    await new Promise(resolve => setTimeout(resolve, intervalMs))
  }
  return null
}

export async function fetchServerWorkflowList(url: string): Promise<string[] | null> {
  try {
    const res = await fetch(`${url}/userdata?dir=workflows&recurse=true`)
    if (!res.ok) return null
    const data = (await res.json()) as string[]
    return Array.isArray(data) ? data.filter(f => typeof f === 'string' && f.endsWith('.json')) : null
  } catch {
    return null
  }
}

export async function fetchServerWorkflow(url: string, name: string): Promise<unknown | null> {
  try {
    const filename = name.endsWith('.json') ? name : `${name}.json`
    const res = await fetch(`${url}/userdata/workflows/${encodeURIComponent(filename)}`)
    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}

export function extractOutputImages(item: ComfyUIHistoryItem): string[] {
  const images: string[] = []
  for (const nodeOutput of Object.values(item.outputs)) {
    for (const img of nodeOutput.images ?? []) {
      images.push(img.filename)
    }
  }
  return images
}
