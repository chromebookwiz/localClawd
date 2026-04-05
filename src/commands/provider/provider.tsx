import * as React from 'react'
import { LocalBackendSetup } from '../../components/LocalBackendSetup.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js'
import {
  getLocalLLMProviderLabel,
  type LocalLLMConfig,
} from '../../utils/model/providers.js'

function formatProviderSavedMessage(config: LocalLLMConfig): string {
  const providerLabel = getLocalLLMProviderLabel(config.provider)
  return [
    `Saved ${providerLabel} as the default backend.`,
    `Model: ${config.model}`,
    `Endpoint: ${config.baseUrl}`,
    config.apiKey ? 'Auth: configured' : 'Auth: not configured',
    config.provider === 'openai'
      ? 'Next: run localclawd or localclawd doctor to verify your hosted API key and model.'
      : 'Next: make sure your local server is reachable, then run localclawd or localclawd doctor.',
    'You can change this later with /provider or /config.',
  ].join('\n')
}

export const call: LocalJSXCommandCall = async onDone => {
  const config = getGlobalConfig()

  function handleComplete(nextConfig: LocalLLMConfig): void {
    saveGlobalConfig(current => ({
      ...current,
      localBackendProvider: nextConfig.provider,
      localBackendBaseUrl: nextConfig.baseUrl,
      localBackendModel: nextConfig.model,
      localBackendApiKey: nextConfig.apiKey,
    }))

    onDone(formatProviderSavedMessage(nextConfig), {
      display: 'system',
    })
  }

  function handleCancel(): void {
    onDone('Provider setup cancelled.', {
      display: 'system',
    })
  }

  return (
    <LocalBackendSetup
      initialConfig={{
        provider: config.localBackendProvider,
        baseUrl: config.localBackendBaseUrl,
        model: config.localBackendModel,
        apiKey: config.localBackendApiKey,
      }}
      onComplete={handleComplete}
      onCancel={handleCancel}
      title="Choose your default backend"
      description="Pick the OpenAI-compatible backend localclawd should use for chat completions, tool calls, and multimodal requests. Environment variables still override these saved defaults when present."
    />
  )
}