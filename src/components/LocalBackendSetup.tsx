import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Box, Text, useInput } from '../ink.js'
import type { Key } from '../ink/events/input-event.js'
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
import { TriangleSpinner } from './Spinner/TriangleSpinner.js'
import TextInput from './TextInput.js'

type Props = {
  initialConfig?: Partial<LocalLLMConfig>
  onComplete(config: LocalLLMConfig, options?: { saveGlobally: boolean }): void
  onCancel?(): void
  title?: string
  description?: string
  showSaveGloballyOption?: boolean
}

type SetupStep =
  | 'provider'
  | 'networkScan'
  | 'selectEndpoint'
  | 'baseUrl'
  | 'scanningModels'
  | 'model'
  | 'apiKey'
  | 'saveScope'

type MenuItem<T> = { label: string; value: T }

/** Robust Enter detection — catches \r (standard), \n (VSCode ConPTY ICRNL),
 *  and key.return which covers Kitty/CSI-u codepoint-13 sequences too. */
function isEnter(input: string, key: Key): boolean {
  return key.return || input === '\r' || input === '\n'
}

// ─── Simple hand-rolled scrollable menu ──────────────────────────────────────
// Uses plain useInput — no keybinding system, no ChordInterceptor, no Select.
// isActive controls whether this menu responds to keypresses.

type SimpleMenuProps<T> = {
  items: MenuItem<T>[]
  isActive: boolean
  onSelect(value: T): void
  onCancel?(): void
}

function SimpleMenu<T>({ items, isActive, onSelect, onCancel }: SimpleMenuProps<T>): React.ReactNode {
  const VISIBLE = Math.min(7, items.length)
  const [focusIdx, setFocusIdx] = useState(0)
  const [fromIdx, setFromIdx] = useState(0)
  // Guard: prevent double-fire when Enter arrives before React re-renders
  // with the new step (which would flip isActive to false).
  const [submitted, setSubmitted] = useState(false)

  useInput((input, key) => {
    if (!isActive || submitted) return

    if (key.upArrow) {
      setFocusIdx(prev => {
        const next = Math.max(0, prev - 1)
        if (next < fromIdx) setFromIdx(next)
        return next
      })
    } else if (key.downArrow) {
      setFocusIdx(prev => {
        const next = Math.min(items.length - 1, prev + 1)
        if (next >= fromIdx + VISIBLE) setFromIdx(next - VISIBLE + 1)
        return next
      })
    } else if (isEnter(input, key)) {
      const item = items[focusIdx]
      if (item) {
        setSubmitted(true)
        onSelect(item.value)
      }
    } else if (key.escape || (key.ctrl && input === 'c')) {
      onCancel?.()
    }
  }, { isActive })

  const visible = items.slice(fromIdx, fromIdx + VISIBLE)
  const showScrollUp = fromIdx > 0
  const showScrollDown = fromIdx + VISIBLE < items.length

  return (
    <Box flexDirection="column">
      {showScrollUp && <Text dimColor>  ↑ more</Text>}
      {visible.map((item, i) => {
        const absIdx = fromIdx + i
        const focused = absIdx === focusIdx
        return (
          <Box key={String(item.value)} gap={1}>
            <Text color="#6366f1">{focused ? '▶' : ' '}</Text>
            <Text bold={focused} color={focused ? '#818cf8' : undefined}>
              {item.label}
            </Text>
          </Box>
        )
      })}
      {showScrollDown && <Text dimColor>  ↓ more</Text>}
    </Box>
  )
}

// ─── Provider options ─────────────────────────────────────────────────────────

const PROVIDER_OPTIONS: MenuItem<LocalLLMProvider>[] = [
  { label: 'Local vLLM server (recommended for self-hosted inference)', value: 'vllm' },
  { label: 'Local Ollama server', value: 'ollama' },
  { label: 'Hosted OpenAI-compatible API or gateway', value: 'openai' },
]

