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
} from '../utils/model/scanModels.js'
import {
  commonPresetsForProvider,
  loadEndpointHistory,
  recordEndpointUse,
  type EndpointHistoryEntry,
} from '../utils/model/endpointHistory.js'
import {
  detectTailscalePeers,
  defaultPortForProvider,
  urlsForPeer,
  type TailscalePeer,
} from '../utils/model/tailscaleDetect.js'
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
  | 'pickUrl'           // shows presets + history, or "enter manually"
  | 'baseUrl'
  | 'scanningModels'
  | 'model'
  | 'apiKey'
  | 'saveScope'

type MenuItem<T> = { label: string; value: T }

// ─── Simple hand-rolled scrollable menu ──────────────────────────────────────

type SimpleMenuProps<T> = {
  items: MenuItem<T>[]
  isActive: boolean
  onSelect(value: T): void
  onCancel?(): void
}

function SimpleMenu<T>({ items, isActive, onSelect, onCancel }: SimpleMenuProps<T>): React.ReactNode {
  const VISIBLE = Math.min(8, items.length)
  const [focusIdx, setFocusIdx] = useState(0)
  const [fromIdx, setFromIdx] = useState(0)
  const doneRef = useRef(false)

  useInput((input, key) => {
    if (!isActive || doneRef.current) return

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
    } else if (key.return) {
      const item = items[focusIdx]
      if (item) {
        doneRef.current = true
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
          <Box key={`${String(item.value)}-${i}`} gap={1}>
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
  { label: 'Local endpoint (vLLM / LM Studio / any OpenAI-compatible server)', value: 'vllm' },
  { label: 'Local Ollama server', value: 'ollama' },
  { label: 'Hosted OpenAI-compatible API or gateway', value: 'openai' },
]

function getProviderGuidance(provider: LocalLLMProvider) {
  switch (provider) {
    case 'vllm':
      return {
        baseUrl: 'Enter the URL of your server. For mDNS-enabled LANs use http://<hostname>.local:<port>/v1.',
        model: 'Select a model discovered from your server, or type a name to override.',
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
  description = 'localclawd speaks to OpenAI-compatible chat completion APIs. Pick a backend, confirm the URL, and select a model.',
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

  // Endpoint history + presets
  const [history, setHistory] = useState<EndpointHistoryEntry[]>([])

  // Tailscale peers (lazy-loaded on provider selection)
  const [tailscalePeers, setTailscalePeers] = useState<TailscalePeer[]>([])
  const [tailscaleLoaded, setTailscaleLoaded] = useState(false)

  const modelScanAbortRef = useRef<AbortController | null>(null)
  const scanStepDoneRef = useRef(false)
  const prevStepRef = useRef<SetupStep>(step)

  useEffect(() => {
    void loadEndpointHistory().then(setHistory)
  }, [])

  useEffect(() => () => modelScanAbortRef.current?.abort(), [])

  useEffect(() => { scanStepDoneRef.current = false }, [step])

  // Only reset cursor when the step actually changes — not on every keystroke.
  // Without this guard, backspacing in the URL field snaps the cursor to the
  // end of the line on every character delete.
  useEffect(() => {
    if (prevStepRef.current === step) return
    prevStepRef.current = step
    const nextValue = step === 'baseUrl' ? baseUrl : step === 'model' ? model : apiKey
    setCursorOffset(nextValue.length)
  }, [step, baseUrl, model, apiKey])

  useInput(
    (_input, key) => {
      if (scanStepDoneRef.current) return
      if (step === 'scanningModels') {
        if (key.escape) {
          scanStepDoneRef.current = true
          modelScanAbortRef.current?.abort()
          goBack()
        } else if (key.return) {
          scanStepDoneRef.current = true
          modelScanAbortRef.current?.abort()
          setScanError('Model scan skipped. Enter the model name manually.')
          setAvailableModels([])
          setStep('model')
        }
      }
    },
    { isActive: step === 'scanningModels' },
  )

  function goBack(): void {
    setError(null)
    switch (step) {
      case 'provider': onCancel?.(); break
      case 'pickUrl': setStep('provider'); break
      case 'baseUrl': setStep('pickUrl'); break
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
    // Go straight to the preset/history picker — no network scan
    setStep('pickUrl')
    // Kick off Tailscale detection in the background (only once per mount)
    if (!tailscaleLoaded) {
      setTailscaleLoaded(true)
      void detectTailscalePeers().then(setTailscalePeers)
    }
  }

  function pickUrl(url: string): void {
    if (url === '__manual__') { setStep('baseUrl'); return }
    // Sanitize — strip <hostname> placeholder if user selected a template row
    if (url.includes('<hostname>')) { setStep('baseUrl'); return }
    setBaseUrl(url)
    setError(null)
    startModelScan(url)
  }

  function submitBaseUrl(value: string): void {
    const trimmed = value.trim()
    if (!trimmed) { setError('Base URL is required.'); return }
    try { new URL(trimmed) } catch {
      setError('Base URL must include a valid scheme such as http:// or https://.')
      return
    }
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
    // Record in history once we have a working URL — best-effort
    void recordEndpointUse(baseUrl, provider)
    if (showSaveGloballyOption) { setStep('saveScope'); return }
    onComplete(nextConfig, { saveGlobally: true })
  }

  const providerLabel = getLocalLLMProviderLabel(provider)
  const baseUrlPlaceholder = getDefaultLocalLLMConfig(provider).baseUrl
  const apiKeyPlaceholder = provider === 'ollama' ? 'ollama' : 'Leave blank if your endpoint does not require auth'
  const guidance = getProviderGuidance(provider)

  const modelMenuItems: MenuItem<string>[] = availableModels.map(m => ({ label: m, value: m }))

  // Build the URL-picker menu:
  //   1. Recent history (matching provider)
  //   2. Tailscale peers (if tailscale is installed + some peers are online)
  //   3. Common presets
  //   4. "Enter URL manually"
  const matchingHistory = history.filter(h => h.provider === provider).slice(0, 5)
  const presets = commonPresetsForProvider(provider)
  const tailscalePort = defaultPortForProvider(provider)
  const tailscaleItems: MenuItem<string>[] = []
  for (const peer of tailscalePeers) {
    // Only surface the short hostname URL in the picker — keeps the list
    // compact. DNSName and IP are still reachable if the user types them.
    const urls = urlsForPeer(peer, tailscalePort)
    const primary = urls[0]
    if (primary) {
      tailscaleItems.push({
        label: `🔗 ${primary.label}  →  ${primary.url}`,
        value: primary.url,
      })
    }
  }

  const seen = new Set<string>()
  const urlPickerItems: MenuItem<string>[] = []
  for (const h of matchingHistory) {
    if (seen.has(h.url)) continue
    seen.add(h.url)
    const when = timeAgo(h.lastUsed)
    urlPickerItems.push({ label: `${h.url}   (used ${when})`, value: h.url })
  }
  for (const t of tailscaleItems) {
    if (seen.has(t.value)) continue
    seen.add(t.value)
    urlPickerItems.push(t)
  }
  for (const p of presets) {
    if (seen.has(p)) continue
    seen.add(p)
    urlPickerItems.push({ label: p, value: p })
  }
  urlPickerItems.push({ label: 'Enter URL manually', value: '__manual__' })

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

      {step === 'pickUrl' ? (
        <>
          <Text>Pick an endpoint URL, or enter one manually:</Text>
          <Text dimColor wrap="wrap">
            Tip: for a LAN machine use its mDNS name (http://my-box.local:8000/v1)
            or IP. Tailscale peers show up automatically (🔗) if tailscale is installed.
          </Text>
          <SimpleMenu
            items={urlPickerItems}
            isActive={step === 'pickUrl'}
            onSelect={value => pickUrl(value)}
            onCancel={() => setStep('provider')}
          />
          <Text dimColor>↑↓ navigate · Enter select · Esc back to provider</Text>
        </>
      ) : null}

      {step !== 'provider' && step !== 'pickUrl' ? (
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
                <Text>Connecting to <Text bold>{baseUrl}</Text></Text>
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

function timeAgo(timestamp: number): string {
  const sec = Math.max(0, Math.floor((Date.now() - timestamp) / 1000))
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const d = Math.floor(hr / 24)
  return `${d}d ago`
}
