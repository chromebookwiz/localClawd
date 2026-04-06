/**
 * Session-level system prompt override.
 * Set by /sysprompt — replaces the effective system prompt for all subsequent queries.
 * Cleared by /sysprompt (no args) or /sysprompt reset.
 */

let _override: string | null = null

export function getSessionSyspromptOverride(): string | null {
  return _override
}

export function setSessionSyspromptOverride(text: string | null): void {
  _override = text
}
