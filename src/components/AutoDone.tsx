/**
 * <AutoDone> — wraps a static JSX result and auto-fires `onDone` after
 * mount. Without this, returning a bare <Box> from a local-jsx command
 * leaves the TUI hanging forever (no completion signal).
 *
 * Usage:
 *   return (
 *     <AutoDone onDone={onDone}>
 *       <Box><Text>hello</Text></Box>
 *     </AutoDone>
 *   )
 */

import * as React from 'react'

type Props = {
  onDone: (result?: string) => void
  children: React.ReactNode
}

export function AutoDone({ onDone, children }: Props): React.ReactNode {
  React.useEffect(() => {
    const id = setTimeout(() => onDone(undefined), 0)
    return () => clearTimeout(id)
  }, [onDone])

  return <>{children}</>
}
