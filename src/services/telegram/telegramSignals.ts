/**
 * Global stop signal — checked by /keepgoing, /director, and other loops.
 *
 * Set via Telegram /stop command or programmatically.
 * Each loop checks at the start of every round and resets after consuming.
 */

let _stopRequested = false

export const globalStopSignal = {
  get: (): boolean => _stopRequested,
  set: (v: boolean): void => {
    _stopRequested = v
  },
  reset: (): void => {
    _stopRequested = false
  },
}
