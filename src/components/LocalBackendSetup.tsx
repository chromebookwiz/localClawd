import React, { useEffect, useMemo, useState } from 'react'
import { Box, Text } from '../ink.js'
import {
  getDefaultLocalLLMConfig,
  getLocalLLMProviderLabel,
  normalizeLocalLLMConfig,
  type LocalLLMConfig,
  type LocalLLMProvider,
} from '../utils/model/providers.js'
import { fetchAvailableModels } from '../utils/model/scanModels.js'
import { Select } from './CustomSelect/select.js'
import TextInput from './TextInput.js'

type Props = {
  initialConfig?: Partial<LocalLLMConfig>
  onComplete(config: LocalLLMConfig, options?: { saveGlobally: boolean }): void
  onCancel?(): void
  title?: string
  description?: string
  showSaveGloballyOption?: boolean
}

type SetupStep = 'provider' | 'baseUrl' | 'scanningModels' | 'model' | 'apiKey' | 'saveScope'

const PROVIDER_OPTIONS: Array<{ label: string; value: LocalLLMProvider }> = [
  {
    label: 'Local vLLM server (recommended for self-hosted inference)',
    value: 'vllm',
  },
  {
    label: 'Local Ollama server',
    value: 'ollama',
  },
  {
    label: 'Hosted OpenAI-compatible API or gateway',
    value: 'openai',
  },
]

function getProviderGuidance(provider: LocalLLMProvider): {
  baseUrl: string
  model: string
  apiKey: string
} {
  switch (provider) {
    case 'vllm':
      return {
        baseUrl:
          'Use the URL for your local or remote vLLM server. Press Enter to keep the suggested /v1 endpoint.',
        model:
          'Select a model discovered from your vLLM server, or type a name if you want to override.',
        apiKey:
          'Leave blank for local servers without auth, or paste the gateway token if your deployment requires one.',
      }
    case 'ollama':
      return {
        baseUrl:
          'Use your Ollama OpenAI-compatible endpoint. The default local address works for standard Ollama setups.',
        model:
          'Select a model discovered from your Ollama server, or type a name if you want to override.',
        apiKey:
          'Press Enter to keep the default local Ollama token, or replace it if your proxy expects a different value.',
      }
    case 'openai':
      return {
        baseUrl:
          'Use the API base URL for OpenAI or any compatible hosted gateway. Press Enter to keep the suggested default.',
        model:
          'Enter the exact hosted model ID your provider expects, such as gpt-4.1-mini or a gateway-specific alias.',
        apiKey:
          'Paste the API key for your hosted provider. Leave blank only if your gateway is intentionally unauthenticated.',
      }
  }
}

