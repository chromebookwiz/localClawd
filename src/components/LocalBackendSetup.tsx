import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Box, Text, useInput } from '../ink.js'
import {
  getDefaultLocalLLMConfig,
  getLocalLLMProviderLabel,
  normalizeLocalLLMConfig,
  type LocalLLMConfig,
  type LocalLLMProvider,
} from '../utils/model/providers.js'
import {
  fetchAvailableModels,
  scanLocalNetworkForVllm,
  type DiscoveredEndpoint,
  type NetworkScanProgress,
} from '../utils/model/scanModels.js'
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

// Steps in order — used for "go back" logic
type SetupStep =
  | 'provider'
  | 'networkScan'       // scanning 192.168.1.x (vLLM only)
  | 'selectEndpoint'    // pick a discovered endpoint or enter manually
  | 'baseUrl'
  | 'scanningModels'    // fetching model list from confirmed endpoint
  | 'model'
  | 'apiKey'
  | 'saveScope'

const STEP_ORDER: SetupStep[] = [
  'provider',
  'networkScan',
  'selectEndpoint',
  'baseUrl',
  'scanningModels',
  'model',
  'apiKey',
  'saveScope',
]

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
          'Confirm or edit the vLLM server URL. Press Enter to accept, Esc to go back.',
        model:
          'Select a model discovered from your vLLM server, or type a name to override.',
        apiKey:
          'Leave blank for local servers without auth, or paste the gateway token if required.',
      }
    case 'ollama':
      return {
        baseUrl:
          'Confirm the Ollama OpenAI-compatible endpoint. The default works for standard local setups.',
        model:
          'Select a model discovered from your Ollama server, or type a name to override.',
        apiKey:
          'Press Enter to keep the default Ollama token, or replace it if your proxy expects a different value.',
      }
    case 'openai':
      return {
        baseUrl:
          'Use the API base URL for OpenAI or any compatible hosted gateway.',
        model:
          'Enter the exact model ID your provider expects, such as gpt-4.1-mini.',
        apiKey:
          'Paste the API key for your hosted provider.',
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
  const [provider, setProvider] = useState<LocalLLMProvider>(normalizedInitial.provider)
  const [baseUrl, setBaseUrl] = useState(normalizedInitial.baseUrl)
  const [model, setModel] = useState(normalizedInitial.model)
  const [apiKey, setApiKey] = useState(normalizedInitial.apiKey)
  const [cursorOffset, setCursorOffset] = useState(0)
  const [error, setError] = useState<string | null>(null)

  // Model scan state
  const [availableModels, setAvailableModels] = useState<string[]>([])
  const [scanError, setScanError] = useState<string | null>(null)

  // Network scan state
  const [networkProgress, setNetworkProgress] = useState<NetworkScanProgress | null>(null)
  const [discoveredEndpoints, setDiscoveredEndpoints] = useState<DiscoveredEndpoint[]>([])
  const [networkScanDone, setNetworkScanDone] = useState(false)

  // Cancellation refs for async operations
  const networkCancelRef = useRef({ cancelled: false })
  const modelScanAbortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const nextValue =
      step === 'baseUrl' ? baseUrl : step === 'model' ? model : apiKey
    setCursorOffset(nextValue.length)
  }, [step, baseUrl, model, apiKey])

  // Handle Esc during async scanning steps
  useInput(
    (_input, key) => {
      if (!key.escape) return
      if (step === 'networkScan') {
        networkCancelRef.current.cancelled = true
        goBack()
      } else if (step === 'scanningModels') {
        modelScanAbortRef.current?.abort()
        goBack()
      }
    },
    { isActive: step === 'networkScan' || step === 'scanningModels' },
  )

  function goBack(): void {
    setError(null)
    switch (step) {
      case 'provider':
        onCancel?.()
        break
      case 'networkScan':
        networkCancelRef.current.cancelled = true
        setStep('provider')
        break
      case 'selectEndpoint':
        // Re-scan or just go back to provider
        setStep('provider')
        break
      case 'baseUrl':
        if (provider === 'vllm') {
          setStep('selectEndpoint')
        } else {
          setStep('provider')
        }
        break
      case 'scanningModels':
        modelScanAbortRef.current?.abort()
        setStep('baseUrl')
        break
      case 'model':
        setStep('baseUrl')
        break
      case 'apiKey':
        setStep('model')
        break
      case 'saveScope':
        setStep('apiKey')
        break
    }
  }

  function applyProvider(nextProvider: LocalLLMProvider): void {
    const defaults = getDefaultLocalLLMConfig(nextProvider)
    setProvider(nextProvider)
    setBaseUrl(defaults.baseUrl)
    setModel('')
    setApiKey(defaults.apiKey)
    setError(null)
    setScanError(null)
    setAvailableModels([])

    if (nextProvider === 'vllm') {
      // Start local network scan
      startNetworkScan(nextProvider)
    } else {
      setStep('baseUrl')
    }
  }

  function startNetworkScan(forProvider: LocalLLMProvider): void {
    networkCancelRef.current = { cancelled: false }
    setDiscoveredEndpoints([])
    setNetworkProgress(null)
    setNetworkScanDone(false)
    setStep('networkScan')

    scanLocalNetworkForVllm('192.168.1', networkCancelRef.current, (progress) => {
      setNetworkProgress(progress)
    }).then((endpoints) => {
      if (networkCancelRef.current.cancelled) return
      setDiscoveredEndpoints(endpoints)
      setNetworkScanDone(true)
      setStep('selectEndpoint')
    }).catch(() => {
      if (networkCancelRef.current.cancelled) return
      setDiscoveredEndpoints([])
      setNetworkScanDone(true)
      setStep('selectEndpoint')
    })
  }

  function selectEndpoint(url: string): void {
    if (url === '__manual__') {
      setStep('baseUrl')
      return
    }
    // Use the selected discovered endpoint
    setBaseUrl(url)
    setError(null)
    startModelScan(url)
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

    if (provider === 'vllm' || provider === 'ollama') {
      startModelScan(trimmed)
    } else {
      setStep('model')
    }
  }

  function startModelScan(url: string): void {
    const abort = new AbortController()
    modelScanAbortRef.current = abort
    setScanError(null)
    setAvailableModels([])
    setStep('scanningModels')

    fetchAvailableModels(url, provider, apiKey)
      .then((result) => {
        if (abort.signal.aborted) return
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
        if (abort.signal.aborted) return
        setScanError(`Unexpected error scanning models: ${err instanceof Error ? err.message : String(err)}`)
        setAvailableModels([])
        setStep('model')
      })
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
    const nextConfig = { provider, baseUrl, model, apiKey: value.trim() }
    setApiKey(nextConfig.apiKey)
    setError(null)

    if (showSaveGloballyOption) {
      setStep('saveScope')
      return
    }

    onComplete(nextConfig, { saveGlobally: true })
  }

  const providerLabel = getLocalLLMProviderLabel(provider)
  const baseUrlPlaceholder = getDefaultLocalLLMConfig(provider).baseUrl
  const apiKeyPlaceholder =
    provider === 'ollama' ? 'ollama' : 'Leave blank if your endpoint does not require auth'
  const guidance = getProviderGuidance(provider)
  const modelSelectOptions = availableModels.map((m) => ({ label: m, value: m }))

  // Build endpoint select options
  const endpointSelectOptions = [
    ...discoveredEndpoints.map((ep) => ({
      label: `${ep.url}  [${ep.models.slice(0, 2).join(', ')}${ep.models.length > 2 ? ', …' : ''}]`,
      value: ep.url,
    })),
    { label: 'Enter URL manually', value: '__manual__' },
  ]

  return (
    <Box flexDirection="column" gap={1} paddingLeft={1} width={84}>
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
            Esc exits setup. Choose a local preset for self-hosted inference, or the hosted API option for cloud providers.
          </Text>
        </>
      ) : null}

      {step === 'networkScan' ? (
        <Box flexDirection="column" gap={1}>
          <Text>
            Scanning <Text bold>192.168.1.0/24</Text> for vLLM endpoints…
          </Text>
          {networkProgress ? (
            <Text dimColor>
              {networkProgress.scanned}/{networkProgress.total} probed
              {networkProgress.found > 0 ? ` — ${networkProgress.found} found so far` : ''}
            </Text>
          ) : (
            <Text dimColor>Starting scan…</Text>
          )}
          <Text dimColor>Press Esc to skip network scan and enter URL manually.</Text>
        </Box>
      ) : null}

      {step === 'selectEndpoint' ? (
        <>
          {discoveredEndpoints.length > 0 ? (
            <>
              <Text>
                Found <Text bold>{discoveredEndpoints.length}</Text> vLLM endpoint{discoveredEndpoints.length !== 1 ? 's' : ''} on your network
              </Text>
              <Text dimColor>Select an endpoint to use, or enter the URL manually.</Text>
            </>
          ) : (
            <>
              <Text>No vLLM endpoints found on 192.168.1.0/24</Text>
              <Text dimColor>You can still enter the URL manually, or check that your server is running.</Text>
            </>
          )}
          <Select
            options={endpointSelectOptions}
            onChange={value => selectEndpoint(value)}
            onCancel={() => setStep('provider')}
          />
          <Text dimColor>Esc goes back to provider selection.</Text>
        </>
      ) : null}

      {step !== 'provider' && step !== 'networkScan' && step !== 'selectEndpoint' ? (
        <>
          <Text>
            Backend: <Text bold>{providerLabel}</Text>
          </Text>

          {step === 'baseUrl' ? (
            <>
              <Text>Endpoint base URL</Text>
              <Text dimColor>{guidance.baseUrl}</Text>
              <TextInput
                value={baseUrl}
                onChange={setBaseUrl}
                onSubmit={submitBaseUrl}
                onExit={goBack}
                placeholder={baseUrlPlaceholder}
                columns={80}
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
              <Text dimColor>Press Esc to cancel and go back.</Text>
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
                    onCancel={goBack}
                  />
                  <Text dimColor>Esc goes back to the URL step.</Text>
                </>
              ) : (
                <>
                  <Text dimColor>
                    {scanError ? 'Enter the model name manually.' : guidance.model}
                  </Text>
                  <TextInput
                    value={model}
                    onChange={setModel}
                    onSubmit={submitModel}
                    onExit={goBack}
                    placeholder={provider === 'openai' ? getDefaultLocalLLMConfig(provider).model : ''}
                    columns={80}
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
              <Text dimColor>{guidance.apiKey}</Text>
              <TextInput
                value={apiKey}
                onChange={setApiKey}
                onSubmit={submitApiKey}
                onExit={goBack}
                placeholder={apiKeyPlaceholder}
                columns={80}
                cursorOffset={cursorOffset}
                onChangeCursorOffset={setCursorOffset}
                focus
                showCursor
              />
              <Text dimColor>Esc goes back to model selection.</Text>
            </>
          ) : null}

          {step === 'saveScope' ? (
            <>
              <Text>How should localclawd use this backend?</Text>
              <Text dimColor wrap="wrap">
                Save globally to make this the default every time localclawd starts. Choose "this launch only" for a temporary override.
              </Text>
              <Select
                options={[
                  { label: 'Save as global default (recommended)', value: 'global' },
                  { label: 'Use only for this launch', value: 'session' },
                ]}
                onChange={value => {
                  onComplete({ provider, baseUrl, model, apiKey }, { saveGlobally: value === 'global' })
                }}
                onCancel={goBack}
              />
              <Text dimColor>Esc goes back to API key.</Text>
            </>
          ) : null}

          {error ? <Text color="error">{error}</Text> : null}
        </>
      ) : null}
    </Box>
  )
}
