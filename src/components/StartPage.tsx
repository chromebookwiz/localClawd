import React, { useState } from 'react'
import { Box, Text, useInput } from '../ink.js'
import type { Key } from '../ink/events/input-event.js'
import { gracefulShutdownSync } from '../utils/gracefulShutdown.js'
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

/** Robust Enter detection — catches \r (standard), \n (VSCode ConPTY ICRNL),
 *  and key.return which covers Kitty/CSI-u codepoint-13 sequences too. */
function isEnter(input: string, key: Key): boolean {
  return key.return || input === '\r' || input === '\n'
}

export function StartPage({ currentConfig, onDone }: Props): React.ReactNode {
  const hasSavedConfig = hasSavedBackendConfig(currentConfig)
  const options = hasSavedConfig ? CONTINUE_OPTIONS : SETUP_OPTIONS
  const [focusIdx, setFocusIdx] = useState(0)
  const [submitted, setSubmitted] = useState(false)

  useInput((input, key) => {
    if (submitted) return

    if (key.upArrow) {
      setFocusIdx(i => (i - 1 + options.length) % options.length)
    } else if (key.downArrow) {
      setFocusIdx(i => (i + 1) % options.length)
    } else if (isEnter(input, key)) {
      setSubmitted(true)
      onDone(options[focusIdx]!.value)
    } else if (key.escape || (key.ctrl && input === 'c')) {
      gracefulShutdownSync(0)
    }
  })

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

        <Text dimColor>↑↓ navigate · Enter confirm · Esc exit</Text>
      </Box>
    </Box>
  )
}