export function LocalBackendSetup({
  initialConfig,
  onComplete,
  onCancel,
  title = 'Configure your model backend',
  description = 'localclawd speaks to OpenAI-compatible chat completion APIs. Pick a backend, then confirm the endpoint and model to use.',
  showSaveGloballyOption = false,
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
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [scanError, setScanError] = useState<string | null>(null)

  useEffect(() => {
    const nextValue =
      step === 'baseUrl' ? baseUrl : step === 'model' ? model : apiKey
    setCursorOffset(nextValue.length)
  }, [step, baseUrl, model, apiKey])

  function applyProvider(nextProvider: LocalLLMProvider): void {
    const defaults = getDefaultLocalLLMConfig(nextProvider)
    setProvider(nextProvider)
    setBaseUrl(defaults.baseUrl)
    setModel('')
    setApiKey(defaults.apiKey)
    setError(null)
    setScanError(null)
    setAvailableModels([])
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

    // For providers that should scan, go to scanning step
    if (provider === 'vllm' || provider === 'ollama') {
      setStep('scanningModels')
      setScanError(null)
      setAvailableModels([])

      fetchAvailableModels(trimmed, provider, apiKey)
        .then((result) => {
          if (result.ok) {
            setAvailableModels(result.models)
            setScanError(null)
          } else {
            setScanError(result.error)
            setAvailableModels([])
          }
          setStep('model')
        })
        .catch((err) => {
          setScanError(`Unexpected error scanning models: ${err instanceof Error ? err.message : String(err)}`)
          setAvailableModels([])
          setStep('model')
        })
    } else {
      setStep('model')
    }
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
    const nextConfig = {
      provider,
      baseUrl,
      model,
      apiKey: value.trim(),
    }

    setApiKey(nextConfig.apiKey)
    setError(null)

    if (showSaveGloballyOption) {
      setStep('saveScope')
      return
    }

    onComplete(nextConfig, {
      saveGlobally: true,
    })
  }

  const providerLabel = getLocalLLMProviderLabel(provider)
  const baseUrlPlaceholder = getDefaultLocalLLMConfig(provider).baseUrl
  const apiKeyPlaceholder =
    provider === 'ollama'
      ? 'ollama'
      : 'Leave blank if your endpoint does not require auth'
  const guidance = getProviderGuidance(provider)

  const modelSelectOptions = availableModels.map((m) => ({ label: m, value: m }))

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
            Choose a local preset for self-hosted inference, or pick the hosted
            API option if you want to connect with an API key.
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
                {guidance.baseUrl}
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
          {step === 'scanningModels' ? (
            <Box flexDirection="column" gap={1}>
              <Text>
                Scanning models at <Text bold>{baseUrl}</Text>…
              </Text>
              <Text dimColor>Connecting to the endpoint to discover available models.</Text>
            </Box>
          ) : null}
          {step === 'model' ? (
            <>
              <Text>Model</Text>
              {scanError ? (
                <Text color="yellow" wrap="wrap">
                  Could not scan models: {scanError}
                </Text>
              ) : null}
              {availableModels.length > 0 ? (
                <>
                  <Text dimColor>{guidance.model}</Text>
                  <Select
                    options={modelSelectOptions}
                    onChange={value => submitModel(value)}
                    onCancel={onCancel}
                  />
                </>
              ) : (
                <>
                  <Text dimColor>
                    {scanError
                      ? 'Enter the model name manually.'
                      : guidance.model}
                  </Text>
                  <TextInput
                    value={model}
                    onChange={setModel}
                    onSubmit={submitModel}
                    onExit={onCancel}
                    placeholder={provider === 'openai' ? getDefaultLocalLLMConfig(provider).model : ''}
                    columns={76}
                    cursorOffset={cursorOffset}
                    onChangeCursorOffset={setCursorOffset}
                    focus
                    showCursor
                  />
                </>
              )}
            </>
          ) : null}
          {step === 'apiKey' ? (
            <>
              <Text>API key</Text>
              <Text dimColor>
                {guidance.apiKey}
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
          {step === 'saveScope' ? (
            <>
              <Text>How should localclawd use this backend?</Text>
              <Text dimColor wrap="wrap">
                Save it globally if you want this backend to be the default every time localclawd starts. Choose this launch only if you want a temporary override.
              </Text>
              <Select
                options={[
                  {
                    label: 'Save as global default (recommended)',
                    value: 'global',
                  },
                  {
                    label: 'Use only for this launch',
                    value: 'session',
                  },
                ]}
                onChange={value => {
                  onComplete(
                    {
                      provider,
                      baseUrl,
                      model,
                      apiKey,
                    },
                    {
                      saveGlobally: value === 'global',
                    },
                  )
                }}
                onCancel={() => setStep('apiKey')}
              />
            </>
          ) : null}
          {error ? <Text color="error">{error}</Text> : null}
          {step !== 'scanningModels' && step !== 'saveScope' && step !== 'model' ? (
            <Text dimColor>
              Enter confirms the current value. Esc cancels this setup step. Environment variables still override saved defaults when present.
            </Text>
          ) : null}
        </>
      )}
    </Box>
  )
}
