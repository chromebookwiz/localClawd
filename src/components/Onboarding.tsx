import React, { useCallback, useMemo, useState } from 'react'
import {
  setupTerminal,
  shouldOfferTerminalSetup,
} from '../commands/terminalSetup/terminalSetup.js'
import { Box, Newline, Text, useInput, useTheme } from '../ink.js'
import { getGlobalConfig, saveGlobalConfig } from '../utils/config.js'
import {
  COMPACT_CONTEXT_WINDOW_CHOICES,
  formatCompactContextWindowOption,
} from '../utils/context.js'
import { env } from '../utils/env.js'
import {
  clearSessionLocalLLMConfigOverride,
  setSessionLocalLLMConfigOverride,
  type LocalLLMConfig,
} from '../utils/model/providers.js'
import { THEME_SETTINGS, type ThemeSetting } from '../utils/theme.js'
import { LocalBackendSetup } from './LocalBackendSetup.js'
import { WelcomeV2 } from './LogoV2/WelcomeV2.js'
import { OrderedList } from './ui/OrderedList.js'

// ─── Simple hand-rolled menu (no Select, no KeybindingSetup) ─────────────────

type MenuItem<T> = { label: string; value: T }

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

  useInput((input, key) => {
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
      if (item) onSelect(item.value)
    } else if (key.escape || (key.ctrl && input === 'c')) {
      onCancel?.()
    }
  }, { isActive })

  const visible = items.slice(fromIdx, fromIdx + VISIBLE)

  return (
    <Box flexDirection="column">
      {fromIdx > 0 && <Text dimColor>  ↑ more</Text>}
      {visible.map((item, i) => {
        const absIdx = fromIdx + i
        const focused = absIdx === focusIdx
        return (
          <Box key={String(item.value)} gap={1}>
            <Text color="#6366f1">{focused ? '▶' : ' '}</Text>
            <Text bold={focused} color={focused ? '#818cf8' : undefined}>{item.label}</Text>
          </Box>
        )
      })}
      {fromIdx + VISIBLE < items.length && <Text dimColor>  ↓ more</Text>}
    </Box>
  )
}

// ─── Press-Enter-to-continue with working Enter handler ──────────────────────

type PressEnterProps = { isActive: boolean; onContinue(): void }

function PressEnterToContinue({ isActive, onContinue }: PressEnterProps): React.ReactNode {
  useInput((_input, key) => {
    if (key.return) onContinue()
  }, { isActive })

  return (
    <Text color="permission">
      Press <Text bold>Enter</Text> to continue…
    </Text>
  )
}

// ─── Step IDs ─────────────────────────────────────────────────────────────────

type StepId = 'theme' | 'compact-context' | 'local-backend' | 'security' | 'terminal-setup'

type Props = {
  onDone(): void
  showWelcome?: boolean
}

// ─── Main component ───────────────────────────────────────────────────────────

