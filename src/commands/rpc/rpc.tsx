/**
 * /rpc — show the local tool-RPC endpoint + a Python snippet.
 *
 * The server is started at boot (setup.ts). This command just reports
 * status and shows example usage.
 */

import * as React from 'react'
import { Box, Text } from '../../ink.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import { getRpcPort } from '../../services/rpc/toolRpcServer.js'

function RpcStatus({
  port,
  onReady,
}: {
  port: number
  onReady: () => void
}): React.ReactNode {
  React.useEffect(() => {
    const id = setTimeout(onReady, 0)
    return () => clearTimeout(id)
  }, [onReady])

  if (!port) {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text bold color="yellow">{'◆ Tool RPC'}</Text>
        <Text dimColor>{'  Server not running. Check logs for bind errors.'}</Text>
      </Box>
    )
  }

  const url = `http://127.0.0.1:${port}/rpc`
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color="green">{'◆ Tool RPC — active'}</Text>
      <Box flexDirection="column" marginLeft={2}>
        <Text>{`  Endpoint: ${url}`}</Text>
        <Text>{'  Port file: ~/.claude/rpc-port'}</Text>
        <Text>{''}</Text>
        <Text bold>{'Methods:'}</Text>
        <Text dimColor>{'  read  { path, maxBytes? }'}</Text>
        <Text dimColor>{'  write { path, content }'}</Text>
        <Text dimColor>{'  edit  { path, oldString, newString, replaceAll? }'}</Text>
        <Text dimColor>{'  bash  { command, cwd?, timeoutMs? }'}</Text>
        <Text dimColor>{'  glob  { pattern, cwd? }'}</Text>
        <Text dimColor>{'  grep  { pattern, path?, glob?, max? }'}</Text>
        <Text>{''}</Text>
        <Text bold>{'Python example:'}</Text>
        <Text dimColor>{'  import urllib.request, json, os'}</Text>
        <Text dimColor>{'  port = open(os.path.expanduser("~/.claude/rpc-port")).read().strip()'}</Text>
        <Text dimColor>{'  def call(method, **params):'}</Text>
        <Text dimColor>{'      body = json.dumps({"method": method, "params": params}).encode()'}</Text>
        <Text dimColor>{'      req = urllib.request.Request(f"http://127.0.0.1:{port}/rpc",'}</Text>
        <Text dimColor>{'                                    data=body,'}</Text>
        <Text dimColor>{'                                    headers={"Content-Type": "application/json"})'}</Text>
        <Text dimColor>{'      return json.load(urllib.request.urlopen(req))'}</Text>
        <Text dimColor>{'  files = call("glob", pattern="src/**/*.ts")["data"]'}</Text>
      </Box>
      <Box marginLeft={2} marginTop={1}>
        <Text color="yellow">{'  Bound to 127.0.0.1 only. Do not run on shared/multi-user hosts.'}</Text>
      </Box>
    </Box>
  )
}

export const call: LocalJSXCommandCall = async (onDone) => {
  return <RpcStatus port={getRpcPort()} onReady={() => onDone(undefined)} />
}
