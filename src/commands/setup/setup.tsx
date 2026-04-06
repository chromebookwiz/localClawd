import * as React from 'react'
import { LocalBackendSetup } from '../../components/LocalBackendSetup.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js'
import {
  getLocalLLMProviderLabel,
  type LocalLLMConfig,
} from '../../utils/model/providers.js'

function formatSetupSavedMessage(config: LocalLLMConfig): string {
  const label = getLocalLLMProviderLabel(config.provider)
  return [
    `Backend configured: ${label}`,
    `Model: ${config.model}`,
    `Endpoint: ${config.baseUrl}`,
    config.apiKey ? 'Auth: configured' : 'Auth: not configured',
    'Settings saved. Use /setup or /provider to change at any time.',
  ].join('\n')
}

export const call: LocalJSXCommandCall = async onDone => {
  const config = getGlobalConfig()

  function handleComplete(nextConfig: LocalLLMConfig, options?: { saveGlobally: boolean }): void {
    if (options?.saveGlobally !== false) {
      saveGlobalConfig(current => ({
        ...current,
        localBackendProvider: nextConfig.provider,
        localBackendBaseUrl: nextConfig.baseUrl,
        localBackendModel: nextConfig.model,
        localBackendApiKey: nextConfig.apiKey,
      }))
    }
    onDone(formatSetupSavedMessage(nextConfig), { display: 'system' })
  }

  function handleCancel(): void {
    onDone('Setup cancelled.', { display: 'system' })
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
      showSaveGloballyOption
      title="Backend setup"
      description="Configure the OpenAI-compatible endpoint localclawd uses for completions, tool calls, and multimodal requests. Vision works automatically when your model accepts image content blocks."
    />
  )
}
