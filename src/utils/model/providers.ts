import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../../services/analytics/index.js'
import { isEnvTruthy } from '../envUtils.js'

export type APIProvider = 'firstParty' | 'bedrock' | 'vertex' | 'foundry' | 'local'

export type LocalLLMProvider = 'spark' | 'ollama'

function getEnvAlias(localKey: string, legacyKey: string): string | undefined {
  return process.env[localKey] ?? process.env[legacyKey]
}

export function getLocalLLMProvider(): LocalLLMProvider {
  if (
    isEnvTruthy(getEnvAlias('LOCALCLAWD_USE_OLLAMA', 'CLAUDE_CODE_USE_OLLAMA'))
  ) {
    return 'ollama'
  }
  if (
    isEnvTruthy(getEnvAlias('LOCALCLAWD_USE_SPARK', 'LOCALCLAWD_USE_VLLM')) ||
    isEnvTruthy(getEnvAlias('CLAUDE_CODE_USE_SPARK', 'CLAUDE_CODE_USE_VLLM'))
  ) {
    return 'spark'
  }
  return 'spark'
}

export function isLocalLLMProviderEnabled(): boolean {
  return true
}

export function getLocalLLMBaseUrl(provider = getLocalLLMProvider()): string {
  const configured = getEnvAlias(
    'LOCALCLAWD_LOCAL_BASE_URL',
    'CLAUDE_CODE_LOCAL_BASE_URL',
  )?.trim()
  if (configured) {
    return configured
  }
  return provider === 'ollama'
    ? 'http://127.0.0.1:11434/v1'
    : 'https://integrate.api.nvidia.com/v1'
}

export function getLocalLLMApiKey(provider = getLocalLLMProvider()): string {
  return (
    getEnvAlias('LOCALCLAWD_LOCAL_API_KEY', 'CLAUDE_CODE_LOCAL_API_KEY')?.trim() ||
    process.env.NVIDIA_API_KEY?.trim() ||
    process.env.NVAPI_KEY?.trim() ||
    (provider === 'ollama' ? 'ollama' : '')
  )
}

export function getLocalLLMModel(): string | undefined {
  const model = getEnvAlias(
    'LOCALCLAWD_LOCAL_MODEL',
    'CLAUDE_CODE_LOCAL_MODEL',
  )?.trim()
  if (model) {
    return model
  }
  return getLocalLLMProvider() === 'ollama'
    ? 'qwen2.5-coder:32b'
    : 'qwen/qwen2.5-coder-32b-instruct'
}

export function getAPIProvider(): APIProvider {
  return isEnvTruthy(process.env.CLAUDE_CODE_USE_BEDROCK)
    ? 'bedrock'
    : isEnvTruthy(process.env.CLAUDE_CODE_USE_VERTEX)
      ? 'vertex'
      : isEnvTruthy(process.env.CLAUDE_CODE_USE_FOUNDRY)
        ? 'foundry'
        : isLocalLLMProviderEnabled()
          ? 'local'
        : 'firstParty'
}

export function getAPIProviderForStatsig(): AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS {
  return getAPIProvider() as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
}

/**
 * Check if ANTHROPIC_BASE_URL is a first-party Anthropic API URL.
 * Returns true if not set (default API) or points to api.anthropic.com
 * (or api-staging.anthropic.com for ant users).
 */
export function isFirstPartyAnthropicBaseUrl(): boolean {
  if (isLocalLLMProviderEnabled()) {
    return false
  }
  const baseUrl = process.env.ANTHROPIC_BASE_URL
  if (!baseUrl) {
    return true
  }
  try {
    const host = new URL(baseUrl).host
    const allowedHosts = ['api.anthropic.com']
    if (process.env.USER_TYPE === 'ant') {
      allowedHosts.push('api-staging.anthropic.com')
    }
    return allowedHosts.includes(host)
  } catch {
    return false
  }
}
