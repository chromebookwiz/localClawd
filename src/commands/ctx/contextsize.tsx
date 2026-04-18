/**
 * /contextsize — Quick shortcut to set context window size.
 *
 * /contextsize 200k    — set to 200k tokens
 * /contextsize 1m      — set to 1M tokens
 * /contextsize auto    — detect from local provider
 * /contextsize         — show current context window (delegates to /ctx)
 */

import type { LocalJSXCommandCall } from '../../types/command.js'

export const call: LocalJSXCommandCall = async (onDone, context, args) => {
  const value = (args ?? '').trim()

  // Delegate to /ctx — prepend "set" if a value was given
  const { call: ctxCall } = await import('./ctx.js')
  if (value) {
    return ctxCall(onDone, context, `set ${value}`)
  }
  return ctxCall(onDone, context, '')
}
