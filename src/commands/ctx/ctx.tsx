/**
 * /ctx — Context window management for localClawd.
 *
 * /ctx                — show current context window, usage, thresholds
 * /ctx set 200k       — set context window cap (200k / 1m / plain number)
 * /ctx set auto       — detect from local provider via /v1/models
 * /ctx reset          — clear custom cap, use model default
 * /ctx compact on/off — enable/disable autocompact
 */

import * as React from 'react'
import { Box, Text } from '../../ink.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import { saveGlobalConfig, getGlobalConfig } from '../../utils/config.js'
import {
  getContextWindowForModel,
  getConfiguredCompactContextWindow,
  parseContextWindowString,
  getLocalProviderContextWindow,
  setLocalProviderContextWindow,
  formatCompactContextWindowOption,
} from '../../utils/context.js'
import {
  getEffectiveContextWindowSize,
  getAutoCompactThreshold,
  isAutoCompactEnabled,
} from '../../services/compact/autoCompact.js'
import { tokenCountWithEstimation } from '../../utils/tokens.js'
import { queryLocalProviderContextLength } from '../../services/api/localBackend.js'
import {
  getLocalLLMBaseUrl,
  getLocalLLMModel,
  getLocalLLMApiKey,
  getLocalLLMProvider,
} from '../../utils/model/providers.js'

// ─── UI Components ────────────────────────────────────────────────────────────

