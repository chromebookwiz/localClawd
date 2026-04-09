/**
 * Command chaining utilities for localclawd.
 *
 * Allows typing: /thinkharder /research quantum computing /keepgoing
 * Which executes each command in sequence, passing remaining chain as nextInput.
 *
 * Compatibility matrix — incompatible pairs warn and abort the chain.
 */

export type ChainLink = { cmd: string; args: string }

/** Incompatible command pairs (order doesn't matter) */
const INCOMPATIBLE_PAIRS: Array<[string, string]> = [
  ['keepgoing', 'heartbeat'], // both are infinite loops
  ['thinkharder', 'thinknormal'], // contradictory modes
  ['heartbeat', 'heartbeat'], // can't run twice
  ['keepgoing', 'keepgoing'], // can't run twice
]

/** Commands that are "loop" commands — should come last in a chain */
const LOOP_COMMANDS = new Set(['keepgoing', 'kg', 'continue', 'heartbeat', 'hb'])

/** Canonicalize command name (strip aliases) */
const ALIAS_MAP: Record<string, string> = {
  kg: 'keepgoing',
  continue: 'keepgoing',
  hb: 'heartbeat',
  th: 'thinkharder',
  sp: 'sysprompt',
  cw: 'ctx',
  'context-window': 'ctx',
  tg: 'telegram',
  r: 'research',
}

export function canonicalCmd(name: string): string {
  return ALIAS_MAP[name.toLowerCase()] ?? name.toLowerCase()
}

/**
 * Parse a raw input like "/thinkharder /research foo /keepgoing" into
 * an array of chain links: [{cmd:'thinkharder',args:''}, {cmd:'research',args:'foo'}, ...]
 */
export function parseCommandChain(rawInput: string): ChainLink[] | null {
  const trimmed = rawInput.trim()
  if (!trimmed.startsWith('/')) return null

  const links: ChainLink[] = []
  // Split on whitespace-preceded '/' but keep first token
  // e.g. "/thinkharder /research foo bar /keepgoing" →
  //   ["/thinkharder", "/research foo bar", "/keepgoing"]
  const segments = trimmed.split(/\s+(?=\/)/)

  for (const segment of segments) {
    const s = segment.trim()
    if (!s.startsWith('/')) {
      // Non-slash segment, append to previous link's args
      if (links.length > 0) {
        links[links.length - 1]!.args = links[links.length - 1]!.args
          ? links[links.length - 1]!.args + ' ' + s
          : s
      }
      continue
    }
    const withoutSlash = s.slice(1)
    const spaceIdx = withoutSlash.indexOf(' ')
    const cmd = spaceIdx === -1 ? withoutSlash : withoutSlash.slice(0, spaceIdx)
    const args = spaceIdx === -1 ? '' : withoutSlash.slice(spaceIdx + 1).trim()
    links.push({ cmd: cmd.toLowerCase(), args })
  }

  return links.length > 0 ? links : null
}

export type ChainValidation =
  | { ok: true }
  | { ok: false; reason: string }

/**
 * Validate a chain of commands for compatibility.
 * Returns ok:true or a reason string for the warning.
 */
export function validateCommandChain(chain: ChainLink[]): ChainValidation {
  if (chain.length <= 1) return { ok: true }

  const canonical = chain.map(l => canonicalCmd(l.cmd))

  // Check incompatible pairs
  for (let i = 0; i < canonical.length; i++) {
    for (let j = i + 1; j < canonical.length; j++) {
      const a = canonical[i]!
      const b = canonical[j]!
      for (const [x, y] of INCOMPATIBLE_PAIRS) {
        if ((a === x && b === y) || (a === y && b === x)) {
          return {
            ok: false,
            reason: `/${a} and /${b} are incompatible — they cannot run together.`,
          }
        }
      }
    }
  }

  // Loop commands must come last
  for (let i = 0; i < canonical.length - 1; i++) {
    if (LOOP_COMMANDS.has(canonical[i]!)) {
      return {
        ok: false,
        reason: `/${canonical[i]} is a loop command and must be the last in the chain.`,
      }
    }
  }

  return { ok: true }
}

/**
 * Extract the leading command's own args and the remaining chain.
 *
 * Input:  args = "/research quantum computing /keepgoing"
 * Output: { ownArgs: '', nextCmd: '/research quantum computing /keepgoing' }
 *
 * Input:  args = "focus on bugs /keepgoing"
 * Output: { ownArgs: 'focus on bugs', nextCmd: '/keepgoing' }
 *
 * Input:  args = "focus on bugs"
 * Output: { ownArgs: 'focus on bugs', nextCmd: null }
 */
export function extractChain(args: string): { ownArgs: string; nextCmd: string | null } {
  const trimmed = args.trim()

  // Entire args is a slash command chain
  if (trimmed.startsWith('/')) {
    return { ownArgs: '', nextCmd: trimmed }
  }

  // Find first ' /' that marks a chain continuation
  const chainIdx = trimmed.indexOf(' /')
  if (chainIdx !== -1) {
    return {
      ownArgs: trimmed.slice(0, chainIdx).trim(),
      nextCmd: trimmed.slice(chainIdx + 1).trim(),
    }
  }

  return { ownArgs: trimmed, nextCmd: null }
}

/**
 * Build the chain validation warning message for display.
 */
export function chainWarning(reason: string): string {
  return `⚠️  Chain error: ${reason}\nRun commands separately or fix the order.`
}
