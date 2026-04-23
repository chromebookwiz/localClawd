/**
 * Generic Whisper-compatible audio transcription.
 *
 * Supports any endpoint implementing OpenAI's /v1/audio/transcriptions
 * contract: OpenAI, Groq, local whisper.cpp servers, faster-whisper,
 * vLLM+whisper, LM Studio with a whisper model, etc.
 *
 * Priority order for credentials:
 *   1. STT_BASE_URL + STT_API_KEY + STT_MODEL (custom)
 *   2. GROQ_API_KEY (fast + free tier — uses whisper-large-v3)
 *   3. OPENAI_API_KEY (uses whisper-1)
 *
 * If none is configured, transcription returns null and the caller
 * should fall back to a polite "voice transcription not configured"
 * message.
 */

import { logForDebugging } from '../../utils/debug.js'

interface TranscribeConfig {
  baseUrl: string
  apiKey: string
  model: string
}

function getTranscribeConfig(): TranscribeConfig | null {
  const customBase = process.env.STT_BASE_URL
  const customKey = process.env.STT_API_KEY
  if (customBase) {
    return {
      baseUrl: customBase.replace(/\/$/, ''),
      apiKey: customKey ?? '',
      model: process.env.STT_MODEL ?? 'whisper-1',
    }
  }

  const groqKey = process.env.GROQ_API_KEY
  if (groqKey) {
    return {
      baseUrl: 'https://api.groq.com/openai/v1',
      apiKey: groqKey,
      model: process.env.STT_MODEL ?? 'whisper-large-v3',
    }
  }

  const openaiKey = process.env.OPENAI_API_KEY
  if (openaiKey) {
    return {
      baseUrl: 'https://api.openai.com/v1',
      apiKey: openaiKey,
      model: process.env.STT_MODEL ?? 'whisper-1',
    }
  }

  return null
}

export function isTranscriptionConfigured(): boolean {
  return getTranscribeConfig() !== null
}

/**
 * Transcribe an audio buffer. Returns the text on success, or null on failure.
 *
 * @param audio    Raw audio bytes (any format Whisper accepts: mp3, ogg, wav, m4a, webm, …)
 * @param filename Filename hint — used for MIME detection by some providers (e.g. "voice.ogg")
 */
export async function transcribeAudio(
  audio: Uint8Array,
  filename: string = 'audio.ogg',
): Promise<string | null> {
  const config = getTranscribeConfig()
  if (!config) {
    logForDebugging('[transcribe] no STT/Groq/OpenAI key configured — skipping transcription')
    return null
  }

  try {
    const form = new FormData()
    const blob = new Blob([audio])
    form.append('file', blob, filename)
    form.append('model', config.model)
    form.append('response_format', 'text')

    const res = await fetch(`${config.baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}` },
      body: form,
      signal: AbortSignal.timeout(60_000),
    })

    if (!res.ok) {
      const err = await res.text().catch(() => '')
      logForDebugging(`[transcribe] ${res.status}: ${err.slice(0, 200)}`, { level: 'warn' })
      return null
    }

    // response_format=text returns plain text
    const text = (await res.text()).trim()
    return text || null
  } catch (e) {
    logForDebugging(`[transcribe] fetch failed: ${e}`, { level: 'warn' })
    return null
  }
}

/**
 * Download an audio file over HTTP and transcribe it in one call.
 * Handles Bearer auth for providers (like Slack) that require it.
 */
export async function transcribeFromUrl(
  url: string,
  filename: string = 'audio.ogg',
  authHeader?: string,
): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: authHeader ? { Authorization: authHeader } : {},
      signal: AbortSignal.timeout(60_000),
    })
    if (!res.ok) {
      logForDebugging(`[transcribe] download ${res.status}`, { level: 'warn' })
      return null
    }
    const buf = new Uint8Array(await res.arrayBuffer())
    return await transcribeAudio(buf, filename)
  } catch (e) {
    logForDebugging(`[transcribe] download error: ${e}`, { level: 'warn' })
    return null
  }
}
