/**
 * /contextsize — Quick shortcut to set context window size.
 *
 * /contextsize 200k    — set to 200k tokens
 * /contextsize 128k    — set to 128k tokens
 * /contextsize 1m      — set to 1M tokens
 * /contextsize 131072  — set by exact token count
 * /contextsize         — show current context window (delegates to /ctx)
 */

import type { LocalJSXCommandCall } from '../../types/command.js'
import { saveGlobalConfig } from '../../utils/config.js'
import { parseContextWindowString, getContextWindowOverrideKey } from '../../utils/context.js'
import { getAutoCompactThreshold } from '../../services/compact/autoCompact.js'

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`
  return String(n)
}

export const call: LocalJSXCommandCall = async (onDone, context, args) => {
  const value = (args ?? '').trim().toLowerCase()

  if (!value) {
    const { call: ctxCall } = await import('./ctx.js')
    return ctxCall(onDone, context, '')
  }

  const parsed = parseContextWindowString(value)
  if (!parsed) {
    onDone(`Invalid size "${value}". Use: 128k | 200k | 1m | 131072`, { display: 'system' })
    return null
  }

  const model = context.options.mainLoopModel
  const key = getContextWindowOverrideKey(model)
  saveGlobalConfig(c => ({
    ...c,
    contextWindowOverrides: { ...(c.contextWindowOverrides ?? {}), [key]: parsed },
  }))

  onDone(
    `Context size set to ${fmtTokens(parsed)} for ${model} in this directory. Auto-compact triggers at ${fmtTokens(getAutoCompactThreshold(model))}.`,
    { display: 'system' },
  )
  return null
}