export function Onboarding({ onDone, showWelcome = true }: Props): React.ReactNode {
  const [currentStepIndex, setCurrentStepIndex] = useState(0)
  const [theme, setTheme] = useTheme()

  const goToNextStep = useCallback(() => {
    setCurrentStepIndex(current => {
      if (current >= steps.length - 1) { onDone(); return current }
      return current + 1
    })
  }, [onDone])

  const handleThemeSelection = useCallback(
    (newTheme: ThemeSetting) => { setTheme(newTheme); goToNextStep() },
    [goToNextStep, setTheme],
  )

  const handleLocalBackendSetup = useCallback(
    (config: LocalLLMConfig, options?: { saveGlobally: boolean }) => {
      if (options?.saveGlobally === false) {
        setSessionLocalLLMConfigOverride(config)
      } else {
        clearSessionLocalLLMConfigOverride()
        saveGlobalConfig(current => ({
          ...current,
          localBackendProvider: config.provider,
          localBackendBaseUrl: config.baseUrl,
          localBackendModel: config.model,
          localBackendApiKey: config.apiKey,
        }))
      }
      goToNextStep()
    },
    [goToNextStep],
  )

  const themeItems: MenuItem<ThemeSetting>[] = THEME_SETTINGS.map(s => ({
    label: s === 'auto' ? 'Auto (follow system)' : s,
    value: s,
  }))

  const compactItems: MenuItem<string>[] = [
    {
      label: `${formatCompactContextWindowOption(undefined)} (recommended)`,
      value: 'default',
    },
    ...COMPACT_CONTEXT_WINDOW_CHOICES.map(tokens => ({
      label: formatCompactContextWindowOption(tokens),
      value: String(tokens),
    })),
  ]

  const steps = useMemo<Array<{ id: StepId; component: (isActive: boolean) => React.ReactNode }>>(() => {
    const config = getGlobalConfig()

    const result: Array<{ id: StepId; component: (isActive: boolean) => React.ReactNode }> = [
      {
        id: 'theme',
        component: (isActive) => (
          <Box flexDirection="column" gap={1} paddingLeft={1}>
            <Text bold>Choose a theme</Text>
            <SimpleMenu
              items={themeItems}
              isActive={isActive}
              onSelect={handleThemeSelection}
              onCancel={goToNextStep}
            />
            <Text dimColor>Change later with /theme</Text>
          </Box>
        ),
      },
      {
        id: 'compact-context',
        component: (isActive) => (
          <Box flexDirection="column" gap={1} paddingLeft={1} width={70}>
            <Text bold>Choose a compact context window</Text>
            <Text dimColor wrap="wrap">
              localclawd can compact earlier than the model&apos;s full advertised
              window. Useful for local models that degrade before hitting their limit.
            </Text>
            <SimpleMenu
              items={compactItems}
              isActive={isActive}
              onSelect={value => {
                const compactContextWindowTokens =
                  value === 'default' ? undefined : parseInt(value, 10)
                saveGlobalConfig(current => ({ ...current, compactContextWindowTokens }))
                goToNextStep()
              }}
              onCancel={goToNextStep}
            />
            <Text dimColor>Change later in /config under Compact context window.</Text>
          </Box>
        ),
      },
      {
        id: 'local-backend',
        component: (_isActive) => (
          <LocalBackendSetup
            initialConfig={{
              provider: config.localBackendProvider,
              baseUrl: config.localBackendBaseUrl,
              model: config.localBackendModel,
              apiKey: config.localBackendApiKey,
            }}
            onComplete={handleLocalBackendSetup}
            onCancel={goToNextStep}
            title="Choose your local backend"
            description="Set the OpenAI-compatible endpoint and model localclawd should use. You can point it at vLLM, Ollama, or any compatible host."
            showSaveGloballyOption={true}
          />
        ),
      },
      {
        id: 'security',
        component: (isActive) => (
          <Box flexDirection="column" gap={1} paddingLeft={1}>
            <Text bold>Security notes:</Text>
            <Box flexDirection="column" width={70}>
              <OrderedList>
                <OrderedList.Item>
                  <Text>localclawd can make mistakes</Text>
                  <Text dimColor wrap="wrap">
                    Always review responses, especially when running code.<Newline />
                  </Text>
                </OrderedList.Item>
                <OrderedList.Item>
                  <Text>Due to prompt injection risks, only use it with code you trust</Text>
                </OrderedList.Item>
              </OrderedList>
            </Box>
            <PressEnterToContinue isActive={isActive} onContinue={goToNextStep} />
          </Box>
        ),
      },
    ]

    if (shouldOfferTerminalSetup()) {
      const terminalItems: MenuItem<string>[] = [
        { label: 'Yes, use recommended settings', value: 'install' },
        { label: 'No, maybe later with /terminal-setup', value: 'no' },
      ]

      result.push({
        id: 'terminal-setup',
        component: (isActive) => (
          <Box flexDirection="column" gap={1} paddingLeft={1}>
            <Text bold>Use localclawd&apos;s terminal setup?</Text>
            <Box flexDirection="column" width={70} gap={1}>
              <Text>
                For the optimal experience, enable recommended settings
                <Newline />
                for your terminal:{' '}
                {env.terminal === 'Apple_Terminal'
                  ? 'Option+Enter for newlines and visual bell'
                  : 'Shift+Enter for newlines'}
              </Text>
              <SimpleMenu
                items={terminalItems}
                isActive={isActive}
                onSelect={value => {
                  if (value === 'install') {
                    void setupTerminal(theme).catch(() => {}).finally(goToNextStep)
                  } else {
                    goToNextStep()
                  }
                }}
                onCancel={goToNextStep}
              />
            </Box>
          </Box>
        ),
      })
    }

    return result
  }, [goToNextStep, handleLocalBackendSetup, handleThemeSelection, theme])

  const currentStep = steps[currentStepIndex]
  const isActive = true // Always active — only one step renders at a time

  return (
    <Box flexDirection="column">
      {showWelcome ? <WelcomeV2 /> : null}
      <Box flexDirection="column" marginTop={1}>
        {currentStep?.component(isActive)}
      </Box>
    </Box>
  )
}
