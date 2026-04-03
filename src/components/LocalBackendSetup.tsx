import React, { useEffect, useMemo, useState } from 'react'
import { Box, Text } from '../ink.js'
import {
  getDefaultLocalLLMConfig,
  getLocalLLMProviderLabel,
  normalizeLocalLLMConfig,
  type LocalLLMConfig,
  type LocalLLMProvider,
} from '../utils/model/providers.js'
import { Select } from './CustomSelect/select.js'
import TextInput from './TextInput.js'

type Props = {
  initialConfig?: Partial<LocalLLMConfig>
  onComplete(config: LocalLLMConfig): void
  onCancel?(): void
  title?: string
  description?: string
}

type SetupStep = 'provider' | 'baseUrl' | 'model' | 'apiKey'

const PROVIDER_OPTIONS: Array<{ label: string; value: LocalLLMProvider }> = [
  {
    label: 'vLLM (recommended for self-hosted OpenAI-compatible servers)',
    value: 'vllm',
  },
  {
    label: 'Ollama',
    value: 'ollama',
  },
  {
    label: 'Other OpenAI-compatible endpoint',
    value: 'openai',
  },
]

export function LocalBackendSetup({
  initialConfig,
  onComplete,
  onCancel,
  title = 'Configure your model backend',
  description = 'localClawd speaks to OpenAI-compatible chat completion APIs. Pick a backend, then confirm the endpoint and model to use.',
}: Props): React.ReactNode {
  const normalizedInitial = useMemo(
    () => normalizeLocalLLMConfig(initialConfig),
    [initialConfig],
  )
  const [step, setStep] = useState<SetupStep>('provider')
  const [provider, setProvider] = useState<LocalLLMProvider>(
    normalizedInitial.provider,
  )
  const [baseUrl, setBaseUrl] = useState(normalizedInitial.baseUrl)
  const [model, setModel] = useState(normalizedInitial.model)
  const [apiKey, setApiKey] = useState(normalizedInitial.apiKey)
  const [cursorOffset, setCursorOffset] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const nextValue =
      step === 'baseUrl' ? baseUrl : step === 'model' ? model : apiKey
    setCursorOffset(nextValue.length)
  }, [step, baseUrl, model, apiKey])

  function applyProvider(nextProvider: LocalLLMProvider): void {
    const defaults = getDefaultLocalLLMConfig(nextProvider)
    setProvider(nextProvider)
    setBaseUrl(defaults.baseUrl)
    setModel(defaults.model)
    setApiKey(defaults.apiKey)
    setError(null)
    setStep('baseUrl')
  }

  function submitBaseUrl(value: string): void {
    const trimmed = value.trim()
    if (!trimmed) {
      setError('Base URL is required.')
      return
    }

    try {
      new URL(trimmed)
    } catch {
      setError('Base URL must include a valid scheme such as http:// or https://.')
      return
    }

    setBaseUrl(trimmed)
    setError(null)
    setStep('model')
  }

  function submitModel(value: string): void {
    const trimmed = value.trim()
    if (!trimmed) {
      setError('Model name is required.')
      return
    }

    setModel(trimmed)
    setError(null)
    setStep('apiKey')
  }

  function submitApiKey(value: string): void {
    onComplete({
      provider,
      baseUrl,
      model,
      apiKey: value.trim(),
    })
  }

  const providerLabel = getLocalLLMProviderLabel(provider)
  const baseUrlPlaceholder = getDefaultLocalLLMConfig(provider).baseUrl
  const modelPlaceholder = getDefaultLocalLLMConfig(provider).model
  const apiKeyPlaceholder =
    provider === 'ollama'
      ? 'ollama'
      : 'Leave blank if your endpoint does not require auth'

  return (
    <Box flexDirection="column" gap={1} paddingLeft={1} width={80}>
      <Text bold>{title}</Text>
      <Text dimColor wrap="wrap">
        {description}
      </Text>
      {step === 'provider' ? (
        <>
          <Select
            options={PROVIDER_OPTIONS}
            onChange={value => applyProvider(value as LocalLLMProvider)}
            onCancel={onCancel}
          />
          <Text dimColor>
            vLLM is the default path. Use it for self-hosted vLLM, Spark-backed
            vLLM, or any similar OpenAI-compatible server.
          </Text>
        </>
      ) : (
        <>
          <Text>
            Backend: <Text bold>{providerLabel}</Text>
          </Text>
          {step === 'baseUrl' ? (
            <>
              <Text>Endpoint base URL</Text>
              <Text dimColor>
                Include the /v1 path if your server exposes OpenAI-compatible
                routes there.
              </Text>
              <TextInput
                value={baseUrl}
                onChange={setBaseUrl}
                onSubmit={submitBaseUrl}
                onExit={onCancel}
                placeholder={baseUrlPlaceholder}
                columns={76}
                cursorOffset={cursorOffset}
                onChangeCursorOffset={setCursorOffset}
                focus
                showCursor
              />
            </>
          ) : null}
          {step === 'model' ? (
            <>
              <Text>Model name</Text>
              <Text dimColor>
                Enter the exact model identifier served by {providerLabel}.
              </Text>
              <TextInput
                value={model}
                onChange={setModel}
                onSubmit={submitModel}
                onExit={onCancel}
                placeholder={modelPlaceholder}
                columns={76}
                cursorOffset={cursorOffset}
                onChangeCursorOffset={setCursorOffset}
                focus
                showCursor
              />
            </>
          ) : null}
          {step === 'apiKey' ? (
            <>
              <Text>API key</Text>
              <Text dimColor>
                Press Enter on an empty field to skip auth for local or trusted
                endpoints.
              </Text>
              <TextInput
                value={apiKey}
                onChange={setApiKey}
                onSubmit={submitApiKey}
                onExit={onCancel}
                placeholder={apiKeyPlaceholder}
                columns={76}
                cursorOffset={cursorOffset}
                onChangeCursorOffset={setCursorOffset}
                focus
                showCursor
              />
            </>
          ) : null}
          {error ? <Text color="error">{error}</Text> : null}
          <Text dimColor>
            Enter confirms the current value. Esc cancels this setup step.
          </Text>
        </>
      )}
    </Box>
  )
}