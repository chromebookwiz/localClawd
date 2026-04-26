/**
 * /webui — start the localclawd dashboard server (if not already running)
 * and surface the URL. If the server is already running, broadcast a
 * "new-window" message so any open browser tabs add a fresh pane.
 */

import * as React from 'react'
import { Box, Text } from '../../ink.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import {
  broadcastNewWindow,
  getWebuiPort,
  startWebuiServer,
} from '../../services/webui/webuiServer.js'
import { AutoDone } from '../../components/AutoDone.js'

export const call: LocalJSXCommandCall = async (onDone) => {
  const existingPort = getWebuiPort()
  if (existingPort) {
    // Already running — open a new pane in the connected browsers
    broadcastNewWindow()
    return (
      <AutoDone onDone={onDone}>
        <Box flexDirection="column" marginTop={1}>
          <Text bold color="#10b981">{'◆ webui already running — opened a new pane'}</Text>
          <Text dimColor>{`  http://127.0.0.1:${existingPort}/`}</Text>
        </Box>
      </AutoDone>
    )
  }

  const result = await startWebuiServer()
  if (!result.ok) {
    return (
      <AutoDone onDone={onDone}>
        <Box marginTop={1}>
          <Text color="red">{`✗ webui failed to start: ${result.error}`}</Text>
        </Box>
      </AutoDone>
    )
  }

  return (
    <AutoDone onDone={onDone}>
      <Box flexDirection="column" marginTop={1}>
        <Text bold color="#10b981">{'◆ webui running'}</Text>
        <Text dimColor>{`  http://127.0.0.1:${result.port}/`}</Text>
        <Text dimColor>{'  Drag panes by their header. Resize from the bottom-right corner.'}</Text>
        <Text dimColor>{'  Run /webui again to open another pane in the browser.'}</Text>
      </Box>
    </AutoDone>
  )
}
