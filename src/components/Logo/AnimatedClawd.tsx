import * as React from 'react'
import { Box } from '../../ink.js'
import { CLAWD_HEIGHT, Clawd } from './Clawd.js'

/**
 * Renders the localclawd asterisk logo at a fixed height so the surrounding
 * layout never shifts. Click is a no-op; kept for API compatibility with
 * call sites that wire an onClick.
 */
export function AnimatedClawd(): React.ReactNode {
  return (
    <Box height={CLAWD_HEIGHT} flexDirection="column" width={10}>
      <Clawd />
    </Box>
  )
}
