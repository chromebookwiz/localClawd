import React, { useState, useEffect, useRef } from 'react'
import { Box, Text } from '../ink.js'
import type { LocalLLMConfig } from '../utils/model/providers.js'
import { getLocalLLMProviderLabel } from '../utils/model/providers.js'
import { WelcomeV2 } from './LogoV2/WelcomeV2.js'

export type StartPageAction = 'continue' | 'configure-backend'

type Props = {
  currentConfig?: Partial<LocalLLMConfig>
  onDone(action: StartPageAction): void
}

function hasSavedBackendConfig(
  config?: Partial<LocalLLMConfig>,
): config is Partial<LocalLLMConfig> &
  Pick<LocalLLMConfig, 'provider' | 'baseUrl' | 'model'> {
  return Boolean(config?.provider && config?.baseUrl?.trim() && config?.model?.trim())
}

const CONTINUE_OPTIONS: Array<{ label: string; value: StartPageAction }> = [
  { label: 'Continue to dashboard', value: 'continue' },
  { label: 'Change backend', value: 'configure-backend' },
]

const SETUP_OPTIONS: Array<{ label: string; value: StartPageAction }> = [
  { label: 'Set up a backend now', value: 'configure-backend' },
  { label: 'Skip for now', value: 'continue' },
]

export function StartPage({ currentConfig, onDone }: Props): React.ReactNode {
  const hasSavedConfig = hasSavedBackendConfig(currentConfig)
  const options = hasSavedConfig ? CONTINUE_OPTIONS : SETUP_OPTIONS

  const [focusIdx, setFocusIdx] = useState(0)

  // Use a ref so the stdin handler always reads the latest focusIdx without
  // needing to be re-registered on every state change.
  const stateRef = useRef({ focusIdx: 0, done: false, options })
  stateRef.current.options = options

  useEffect(() => {
    // Ensure stdin is flowing so 'data' events fire.
    if (!process.stdin.readableFlowing) {
      process.stdin.resume()
    }

    const onData = (chunk: Buffer | string) => {
      const str = typeof chunk === 'string' ? chunk : chunk.toString('utf8')

      if (str === '\x1b[A' || str === '\x1bOA') {
        // Up arrow
        const next = (stateRef.current.focusIdx - 1 + stateRef.current.options.length) % stateRef.current.options.length
        stateRef.current.focusIdx = next
        setFocusIdx(next)
      } else if (str === '\x1b[B' || str === '\x1bOB') {
        // Down arrow
        const next = (stateRef.current.focusIdx + 1) % stateRef.current.options.length
        stateRef.current.focusIdx = next
        setFocusIdx(next)
      } else if (str === '\r' || str === '\n' || str === '\r\n') {
        // Enter — guard against double-fire
        if (stateRef.current.done) return
        stateRef.current.done = true
        const chosen = stateRef.current.options[stateRef.current.focusIdx]
        if (chosen) onDone(chosen.value)
      }
    }

    process.stdin.on('data', onData)
    return () => {
      process.stdin.off('data', onData)
    }
  }, [onDone])

  return (
    <Box flexDirection="column" gap={1}>
      <WelcomeV2 />

      <Box flexDirection="column" gap={1} paddingLeft={1} width={78}>
        {hasSavedConfig ? (
          <>
            <Box flexDirection="column">
              <Text bold color="#818cf8">Welcome back!</Text>
              <Text dimColor>Ready when you are.</Text>
            </Box>

            <Box
              flexDirection="column"
              borderStyle="round"
              borderColor="#6366f1"
              paddingX={2}
              paddingY={0}
              width={60}
            >
              <Box gap={2}>
                <Text color="#6366f1" bold>{'◈'}</Text>
                <Text bold color="#818cf8">
                  {getLocalLLMProviderLabel(currentConfig.provider)}
                </Text>
              </Box>
              <Text dimColor>
                Model: <Text color="white">{currentConfig.model}</Text>
              </Text>
              <Text dimColor>
                Endpoint: <Text color="white">{currentConfig.baseUrl}</Text>
              </Text>
            </Box>
          </>
        ) : (
          <Box flexDirection="column" gap={0}>
            <Text bold color="#818cf8">{"Let's get you connected."}</Text>
            <Text dimColor wrap="wrap">
              {"localclawd needs an OpenAI-compatible backend — vLLM, Ollama, or any hosted gateway."}
            </Text>
          </Box>
        )}

        <Box flexDirection="column">
          {options.map((opt, i) => (
            <Box key={opt.value} gap={1}>
              <Text color="#6366f1">{i === focusIdx ? '▶' : ' '}</Text>
              <Text bold={i === focusIdx} color={i === focusIdx ? '#818cf8' : undefined}>
                {opt.label}
              </Text>
            </Box>
          ))}
        </Box>

        <Text dimColor>↑↓ navigate · Enter confirm</Text>
      </Box>
    </Box>
  )
}
