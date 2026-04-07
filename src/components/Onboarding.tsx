import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  setupTerminal,
  shouldOfferTerminalSetup,
} from '../commands/terminalSetup/terminalSetup.js'
import { Box, Newline, Text, useTheme } from '../ink.js'
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

// ─── Simple hand-rolled menu used throughout onboarding ──────────────────────
// Direct stdin listener — no keybinding system, no Select, works everywhere.

type MenuItem<T> = { label: string; value: T }

type SimpleMenuProps<T> = {
  items: MenuItem<T>[]
  onSelect(value: T): void
  onCancel?(): void
}

function SimpleMenu<T>({ items, onSelect, onCancel }: SimpleMenuProps<T>): React.ReactNode {
  const VISIBLE = Math.min(7, items.length)
  const [focusIdx, setFocusIdx] = useState(0)
  const [fromIdx, setFromIdx] = useState(0)
  const stateRef = useRef({ focusIdx: 0, fromIdx: 0, items, done: false })
  stateRef.current.items = items

  useEffect(() => {
    if (!process.stdin.readableFlowing) process.stdin.resume()

    const onData = (chunk: Buffer | string) => {
      const str = typeof chunk === 'string' ? chunk : chunk.toString('utf8')
      const s = stateRef.current
      const vis = Math.min(VISIBLE, s.items.length)

      if (str === '\x1b[A' || str === '\x1bOA') {
        const next = Math.max(0, s.focusIdx - 1)
        const nextFrom = next < s.fromIdx ? next : s.fromIdx
        stateRef.current.focusIdx = next
        stateRef.current.fromIdx = nextFrom
        setFocusIdx(next)
        setFromIdx(nextFrom)
      } else if (str === '\x1b[B' || str === '\x1bOB') {
        const next = Math.min(s.items.length - 1, s.focusIdx + 1)
        const nextFrom = next >= s.fromIdx + vis ? next - vis + 1 : s.fromIdx
        stateRef.current.focusIdx = next
        stateRef.current.fromIdx = nextFrom
        setFocusIdx(next)
        setFromIdx(nextFrom)
      } else if (str === '\r' || str === '\n' || str === '\r\n') {
        if (s.done) return
        stateRef.current.done = true
        const item = s.items[s.focusIdx]
        if (item) onSelect(item.value)
      } else if (str === '\x1b' || str === '\x1b\x1b') {
        onCancel?.()
      }
    }

    process.stdin.on('data', onData)
    return () => { process.stdin.off('data', onData) }
  }, [onSelect, onCancel])

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

// ─── PressEnterToContinue with working Enter handler ─────────────────────────

type PressEnterProps = { onContinue(): void }

function PressEnterToContinue({ onContinue }: PressEnterProps): React.ReactNode {
  const doneRef = useRef(false)

  useEffect(() => {
    if (!process.stdin.readableFlowing) process.stdin.resume()

    const onData = (chunk: Buffer | string) => {
      const str = typeof chunk === 'string' ? chunk : chunk.toString('utf8')
      if ((str === '\r' || str === '\n' || str === '\r\n') && !doneRef.current) {
        doneRef.current = true
        onContinue()
      }
    }

    process.stdin.on('data', onData)
    return () => { process.stdin.off('data', onData) }
  }, [onContinue])

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

  const steps = useMemo<Array<{ id: StepId; component: React.ReactNode }>>(() => {
    const config = getGlobalConfig()

    const themeStep = (
      <Box flexDirection="column" gap={1} paddingLeft={1}>
        <Text bold>Choose a theme</Text>
        <SimpleMenu
          items={themeItems}
          onSelect={handleThemeSelection}
          onCancel={goToNextStep}
        />
        <Text dimColor>Change later with /theme</Text>
      </Box>
    )

    const compactContextStep = (
      <Box flexDirection="column" gap={1} paddingLeft={1} width={70}>
        <Text bold>Choose a compact context window</Text>
        <Text dimColor wrap="wrap">
          localclawd can compact earlier than the model&apos;s full advertised
          window. Useful for local models that degrade before hitting their limit.
        </Text>
        <SimpleMenu
          items={compactItems}
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
    )

    const localBackendStep = (
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
    )

    const securityStep = (
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
        <PressEnterToContinue onContinue={goToNextStep} />
      </Box>
    )

    const result: Array<{ id: StepId; component: React.ReactNode }> = [
      { id: 'theme', component: themeStep },
      { id: 'compact-context', component: compactContextStep },
      { id: 'local-backend', component: localBackendStep },
      { id: 'security', component: securityStep },
    ]

    if (shouldOfferTerminalSetup()) {
      const terminalItems: MenuItem<string>[] = [
        { label: 'Yes, use recommended settings', value: 'install' },
        { label: 'No, maybe later with /terminal-setup', value: 'no' },
      ]

      result.push({
        id: 'terminal-setup',
        component: (
          <Box flexDirection="column" gap={1} paddingLeft={1}>
            <Text bold>Use localclawd&apos;s terminal setup?</Text>
            <Box flexDirection="column" width={70} gap={1}>
              <Text>
                For the optimal coding experience, enable recommended settings
                <Newline />
                for your terminal:{' '}
                {env.terminal === 'Apple_Terminal'
                  ? 'Option+Enter for newlines and visual bell'
                  : 'Shift+Enter for newlines'}
              </Text>
              <SimpleMenu
                items={terminalItems}
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

  return (
    <Box flexDirection="column">
      {showWelcome ? <WelcomeV2 /> : null}
      <Box flexDirection="column" marginTop={1}>
        {currentStep?.component}
      </Box>
    </Box>
  )
}
