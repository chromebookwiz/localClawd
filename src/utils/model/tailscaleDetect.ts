/**
 * Tailscale peer detection — surfaces tailnet hosts as URL presets in
 * the local-endpoint setup flow.
 *
 * Shells out to `tailscale status --json` (if installed). Zero deps.
 * If Tailscale isn't installed, `detectTailscalePeers()` returns [].
 */

import { spawn } from 'child_process'

export interface TailscalePeer {
  hostName: string        // short hostname ("my-box")
  dnsName: string         // fully qualified ("my-box.tailnet.ts.net")
  ip: string              // primary Tailscale IPv4 (100.x.x.x) if available
  online: boolean
  isSelf: boolean
}

interface RawTailscaleStatus {
  Self?: RawTailscaleNode
  Peer?: Record<string, RawTailscaleNode>
}

interface RawTailscaleNode {
  HostName?: string
  DNSName?: string
  TailscaleIPs?: string[]
  Online?: boolean
}

function runTailscaleStatus(timeoutMs: number = 3000): Promise<string | null> {
  return new Promise(resolve => {
    let stdout = ''
    let done = false
    let child: ReturnType<typeof spawn>
    try {
      child = spawn('tailscale', ['status', '--json'], { shell: false })
    } catch {
      resolve(null)
      return
    }
    const timer = setTimeout(() => {
      if (done) return
      done = true
      try { child.kill('SIGTERM') } catch { /* ignore */ }
      resolve(null)
    }, timeoutMs)
    child.stdout?.on('data', (c: Buffer) => { stdout += c.toString('utf-8') })
    child.on('close', (code) => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve(code === 0 ? stdout : null)
    })
    child.on('error', () => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve(null)
    })
  })
}

function nodeToPeer(raw: RawTailscaleNode, isSelf: boolean): TailscalePeer | null {
  const hostName = raw.HostName
  if (!hostName) return null
  const dnsRaw = raw.DNSName ?? ''
  const dnsName = dnsRaw.replace(/\.$/, '')  // strip trailing dot
  const ip = (raw.TailscaleIPs ?? []).find(x => /^\d+\.\d+\.\d+\.\d+$/.test(x)) ?? ''
  return {
    hostName,
    dnsName,
    ip,
    online: Boolean(raw.Online),
    isSelf,
  }
}

export async function detectTailscalePeers(): Promise<TailscalePeer[]> {
  const raw = await runTailscaleStatus()
  if (!raw) return []

  let parsed: RawTailscaleStatus
  try { parsed = JSON.parse(raw) as RawTailscaleStatus } catch { return [] }

  const peers: TailscalePeer[] = []
  if (parsed.Self) {
    const p = nodeToPeer(parsed.Self, true)
    if (p) peers.push(p)
  }
  if (parsed.Peer) {
    for (const node of Object.values(parsed.Peer)) {
      const p = nodeToPeer(node, false)
      if (p) peers.push(p)
    }
  }

  // Online peers first; self last among online peers (remote targets are usually
  // what you're trying to reach from here).
  peers.sort((a, b) => {
    if (a.online !== b.online) return a.online ? -1 : 1
    if (a.isSelf !== b.isSelf) return a.isSelf ? 1 : -1
    return a.hostName.localeCompare(b.hostName)
  })

  return peers
}

/**
 * Default port for each local provider. Used to build preset URLs
 * for Tailscale peers.
 */
export function defaultPortForProvider(provider: string): number {
  switch (provider) {
    case 'vllm':   return 8000
    case 'ollama': return 11434
    default:       return 8000
  }
}

/** Build candidate URLs for a Tailscale peer at a given provider port. */
export function urlsForPeer(peer: TailscalePeer, port: number): Array<{ label: string; url: string }> {
  const out: Array<{ label: string; url: string }> = []
  if (peer.hostName) {
    // MagicDNS short form first — works inside the tailnet
    const label = peer.isSelf
      ? `${peer.hostName} (this machine, via Tailscale)`
      : `${peer.hostName} (tailnet${peer.online ? '' : ', offline'})`
    out.push({ label, url: `http://${peer.hostName}:${port}/v1` })
  }
  if (peer.dnsName && peer.dnsName !== peer.hostName) {
    out.push({
      label: `${peer.dnsName}${peer.online ? '' : ' (offline)'}`,
      url: `http://${peer.dnsName}:${port}/v1`,
    })
  }
  if (peer.ip) {
    out.push({
      label: `${peer.ip}  (${peer.hostName}${peer.online ? '' : ', offline'})`,
      url: `http://${peer.ip}:${port}/v1`,
    })
  }
  return out
}
