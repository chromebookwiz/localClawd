/**
 * /contextsize — Quick shortcut to set context window size.
 *
 * /contextsize 200k    — set to 200k tokens
 * /contextsize 1m      — set to 1M tokens
 * /contextsize auto    — detect from local provider
 * /contextsize         — show current context window (delegates to /ctx)
 */

import * as React from 'react'
import { Text } from '../../ink.js'
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

function Msg({
  text,
  color,
  onReady,
}: {
  text: string
  color: string
  onReady: () => void
}): React.ReactNode {
  React.useEffect(() => {
    const id = setTimeout(onReady, 0)
    return () => clearTimeout(id)
  }, [onReady])
  return <Text color={color as Parameters<typeof Text>[0]['color']}>{text}</Text>
}

export const call: LocalJSXCommandCall = async (onDone, context, args) => {
  const value = (args ?? '').trim().toLowerCase()

  if (!value) {
    const { call: ctxCall } = await import('./ctx.js')
    return ctxCall(onDone, context, '')
  }

  const done = () => onDone(undefined)
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
      return (
        <Msg
          color="green"
          text={`Context size changed to ${fmtTokens(detected)} (auto-detected). Auto-compact at ${fmtTokens(getAutoCompactThreshold(model))}.`}
          onReady={done}
        />
      )
    }
    return (
      <Msg
        color="yellow"
        text="Could not detect context window from local provider. Set manually: /contextsize 200k"
        onReady={done}
      />
    )
  }

  const parsed = parseContextWindowString(value)
  if (!parsed) {
    return (
      <Msg
        color="red"
        text={`Invalid size "${value}". Use: 200k | 1m | 131072 | auto`}
        onReady={done}
      />
    )
  }

  saveGlobalConfig(c => ({ ...c, compactContextWindowTokens: parsed }))
  setLocalProviderContextWindow(parsed)

  return (
    <Msg
      color="green"
      text={`Context size changed to ${fmtTokens(parsed)}. Auto-compact triggers at ${fmtTokens(getAutoCompactThreshold(model))}.`}
      onReady={done}
    />
  )
}
