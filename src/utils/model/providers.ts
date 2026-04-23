import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../../services/analytics/index.js'
import { getGlobalConfig, type LocalBackendProvider } from '../config.js'
import { isEnvTruthy } from '../envUtils.js'

export type APIProvider = 'firstParty' | 'bedrock' | 'vertex' | 'foundry' | 'local'

export type LocalLLMProvider = LocalBackendProvider

export type LocalLLMConfig = {
  provider: LocalLLMProvider
  baseUrl: string
  model: string
  apiKey: string
}

let sessionLocalLLMConfigOverride: LocalLLMConfig | null = null

const LOCAL_LLM_DEFAULTS: Record<LocalLLMProvider, Omit<LocalLLMConfig, 'provider'>> = {
  vllm: {
    baseUrl: 'http://127.0.0.1:8000/v1',
    model: '', // no default — scanned from the vLLM /v1/models endpoint at setup time
    apiKey: '',
  },
  ollama: {
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: '', // no default — scanned from the Ollama /api/tags endpoint at setup time
    apiKey: 'ollama',
  },
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4.1-mini',
    apiKey: '',
  },
}

function getEnvAlias(localKey: string, legacyKey: string): string | undefined {
  return process.env[localKey] ?? process.env[legacyKey]
}

function isLocalLLMProvider(value: string | undefined): value is LocalLLMProvider {
  return value === 'vllm' || value === 'ollama' || value === 'openai'
}

function getConfiguredLocalLLMProvider(): LocalLLMProvider | undefined {
  const configuredProvider = getGlobalConfig().localBackendProvider
  return isLocalLLMProvider(configuredProvider) ? configuredProvider : undefined
}

function getLocalLLMProviderFromEnv(): LocalLLMProvider | undefined {
  if (
    isEnvTruthy(getEnvAlias('LOCALCLAWD_USE_OLLAMA', 'CLAUDE_CODE_USE_OLLAMA'))
  ) {
    return 'ollama'
  }
  if (
    isEnvTruthy(getEnvAlias('LOCALCLAWD_USE_OPENAI', 'CLAUDE_CODE_USE_OPENAI'))
  ) {
    return 'openai'
  }
  if (
    isEnvTruthy(getEnvAlias('LOCALCLAWD_USE_SPARK', 'LOCALCLAWD_USE_VLLM')) ||
    isEnvTruthy(getEnvAlias('CLAUDE_CODE_USE_SPARK', 'CLAUDE_CODE_USE_VLLM'))
  ) {
    return 'vllm'
  }
  return undefined
}

export function getDefaultLocalLLMConfig(
  provider: LocalLLMProvider = 'vllm',
): LocalLLMConfig {
  return {
    provider,
    ...LOCAL_LLM_DEFAULTS[provider],
  }
}

export function getLocalLLMProviderLabel(provider: LocalLLMProvider): string {
  switch (provider) {
    case 'vllm':
      return 'Local endpoint'
    case 'ollama':
      return 'Ollama'
    case 'openai':
      return 'Other OpenAI-compatible'
  }
}

export function normalizeLocalLLMConfig(
  config?: Partial<LocalLLMConfig>,
): LocalLLMConfig {
  const provider = config?.provider ?? 'vllm'
  const defaults = getDefaultLocalLLMConfig(provider)
  // For vLLM and Ollama the default model is intentionally empty — callers must
  // discover the model via fetchAvailableModels() rather than using a hardcoded name.
  const fallbackModel = provider === 'openai' ? defaults.model : ''
  return {
    provider,
    baseUrl: config?.baseUrl?.trim() || defaults.baseUrl,
    model: config?.model?.trim() || fallbackModel,
    apiKey: config?.apiKey?.trim() || defaults.apiKey,
  }
}

export function setSessionLocalLLMConfigOverride(
  config?: Partial<LocalLLMConfig> | null,
): void {
  sessionLocalLLMConfigOverride = config
    ? normalizeLocalLLMConfig(config)
    : null
}

export function clearSessionLocalLLMConfigOverride(): void {
  sessionLocalLLMConfigOverride = null
}

export function getSessionLocalLLMConfigOverride(): LocalLLMConfig | null {
  return sessionLocalLLMConfigOverride
}

export function getLocalLLMProvider(): LocalLLMProvider {
  return getLocalLLMProviderFromEnv() ?? sessionLocalLLMConfigOverride?.provider ?? getConfiguredLocalLLMProvider() ?? 'vllm'
}

export function isLocalLLMProviderEnabled(): boolean {
  return true
}

export function getLocalLLMBaseUrl(provider = getLocalLLMProvider()): string {
  const configuredFromEnv = getEnvAlias(
    'LOCALCLAWD_LOCAL_BASE_URL',
    'CLAUDE_CODE_LOCAL_BASE_URL',
  )?.trim()
  if (configuredFromEnv) {
    return configuredFromEnv
  }

  const defaults = getDefaultLocalLLMConfig(provider)
  if (sessionLocalLLMConfigOverride?.provider === provider) {
    return sessionLocalLLMConfigOverride.baseUrl
  }
  const globalConfig = getGlobalConfig()
  const configuredProvider = getConfiguredLocalLLMProvider()
  if (
    configuredProvider === provider &&
    globalConfig.localBackendBaseUrl?.trim()
  ) {
    return globalConfig.localBackendBaseUrl.trim()
  }

  return defaults.baseUrl
}

export function getLocalLLMApiKey(provider = getLocalLLMProvider()): string {
  const configuredFromEnv = getEnvAlias(
    'LOCALCLAWD_LOCAL_API_KEY',
    'CLAUDE_CODE_LOCAL_API_KEY',
  )?.trim()
  if (configuredFromEnv) {
    return configuredFromEnv
  }

  const defaults = getDefaultLocalLLMConfig(provider)
  if (sessionLocalLLMConfigOverride?.provider === provider) {
    return sessionLocalLLMConfigOverride.apiKey
  }
  const globalConfig = getGlobalConfig()
  const configuredProvider = getConfiguredLocalLLMProvider()
  if (configuredProvider === provider) {
    return globalConfig.localBackendApiKey?.trim() || defaults.apiKey
  }

  return defaults.apiKey
}

export function getLocalLLMModel(provider = getLocalLLMProvider()): string | undefined {
  const model = getEnvAlias(
    'LOCALCLAWD_LOCAL_MODEL',
    'CLAUDE_CODE_LOCAL_MODEL',
  )?.trim()
  if (model) {
    return model
  }

  if (sessionLocalLLMConfigOverride?.provider === provider) {
    return sessionLocalLLMConfigOverride.model || undefined
  }
  const globalConfig = getGlobalConfig()
  const configuredProvider = getConfiguredLocalLLMProvider()
  if (configuredProvider === provider && globalConfig.localBackendModel?.trim()) {
    return globalConfig.localBackendModel.trim()
  }

  // vLLM and Ollama have no hardcoded default — return undefined so the caller
  // knows a model must be selected (via scan or explicit user config).
  if (provider === 'openai') {
    return getDefaultLocalLLMConfig(provider).model
  }
  return undefined
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
