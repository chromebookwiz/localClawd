/**
 * /ctx — Context window management for localclawd.
 *
 * /ctx                — show current context window, usage, thresholds
 * /ctx set 200k       — set context window cap (200k / 1m / plain number)
 * /ctx reset          — clear custom cap, use model default
 * /ctx compact on/off — enable/disable autocompact
 */

import type { LocalJSXCommandCall } from '../../types/command.js'
import { saveGlobalConfig, getGlobalConfig } from '../../utils/config.js'
import {
  getContextWindowForModel,
  getConfiguredCompactContextWindow,
  parseContextWindowString,
  getLocalProviderContextWindow,
} from '../../utils/context.js'
import {
  getEffectiveContextWindowSize,
  getAutoCompactThreshold,
  isAutoCompactEnabled,
} from '../../services/compact/autoCompact.js'
import { tokenCountWithEstimation } from '../../utils/tokens.js'

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
      onDone('Usage: /ctx set <size>  e.g. /ctx set 200k | /ctx set 1m | /ctx set 131072', { display: 'system' })
      return null
    }

    const parsed = parseContextWindowString(valueStr)
    if (!parsed) {
      onDone(`Invalid size "${valueStr}". Use: 200k | 1m | 131072`, { display: 'system' })
      return null
    }

    saveGlobalConfig(c => ({ ...c, compactContextWindowTokens: parsed }))
    onDone(
      [
        `Context window set to ${fmtTokens(parsed)} tokens.`,
        `Effective window: ${fmtTokens(getEffectiveContextWindowSize(model))} (minus output reservation).`,
        `Auto-compact threshold: ${fmtTokens(getAutoCompactThreshold(model))}.`,
      ].join('\n'),
      { display: 'system' },
    )
    return null
  }

  // ── /ctx reset ────────────────────────────────────────────────────────────
  if (sub === 'reset') {
    saveGlobalConfig(c => {
      const { compactContextWindowTokens: _, ...rest } = c
      return rest as typeof c
    })
    onDone(
      [
        'Context window reset to model default.',
        `Current model default: ${fmtTokens(getContextWindowForModel(model))} tokens.`,
      ].join('\n'),
      { display: 'system' },
    )
    return null
  }

  // ── /ctx compact on/off ───────────────────────────────────────────────────
  if (sub === 'compact') {
    const toggle = parts[1]?.toLowerCase()
    if (toggle === 'on' || toggle === 'off') {
      const enable = toggle === 'on'
      saveGlobalConfig(c => ({ ...c, autoCompactEnabled: enable }))
      onDone(`Auto-compact ${enable ? 'enabled' : 'disabled'}.`, { display: 'system' })
      return null
    }
    onDone('Usage: /ctx compact on | /ctx compact off', { display: 'system' })
    return null
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
      ? `detected (${fmtTokens(detectedFromProvider)})`
      : 'model default'

  const lines = [
    '─── Context Window ───────────────────────────────────────',
    `  Total window:       ${fmtTokens(totalWindow)} tokens   [${source}]`,
    `  Effective window:   ${fmtTokens(effectiveWindow)} tokens (reserved for output)`,
    `  Auto-compact at:    ${fmtTokens(autoCompactThreshold)} tokens${autoCompact ? '' : '  (DISABLED)'}`,
    '',
    '─── Current Usage ────────────────────────────────────────',
    `  ${barLine(tokenUsage, totalWindow)}  ${fmtTokens(tokenUsage)} / ${fmtTokens(totalWindow)}`,
    `  ${usagePct}% used — ${fmtTokens(totalWindow - tokenUsage)} tokens remaining`,
    '',
    '─── Commands ─────────────────────────────────────────────',
    '  /ctx set 200k      — set context window size',
    '  /ctx reset         — restore model default',
    `  /ctx compact ${autoCompact ? 'off' : 'on '}       — ${autoCompact ? 'disable' : 'enable'} auto-compact`,
    '  /compact           — compact conversation now',
  ]

  onDone(lines.join('\n'), { display: 'system' })
  return null
}
