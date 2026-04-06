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

const OPTIONS: Array<{ label: string; value: StartPageAction }> = [
  { label: 'Continue to dashboard', value: 'continue' },
  { label: 'Configure model backend', value: 'configure-backend' },
]

export function StartPage({ currentConfig, onDone }: Props): React.ReactNode {
  const hasSavedConfig = hasSavedBackendConfig(currentConfig)
  // Track the focused option from Select so Enter always knows what to confirm
  const [focused, setFocused] = useState<StartPageAction>('continue')

  // Direct fallback input handler — guarantees responsiveness even if the
  // keybinding system doesn't fire its handler for Enter/Esc.
  useInput((_input, key) => {
    if (key.return) onDone(focused)
    else if (key.escape) onDone('continue')
  })

  return (
    <Box flexDirection="column" gap={1}>
      <WelcomeV2 />
      <Box flexDirection="column" gap={1} paddingLeft={1} width={78}>
        <Text bold>Connect a model backend</Text>
        <Text dimColor wrap="wrap">
          localclawd works with vLLM, Ollama, and other OpenAI-compatible endpoints.
          Start your model server, then configure the endpoint and model you want to use.
        </Text>
        {hasSavedConfig ? (
          <Box flexDirection="column">
            <Text>
              Saved default:{' '}
              <Text bold>{getLocalLLMProviderLabel(currentConfig.provider)}</Text>
            </Text>
            <Text dimColor>Model: {currentConfig.model}</Text>
            <Text dimColor>Endpoint: {currentConfig.baseUrl}</Text>
          </Box>
        ) : (
          <Text dimColor wrap="wrap">
            No global backend saved yet — configure one now or come back later with /provider.
          </Text>
        )}
        <Select
          options={OPTIONS}
          onChange={value => onDone(value as StartPageAction)}
          onCancel={() => onDone('continue')}
          onFocus={value => setFocused(value as StartPageAction)}
        />
        <Text dimColor>↑↓ to navigate · Enter or Ctrl+C to confirm</Text>
      </Box>
    </Box>
  )
}
