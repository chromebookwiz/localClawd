import React, { useState } from 'react'
import { Box, Text, useInput } from '../ink.js'
import type { LocalLLMConfig } from '../utils/model/providers.js'
import { getLocalLLMProviderLabel } from '../utils/model/providers.js'
import { Select } from './CustomSelect/select.js'
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
  const [focused, setFocused] = useState<StartPageAction>(
    hasSavedConfig ? 'continue' : 'configure-backend',
  )

  useInput((_input, key) => {
    if (key.return) onDone(focused)
    else if (key.escape) onDone('continue')
  })

  const options = hasSavedConfig ? CONTINUE_OPTIONS : SETUP_OPTIONS

  return (
    <Box flexDirection="column" gap={1}>
      <WelcomeV2 />

      <Box flexDirection="column" gap={1} paddingLeft={1} width={78}>
        {hasSavedConfig ? (
          <>
            {/* Welcome back banner */}
            <Box flexDirection="column" gap={0}>
              <Text bold color="#818cf8">
                Welcome back!
              </Text>
              <Text dimColor>Ready when you are.</Text>
            </Box>

            {/* Saved backend card */}
            <Box
              flexDirection="column"
              borderStyle="round"
              borderColor="#6366f1"
              paddingX={2}
              paddingY={0}
              width={60}
            >
              <Box gap={2} alignItems="center">
                <Text color="#6366f1" bold>
                  {'◈'}
                </Text>
                <Text bold color="#818cf8">
                  {getLocalLLMProviderLabel(currentConfig.provider)}
                </Text>
              </Box>
              <Text dimColor>Model: <Text color="white">{currentConfig.model}</Text></Text>
              <Text dimColor>
                Endpoint: <Text color="white">{currentConfig.baseUrl}</Text>
              </Text>
            </Box>
          </>
        ) : (
          <>
            <Box flexDirection="column" gap={0}>
              <Text bold color="#818cf8">
                Let&apos;s get you connected.
              </Text>
              <Text dimColor wrap="wrap">
                localclawd needs an OpenAI-compatible backend — vLLM, Ollama, or any hosted
                gateway. Set one up now and you&apos;re ready to code.
              </Text>
            </Box>

            <Box paddingX={1}>
              <Text color="#6366f1">{'▸'}</Text>
              <Text dimColor>
                {' '}Vision works automatically when your model accepts image content.
              </Text>
            </Box>
          </>
        )}

        <Select
          options={options}
          onChange={value => onDone(value as StartPageAction)}
          onCancel={() => onDone('continue')}
          onFocus={value => setFocused(value as StartPageAction)}
        />
        <Text dimColor>↑↓ to navigate · Enter to confirm · Esc to continue</Text>
      </Box>
    </Box>
  )
}