function CtxDisplay({
  lines,
  onReady,
}: {
  lines: Array<{ text: string; color?: string; bold?: boolean }>
  onReady: () => void
}): React.ReactNode {
  React.useEffect(() => {
    const id = setTimeout(onReady, 0)
    return () => clearTimeout(id)
  }, [onReady])

  return (
    <Box flexDirection="column" marginTop={1}>
      {lines.map((line, i) => (
        <Text
          key={i}
          color={line.color as Parameters<typeof Text>[0]['color']}
          bold={line.bold}
        >
          {line.text}
        </Text>
      ))}
    </Box>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`
  return String(n)
}

function barLine(used: number, total: number, width = 40): string {
  const pct = Math.min(1, used / total)
  const filled = Math.round(pct * width)
  const empty = width - filled
  const color = pct > 0.85 ? '█' : '▓'
  return `[${'█'.repeat(filled)}${' '.repeat(empty)}] ${Math.round(pct * 100)}%`
}

// ─── Command entry point ──────────────────────────────────────────────────────

export const call: LocalJSXCommandCall = async (onDone, context, args) => {
  const parts = (args ?? '').trim().split(/\s+/).filter(Boolean)
  const sub = parts[0]?.toLowerCase()
  const model = context.options.mainLoopModel

  // ── /ctx set <value> ──────────────────────────────────────────────────────
  if (sub === 'set') {
    const valueStr = parts[1]?.toLowerCase()
    if (!valueStr) {
      const handleReady = () => onDone(undefined)
      return (
        <CtxDisplay
          lines={[{ text: 'Usage: /ctx set <size>  e.g. /ctx set 200k | /ctx set 1m | /ctx set 131072 | /ctx set auto', color: 'yellow' }]}
          onReady={handleReady}
        />
      )
    }

    if (valueStr === 'auto') {
      // Query local provider
      const provider = getLocalLLMProvider()
      const baseUrl = getLocalLLMBaseUrl(provider)
      const modelName = getLocalLLMModel(provider) ?? ''
      const apiKey = getLocalLLMApiKey(provider)
      const detected = await queryLocalProviderContextLength(baseUrl, modelName, apiKey, provider)

      if (detected) {
        setLocalProviderContextWindow(detected)
        // Also persist to config so it survives restarts
        saveGlobalConfig(c => ({ ...c, compactContextWindowTokens: detected }))
        const handleReady = () => onDone(undefined)
        return (
          <CtxDisplay
            lines={[
              { text: `Context window detected: ${fmtTokens(detected)} tokens`, color: 'green', bold: true },
              { text: `Persisted to config. Effective window: ${fmtTokens(getEffectiveContextWindowSize(model))} tokens (minus output reservation).`, color: 'cyan' },
            ]}
            onReady={handleReady}
          />
        )
      }
      const handleReady = () => onDone(undefined)
      return (
        <CtxDisplay
          lines={[
            { text: 'Could not detect context window from local provider.', color: 'yellow' },
            { text: 'Set it manually: /ctx set 200k', color: 'cyan' },
          ]}
          onReady={handleReady}
        />
      )
    }

    const parsed = parseContextWindowString(valueStr)
    if (!parsed) {
      const handleReady = () => onDone(undefined)
      return (
        <CtxDisplay
          lines={[{ text: `Invalid size "${valueStr}". Use: 200k | 1m | 131072`, color: 'red' }]}
          onReady={handleReady}
        />
      )
    }

    saveGlobalConfig(c => ({ ...c, compactContextWindowTokens: parsed }))
    setLocalProviderContextWindow(parsed)
    const handleReady = () => onDone(undefined)
    return (
      <CtxDisplay
        lines={[
          { text: `Context window set to ${fmtTokens(parsed)} tokens.`, color: 'green', bold: true },
          { text: `Effective window: ${fmtTokens(getEffectiveContextWindowSize(model))} (minus output reservation).`, color: 'cyan' },
          { text: `Auto-compact threshold: ${fmtTokens(getAutoCompactThreshold(model))}.`, color: 'cyan' },
        ]}
        onReady={handleReady}
      />
    )
  }

  // ── /ctx reset ────────────────────────────────────────────────────────────
  if (sub === 'reset') {
    saveGlobalConfig(c => {
      const { compactContextWindowTokens: _, ...rest } = c
      return rest as typeof c
    })
    setLocalProviderContextWindow(null)
    const handleReady = () => onDone(undefined)
    return (
      <CtxDisplay
        lines={[
          { text: 'Context window reset to model default.', color: 'green' },
          { text: `Current model default: ${fmtTokens(getContextWindowForModel(model))} tokens.`, color: 'cyan' },
        ]}
        onReady={handleReady}
      />
    )
  }

  // ── /ctx compact on/off ───────────────────────────────────────────────────
  if (sub === 'compact') {
    const toggle = parts[1]?.toLowerCase()
    if (toggle === 'on' || toggle === 'off') {
      const enable = toggle === 'on'
      saveGlobalConfig(c => ({ ...c, autoCompactEnabled: enable }))
      const handleReady = () => onDone(undefined)
      return (
        <CtxDisplay
          lines={[{ text: `Auto-compact ${enable ? 'enabled' : 'disabled'}.`, color: enable ? 'green' : 'yellow' }]}
          onReady={handleReady}
        />
      )
    }
  }

  // ── /ctx (status) ─────────────────────────────────────────────────────────
  const totalWindow = getContextWindowForModel(model)
  const effectiveWindow = getEffectiveContextWindowSize(model)
  const autoCompactThreshold = getAutoCompactThreshold(model)
  const configuredCap = getConfiguredCompactContextWindow()
  const detectedFromProvider = getLocalProviderContextWindow()
  const tokenUsage = tokenCountWithEstimation(context.messages)
  const autoCompact = isAutoCompactEnabled()

  const usagePct = Math.min(100, Math.round((tokenUsage / totalWindow) * 100))

  const source = configuredCap
    ? `user-configured (${fmtTokens(configuredCap)})`
    : detectedFromProvider
      ? `auto-detected from provider (${fmtTokens(detectedFromProvider)})`
      : 'model default'

  const lines: Array<{ text: string; color?: string; bold?: boolean }> = [
    { text: '─── Context Window ───────────────────────────────────────', color: 'cyan' },
    { text: `  Total window:       ${fmtTokens(totalWindow)} tokens   [${source}]`, color: 'cyan' },
    { text: `  Effective window:   ${fmtTokens(effectiveWindow)} tokens (reserved for output)` },
    { text: `  Auto-compact at:    ${fmtTokens(autoCompactThreshold)} tokens${autoCompact ? '' : '  (DISABLED)'}` },
    { text: '' },
    { text: '─── Current Usage ────────────────────────────────────────', color: 'cyan' },
    { text: `  ${barLine(tokenUsage, totalWindow)}  ${fmtTokens(tokenUsage)} / ${fmtTokens(totalWindow)}` },
    { text: `  ${usagePct}% used — ${fmtTokens(totalWindow - tokenUsage)} tokens remaining` },
    { text: '' },
    { text: '─── Commands ─────────────────────────────────────────────', color: 'cyan' },
    { text: '  /ctx set 200k     — set context window size' },
    { text: '  /ctx set auto     — detect from local provider' },
    { text: '  /ctx reset        — restore model default' },
    { text: `  /ctx compact ${autoCompact ? 'off' : 'on '}      — ${autoCompact ? 'disable' : 'enable'} auto-compact` },
    { text: '  /compact          — compact conversation now' },
  ]

  const handleReady = () => onDone(undefined)
  return <CtxDisplay lines={lines} onReady={handleReady} />
}
