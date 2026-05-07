/**
 * /contextsize — Quick shortcut to set context window size.
 *
 * /contextsize 200k    — set to 200k tokens
 * /contextsize 1m      — set to 1M tokens
 * /contextsize auto    — detect from local provider
 * /contextsize         — show current context window (delegates to /ctx)
 */

import type { LocalJSXCommandCall } from '../../types/command.js'
import { saveGlobalConfig } from '../../utils/config.js'
import { parseContextWindowString, setLocalProviderContextWindow } from '../../utils/context.js'
import { getAutoCompactThreshold } from '../../services/compact/autoCompact.js'
import { queryLocalProviderContextLength } from '../../services/api/localBackend.js'
import {
  getLocalLLMBaseUrl,
  getLocalLLMModel,
  getLocalLLMApiKey,
  getLocalLLMProvider,
} from '../../utils/model/providers.js'

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

  const model = context.options.mainLoopModel

  if (value === 'auto') {
    const provider = getLocalLLMProvider()
    const baseUrl = getLocalLLMBaseUrl(provider)
    const modelName = getLocalLLMModel(provider) ?? ''
    const apiKey = getLocalLLMApiKey(provider)
    const detected = await queryLocalProviderContextLength(baseUrl, modelName, apiKey, provider)

    if (detected && detected > 0) {
      setLocalProviderContextWindow(detected)
      saveGlobalConfig(c => ({ ...c, compactContextWindowTokens: detected }))
      onDone(
        `Context size changed to ${fmtTokens(detected)} (auto-detected). Auto-compact at ${fmtTokens(getAutoCompactThreshold(model))}.`,
        { display: 'system' },
      )
      return null
    }
    onDone(
      'Could not detect context window from local provider. Set manually: /contextsize 200k',
      { display: 'system' },
    )
    return null
  }

  const parsed = parseContextWindowString(value)
  if (!parsed) {
    onDone(`Invalid size "${value}". Use: 200k | 1m | 131072 | auto`, { display: 'system' })
    return null
  }

  saveGlobalConfig(c => ({ ...c, compactContextWindowTokens: parsed }))
  setLocalProviderContextWindow(parsed)
  onDone(
    `Context size changed to ${fmtTokens(parsed)}. Auto-compact triggers at ${fmtTokens(getAutoCompactThreshold(model))}.`,
    { display: 'system' },
  )
  return null
}
