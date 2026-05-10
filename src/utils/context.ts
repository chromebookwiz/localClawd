// biome-ignore-all assist/source/organizeImports: ANT-ONLY import markers must not be reordered
import { getGlobalConfig } from './config.js'
import { isEnvTruthy } from './envUtils.js'
import { getCanonicalName } from './model/model.js'
import { resolveAntModel } from './model/antModels.js'
import { getModelCapability } from './model/modelCapabilities.js'

function getEnvAlias(localKey: string, legacyKey: string): string | undefined {
  return process.env[localKey] ?? process.env[legacyKey]
}

// Default context window when nothing else is set or detected.
// 131072 = 128k — conservative default; set via /ctx set to match your model.
export const MODEL_CONTEXT_WINDOW_DEFAULT = 131_072
export const COMPACT_CONTEXT_WINDOW_CHOICES = [
  32_000,
  64_000,
  128_000,
  200_000,
  256_000,
  512_000,
  1_000_000,
] as const

// Maximum output tokens for compact operations
export const COMPACT_MAX_OUTPUT_TOKENS = 20_000

// Default max output tokens
const MAX_OUTPUT_TOKENS_DEFAULT = 32_000
const MAX_OUTPUT_TOKENS_UPPER_LIMIT = 64_000

// Capped default for slot-reservation optimization. BQ p99 output = 4,911
// tokens, so 32k/64k defaults over-reserve 8-16× slot capacity. With the cap
// enabled, <1% of requests hit the limit; those get one clean retry at 64k
// (see query.ts max_output_tokens_escalate). Cap is applied in
// claude.ts:getMaxOutputTokensForModel to avoid the growthbook→betas→context
// import cycle.
export const CAPPED_DEFAULT_MAX_TOKENS = 8_000
export const ESCALATED_MAX_TOKENS = 64_000

// localclawd targets local backends (vLLM/Ollama/OpenAI-compatible). The
// Anthropic 1M-context feature flags are no-ops here — context size is a
// single number set via /ctx or auto-detected from the provider.
export function is1mContextDisabled(): boolean { return true }
export function has1mContext(_model: string): boolean { return false }
export function modelSupports1M(_model: string): boolean { return false }

/** Parse a context window string like "200k", "1m", "131072" → number | null */
export function parseContextWindowString(s: string): number | null {
  const trimmed = s.trim().toLowerCase()
  const mMatch = trimmed.match(/^(\d+(?:\.\d+)?)m$/)
  if (mMatch) return Math.round(parseFloat(mMatch[1]!) * 1_000_000)
  const kMatch = trimmed.match(/^(\d+(?:\.\d+)?)k$/)
  if (kMatch) return Math.round(parseFloat(kMatch[1]!) * 1_000)
  const plain = parseInt(trimmed, 10)
  if (!isNaN(plain) && plain > 0) return plain
  return null
}

/** Cached context window from the local provider (set by providerContextDetect.ts). */
let _localProviderContextWindow: number | null = null

export function setLocalProviderContextWindow(n: number | null): void {
  _localProviderContextWindow = n
}

export function getLocalProviderContextWindow(): number | null {
  return _localProviderContextWindow
}

/**
 * Single source of truth for context window size.
 * Precedence:
 *   1. env var (LOCALCLAWD_MAX_CONTEXT_TOKENS / CLAUDE_CODE_MAX_CONTEXT_TOKENS)
 *   2. compactContextWindowTokens in global config (set by /ctx set, or persisted by auto-detect)
 *   3. in-memory provider auto-detection (this session)
 *   4. 128k default
 */
export function getContextWindowForModel(
  _model?: string,
  _betas?: string[],
): number {
  const envOverrideStr = getEnvAlias('LOCALCLAWD_MAX_CONTEXT_TOKENS', 'CLAUDE_CODE_MAX_CONTEXT_TOKENS')
  if (envOverrideStr) {
    const override = parseContextWindowString(envOverrideStr)
    if (override !== null) return override
  }

  const persisted = getGlobalConfig().compactContextWindowTokens
  if (persisted && persisted > 0) return persisted

  if (_localProviderContextWindow && _localProviderContextWindow > 0) {
    return _localProviderContextWindow
  }
  return MODEL_CONTEXT_WINDOW_DEFAULT
}