function getProviderGuidance(provider: LocalLLMProvider) {
  switch (provider) {
    case 'vllm':
      return {
        baseUrl: 'Confirm or edit the vLLM server URL. Enter to accept, Esc to go back.',
        model: 'Select a model discovered from your vLLM server, or type a name to override.',
        apiKey: 'Leave blank for local servers without auth, or paste the gateway token if required.',
      }
    case 'ollama':
      return {
        baseUrl: 'Confirm the Ollama endpoint. The default works for standard local setups.',
        model: 'Select a model discovered from your Ollama server, or type a name to override.',
        apiKey: 'Press Enter to keep the default Ollama token, or replace it if your proxy expects a different value.',
      }
    case 'openai':
      return {
        baseUrl: 'Use the API base URL for OpenAI or any compatible hosted gateway.',
        model: 'Enter the exact model ID your provider expects, such as gpt-4.1-mini.',
        apiKey: 'Paste the API key for your hosted provider.',
      }
  }
}

// ─── Main component ───────────────────────────────────────────────────────────

export function LocalBackendSetup({
  initialConfig,
  onComplete,
  onCancel,
  title = 'Configure your model backend',
  description = 'localclawd speaks to OpenAI-compatible chat completion APIs. Pick a backend, then confirm the endpoint and model to use.',
  showSaveGloballyOption = false,
}: Props): React.ReactNode {
  const normalizedInitial = useMemo(() => normalizeLocalLLMConfig(initialConfig), [initialConfig])

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

  const networkAbortRef = useRef<AbortController | null>(null)
  const modelScanAbortRef = useRef<AbortController | null>(null)
  const discoveredSnapshotRef = useRef<DiscoveredEndpoint[]>([])
  // Guard against double-fire in scan step handlers (same race as SimpleMenu)
  const scanStepDoneRef = useRef(false)

  useEffect(() => {
    return () => {
      networkAbortRef.current?.abort()
      modelScanAbortRef.current?.abort()
    }
  }, [])

  // Reset scan step guard whenever the step changes
  useEffect(() => {
    scanStepDoneRef.current = false
  }, [step])

  useEffect(() => {
    const nextValue = step === 'baseUrl' ? baseUrl : step === 'model' ? model : apiKey
    setCursorOffset(nextValue.length)
  }, [step, baseUrl, model, apiKey])

  // Handle Esc/Enter during async scanning steps.
  useInput(
    (input, key) => {
      if (scanStepDoneRef.current) return
      if (step === 'networkScan') {
        if (key.escape || isEnter(input, key)) {
          scanStepDoneRef.current = true
          networkAbortRef.current?.abort()
          setDiscoveredEndpoints(discoveredSnapshotRef.current)
          setStep('selectEndpoint')
        }
      } else if (step === 'scanningModels') {
        if (key.escape) {
          scanStepDoneRef.current = true
          modelScanAbortRef.current?.abort()
          goBack()
        } else if (isEnter(input, key)) {
          scanStepDoneRef.current = true
          modelScanAbortRef.current?.abort()
          setScanError('Model scan skipped. Enter the model name manually.')
          setAvailableModels([])
          setStep('model')
        }
      }
    },
    { isActive: step === 'networkScan' || step === 'scanningModels' },
  )

  function goBack(): void {
    setError(null)
    switch (step) {
      case 'provider': onCancel?.(); break
      case 'networkScan': networkAbortRef.current?.abort(); setStep('provider'); break
      case 'selectEndpoint': setStep('provider'); break
      case 'baseUrl': setStep(provider === 'vllm' ? 'selectEndpoint' : 'provider'); break
      case 'scanningModels': modelScanAbortRef.current?.abort(); setStep('baseUrl'); break
      case 'model': setStep('baseUrl'); break
      case 'apiKey': setStep('model'); break
      case 'saveScope': setStep('apiKey'); break
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
    setDiscoveredEndpoints([])
    if (nextProvider === 'vllm') startNetworkScan(defaults.baseUrl)
    else setStep('baseUrl')
  }

  function startNetworkScan(defaultUrl: string): void {
    networkAbortRef.current?.abort()
    const abort = new AbortController()
    networkAbortRef.current = abort
    discoveredSnapshotRef.current = []
    setDiscoveredEndpoints([])
    setNetworkProgress(null)
    setStep('networkScan')

    scanLocalNetworkForVllm('192.168.1', abort.signal, (progress) => {
      if (abort.signal.aborted) return
      discoveredSnapshotRef.current = [...discoveredSnapshotRef.current]
      setNetworkProgress(progress)
    }).then((endpoints) => {
      if (abort.signal.aborted) return
      discoveredSnapshotRef.current = endpoints
      setDiscoveredEndpoints(endpoints)
      setStep('selectEndpoint')
    }).catch(() => {
      if (abort.signal.aborted) return
      setDiscoveredEndpoints([])
      setStep('selectEndpoint')
    })
  }

  function selectEndpoint(url: string): void {
    if (url === '__manual__') { setStep('baseUrl'); return }
    setBaseUrl(url)
    setError(null)
    startModelScan(url)
  }

  function submitBaseUrl(value: string): void {
    const trimmed = value.trim()
    if (!trimmed) { setError('Base URL is required.'); return }
    try { new URL(trimmed) } catch { setError('Base URL must include a valid scheme such as http:// or https://.'); return }
    setBaseUrl(trimmed)
    setError(null)
    if (provider === 'vllm' || provider === 'ollama') startModelScan(trimmed)
    else setStep('model')
  }

  function startModelScan(url: string): void {
    modelScanAbortRef.current?.abort()
    const abort = new AbortController()
    modelScanAbortRef.current = abort
    setScanError(null)
    setAvailableModels([])
    setStep('scanningModels')

    fetchAvailableModels(url, provider, apiKey, abort.signal)
      .then((result) => {
        if (abort.signal.aborted) return
        if (result.ok === true) { setAvailableModels(result.models); setScanError(null) }
        else { setScanError(result.ok === false ? result.error : 'Scan failed'); setAvailableModels([]) }
        setStep('model')
      })
      .catch((err) => {
        if (abort.signal.aborted) return
        setScanError(`Unexpected error: ${err instanceof Error ? err.message : String(err)}`)
        setAvailableModels([])
        setStep('model')
      })
  }

  function submitModel(value: string): void {
    const trimmed = value.trim()
    if (!trimmed) { setError('Model name is required.'); return }
    setModel(trimmed)
    setError(null)
    setStep('apiKey')
  }

  function submitApiKey(value: string): void {
    const nextConfig = { provider, baseUrl, model, apiKey: value.trim() }
    setApiKey(nextConfig.apiKey)
    setError(null)
    if (showSaveGloballyOption) { setStep('saveScope'); return }
    onComplete(nextConfig, { saveGlobally: true })
  }

  const providerLabel = getLocalLLMProviderLabel(provider)
  const baseUrlPlaceholder = getDefaultLocalLLMConfig(provider).baseUrl
  const apiKeyPlaceholder = provider === 'ollama' ? 'ollama' : 'Leave blank if your endpoint does not require auth'
  const guidance = getProviderGuidance(provider)

  const modelMenuItems: MenuItem<string>[] = availableModels.map(m => ({ label: m, value: m }))

  const endpointMenuItems: MenuItem<string>[] = [
    ...discoveredEndpoints.map(ep => ({
      label: `${ep.url}  [${ep.models.slice(0, 2).join(', ')}${ep.models.length > 2 ? ', …' : ''}]`,
      value: ep.url,
    })),
    { label: 'Enter URL manually', value: '__manual__' },
  ]

  const saveScopeItems: MenuItem<string>[] = [
    { label: 'Save as global default (recommended)', value: 'global' },
    { label: 'Use only for this launch', value: 'session' },
  ]

  return (
    <Box flexDirection="column" gap={1} paddingLeft={1} width={84}>
      <Text bold>{title}</Text>
      <Text dimColor wrap="wrap">{description}</Text>

      {step === 'provider' ? (
        <>
          <Text dimColor>Choose a backend:</Text>
          <SimpleMenu
            items={PROVIDER_OPTIONS}
            isActive={step === 'provider'}
            onSelect={value => applyProvider(value)}
            onCancel={onCancel}
          />
          <Text dimColor>↑↓ navigate · Enter select · Esc exit</Text>
        </>
      ) : null}

      {step === 'networkScan' ? (
        <Box flexDirection="column" gap={1}>
          <Box gap={1}>
            <TriangleSpinner />
            <Text>Scanning <Text bold>192.168.1.0/24</Text> for vLLM endpoints</Text>
          </Box>
          {networkProgress ? (
            <Text dimColor>
              {networkProgress.scanned}/{networkProgress.total} hosts probed
              {networkProgress.found > 0 ? ` · ${networkProgress.found} found` : ''}
            </Text>
          ) : (
            <Text dimColor>Starting…</Text>
          )}
          <Text dimColor>Enter to use results so far · Esc to go back</Text>
        </Box>
      ) : null}

      {step === 'selectEndpoint' ? (
        <>
          {discoveredEndpoints.length > 0 ? (
            <Text>
              Found <Text bold>{discoveredEndpoints.length}</Text> vLLM endpoint
              {discoveredEndpoints.length !== 1 ? 's' : ''} on 192.168.1.0/24
            </Text>
          ) : (
            <Text dimColor>No vLLM endpoints found on 192.168.1.0/24 — enter the URL manually.</Text>
          )}
          <SimpleMenu
            items={endpointMenuItems}
            isActive={step === 'selectEndpoint'}
            onSelect={value => selectEndpoint(value)}
            onCancel={() => setStep('provider')}
          />
          <Text dimColor>↑↓ navigate · Enter select · Esc back to provider</Text>
        </>
      ) : null}

      {step !== 'provider' && step !== 'networkScan' && step !== 'selectEndpoint' ? (
        <>
          <Text>Backend: <Text bold>{providerLabel}</Text></Text>

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
              <Box gap={1}>
                <TriangleSpinner />
                <Text>Scanning models at <Text bold>{baseUrl}</Text></Text>
              </Box>
              <Text dimColor>Enter to skip and type manually · Esc to go back</Text>
            </Box>
          ) : null}

          {step === 'model' ? (
            <>
              <Text>Model</Text>
              {scanError ? <Text color="yellow" wrap="wrap">{scanError}</Text> : null}
              {availableModels.length > 0 ? (
                <>
                  <Text dimColor>{guidance.model}</Text>
                  <SimpleMenu
                    items={modelMenuItems}
                    isActive={step === 'model'}
                    onSelect={value => submitModel(value)}
                    onCancel={goBack}
                  />
                  <Text dimColor>↑↓ navigate · Enter select · Esc back to URL</Text>
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
              <Text dimColor>Enter to confirm · Esc back to model</Text>
            </>
          ) : null}

          {step === 'saveScope' ? (
            <>
              <Text>How should localclawd use this backend?</Text>
              <Text dimColor wrap="wrap">
                Save globally to make this the default every time localclawd starts.
                Choose "this launch only" for a temporary override.
              </Text>
              <SimpleMenu
                items={saveScopeItems}
                isActive={step === 'saveScope'}
                onSelect={value => {
                  onComplete({ provider, baseUrl, model, apiKey }, { saveGlobally: value === 'global' })
                }}
                onCancel={goBack}
              />
              <Text dimColor>↑↓ navigate · Enter confirm · Esc back to API key</Text>
            </>
          ) : null}

          {error ? <Text color="red">{error}</Text> : null}
        </>
      ) : null}
    </Box>
  )
}