export function formatCompactContextWindowOption(
  tokens?: number,
): string {
  if (!tokens) {
    return 'Model default'
  }

  if (tokens >= 1_000_000) {
    return '1M tokens'
  }

  return `${Math.round(tokens / 1_000)}k tokens`
}

export function getConfiguredCompactContextWindow(): number | undefined {
  const envOverride = getEnvAlias(
    'LOCALCLAWD_AUTO_COMPACT_WINDOW',
    'CLAUDE_CODE_AUTO_COMPACT_WINDOW',
  )
  if (envOverride) {
    const parsed = parseContextWindowString(envOverride)
    if (parsed !== null) return parsed
  }

  const configured = getGlobalConfig().compactContextWindowTokens
  if (typeof configured === 'number' && configured > 0) {
    return configured
  }

  return undefined
}

export function getSonnet1mExpTreatmentEnabled(_model: string): boolean {
  return false
}

/**
 * Calculate context window usage percentage from token usage data.
 * Returns used and remaining percentages, or null values if no usage data.
 */
export function calculateContextPercentages(
  currentUsage: {
    input_tokens: number
    cache_creation_input_tokens: number
    cache_read_input_tokens: number
  } | null,
  contextWindowSize: number,
): { used: number | null; remaining: number | null } {
  if (!currentUsage) {
    return { used: null, remaining: null }
  }

  const totalInputTokens =
    currentUsage.input_tokens +
    currentUsage.cache_creation_input_tokens +
    currentUsage.cache_read_input_tokens

  const usedPercentage = Math.round(
    (totalInputTokens / contextWindowSize) * 100,
  )
  const clampedUsed = Math.min(100, Math.max(0, usedPercentage))

  return {
    used: clampedUsed,
    remaining: 100 - clampedUsed,
  }
}

/**
 * Returns the model's default and upper limit for max output tokens.
 */
export function getModelMaxOutputTokens(model: string): {
  default: number
  upperLimit: number
} {
  let defaultTokens: number
  let upperLimit: number

  if (process.env.USER_TYPE === 'ant') {
    const antModel = resolveAntModel(model.toLowerCase())
    if (antModel) {
      defaultTokens = antModel.defaultMaxTokens ?? MAX_OUTPUT_TOKENS_DEFAULT
      upperLimit = antModel.upperMaxTokensLimit ?? MAX_OUTPUT_TOKENS_UPPER_LIMIT
      return { default: defaultTokens, upperLimit }
    }
  }

  const m = getCanonicalName(model)

  if (m.includes('opus-4-6')) {
    defaultTokens = 64_000
    upperLimit = 128_000
  } else if (m.includes('sonnet-4-6')) {
    defaultTokens = 32_000
    upperLimit = 128_000
  } else if (
    m.includes('opus-4-5') ||
    m.includes('sonnet-4') ||
    m.includes('haiku-4')
  ) {
    defaultTokens = 32_000
    upperLimit = 64_000
  } else if (m.includes('opus-4-1') || m.includes('opus-4')) {
    defaultTokens = 32_000
    upperLimit = 32_000
  } else if (m.includes('claude-3-opus')) {
    defaultTokens = 4_096
    upperLimit = 4_096
  } else if (m.includes('claude-3-sonnet')) {
    defaultTokens = 8_192
    upperLimit = 8_192
  } else if (m.includes('claude-3-haiku')) {
    defaultTokens = 4_096
    upperLimit = 4_096
  } else if (m.includes('3-5-sonnet') || m.includes('3-5-haiku')) {
    defaultTokens = 8_192
    upperLimit = 8_192
  } else if (m.includes('3-7-sonnet')) {
    defaultTokens = 32_000
    upperLimit = 64_000
  } else {
    defaultTokens = MAX_OUTPUT_TOKENS_DEFAULT
    upperLimit = MAX_OUTPUT_TOKENS_UPPER_LIMIT
  }

  const cap = getModelCapability(model)
  if (cap?.max_tokens && cap.max_tokens >= 4_096) {
    upperLimit = cap.max_tokens
    defaultTokens = Math.min(defaultTokens, upperLimit)
  }

  return { default: defaultTokens, upperLimit }
}

/**
 * Returns the max thinking budget tokens for a given model. The max
 * thinking tokens should be strictly less than the max output tokens.
 *
 * Deprecated since newer models use adaptive thinking rather than a
 * strict thinking token budget.
 */
export function getMaxThinkingTokensForModel(model: string): number {
  return getModelMaxOutputTokens(model).upperLimit - 1
}
