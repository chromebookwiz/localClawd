/**
 * WebUI MVP — a tiny HTTP + WebSocket server that exposes the running
 * localclawd instance to a browser dashboard.
 *
 * Scope of this MVP:
 *   - Single instance per process. The server is started by the
 *     `webui` CLI subcommand or by `/webui` from inside a session.
 *   - Single static page served at /. The page connects to /ws and
 *     receives streamed text output from the agent's recent turns.
 *   - Sends `{type: 'command', text: '...'}` over the socket; the
 *     server enqueues that as a prompt into the message queue.
 *   - Multi-instance discovery: lists other localclawd processes that
 *     wrote PID files, so the dashboard *can* show them, but a fully
 *     interactive multi-instance view (draggable/snappable windows
 *     each connected to a remote process) is left as follow-up.
 *
 * Security: binds to 127.0.0.1. No auth, no remote access. Same
 * caveat as /rpc — do not expose on multi-user hosts.
 */

import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'http'
import { mkdir, readdir, readFile, writeFile } from 'fs/promises'
import { createHash, randomBytes } from 'crypto'
import { join } from 'path'
import { logForDebugging } from '../../utils/debug.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'

const DEFAULT_PORT = 7150
const PORT_FILE = join(getClaudeConfigHomeDir(), 'webui-port')
const WEBUI_HTML_PATH = join(getClaudeConfigHomeDir(), 'webui-static.html')

let _server: Server | null = null
let _boundPort = 0
let _websockets: Set<WebSocketLike> = new Set()
const _outputBuffer: Array<{ ts: number; text: string }> = []
const MAX_BUFFER = 500

interface WebSocketLike {
  send: (data: string) => void
  close: () => void
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function getWebuiPort(): number {
  return _boundPort
}

/** Push an output line to all connected websocket clients. */
export function broadcastOutput(text: string): void {
  if (!text) return
  const entry = { ts: Date.now(), text }
  _outputBuffer.push(entry)
  if (_outputBuffer.length > MAX_BUFFER) _outputBuffer.shift()
  for (const ws of _websockets) {
    try { ws.send(JSON.stringify({ type: 'output', ...entry })) } catch { /* ignore */ }
  }
}

/** Open a new "internal window" — broadcasts a window-spawn event so
 * the dashboard adds a fresh pane connected to this same instance. */
export function broadcastNewWindow(label?: string): void {
  for (const ws of _websockets) {
    try { ws.send(JSON.stringify({ type: 'new-window', label: label ?? `pane-${Date.now()}` })) } catch { /* ignore */ }
  }
}

/** Return list of localclawd PID files so the dashboard can show
 *  other instances. (Connecting to them is a follow-up feature.) */
export async function listInstances(): Promise<Array<{ pid: number; cwd?: string; port?: number }>> {
  const sessionsDir = join(getClaudeConfigHomeDir(), 'sessions')
  const out: Array<{ pid: number; cwd?: string; port?: number }> = []
  let files: string[]
  try { files = await readdir(sessionsDir) } catch { return out }
  for (const f of files) {
    if (!/^\d+\.json$/.test(f)) continue
    const pid = parseInt(f.slice(0, -5), 10)
    if (isNaN(pid)) continue
    let cwd: string | undefined
    let port: number | undefined
    try {
      const raw = await readFile(join(sessionsDir, f), 'utf-8')
      const parsed = JSON.parse(raw) as { cwd?: string; webuiPort?: number }
      cwd = parsed.cwd
      port = parsed.webuiPort
    } catch { /* skip */ }
    out.push({ pid, cwd, port })
  }
  return out
}

// ─── HTTP/WebSocket implementation ──────────────────────────────────────────

const STATIC_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>localclawd — dashboard</title>
<style>
  :root { --bg:#0b0b14; --panel:#161623; --border:#2a2a3e; --text:#e0e0f0; --dim:#9090a8; --accent:#6366f1; --good:#10b981; --warn:#f59e0b; }
  * { box-sizing: border-box }
  body { margin:0; background:var(--bg); color:var(--text); font:13px/1.5 ui-monospace, "SF Mono", Menlo, Consolas, monospace; height:100vh; overflow:hidden }
  #shell { position:relative; height:100vh; width:100vw; overflow:hidden }
  .pane {
    position:absolute; background:var(--panel); border:1px solid var(--border); border-radius:8px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3); display:flex; flex-direction:column; min-width:280px; min-height:200px;
  }
  .pane-header {
    padding:6px 10px; cursor:move; display:flex; justify-content:space-between; align-items:center;
    border-bottom:1px solid var(--border); user-select:none;
  }
  .pane-header .title { color:var(--accent); font-weight:600 }
  .pane-header .ctrls button {
    background:transparent; border:1px solid var(--border); color:var(--dim);
    padding:2px 8px; margin-left:4px; border-radius:4px; cursor:pointer; font-size:11px;
  }
  .pane-header .ctrls button:hover { color:var(--text); border-color:var(--accent) }
  .pane-body { flex:1; overflow:auto; padding:8px; font-size:12px }
  .pane-input { padding:6px; border-top:1px solid var(--border); display:flex }
  .pane-input input {
    flex:1; background:#0e0e18; border:1px solid var(--border); color:var(--text);
    padding:6px 10px; border-radius:4px; font:inherit; outline:none;
  }
  .pane-input input:focus { border-color:var(--accent) }
  .out-line { white-space:pre-wrap; word-break:break-word; margin:1px 0 }
  .resize-handle { position:absolute; right:0; bottom:0; width:14px; height:14px; cursor:nwse-resize; }
  .resize-handle::before { content:'⇲'; color:var(--dim); position:absolute; right:2px; bottom:0; font-size:10px }
  #toolbar {
    position:fixed; top:8px; left:8px; z-index:1000;
    background:var(--panel); border:1px solid var(--border); border-radius:6px; padding:6px 10px;
  }
  #toolbar button {
    background:var(--accent); color:#fff; border:0; padding:4px 10px; border-radius:4px; cursor:pointer;
    font:inherit; margin-right:4px;
  }
  #toolbar .status { color:var(--dim); font-size:11px; margin-left:8px }
  #toolbar .status.connected { color:var(--good) }
</style>
</head>
<body>
<div id="toolbar">
  <button onclick="newPane()">+ pane</button>
  <span class="status" id="status">connecting…</span>
</div>
<div id="shell"></div>

<script>
(() => {
  const shell = document.getElementById('shell');
  const statusEl = document.getElementById('status');
  let ws = null;
  let paneCounter = 0;
  const panes = new Map();

  function makePane(label) {
    paneCounter++;
    const id = 'pane-' + paneCounter;
    const pane = document.createElement('div');
    pane.className = 'pane';
    pane.id = id;
    const x = 40 + (paneCounter * 24) % 200;
    const y = 60 + (paneCounter * 24) % 200;
    pane.style.left = x + 'px';
    pane.style.top = y + 'px';
    pane.style.width = '520px';
    pane.style.height = '360px';
    pane.innerHTML = \`
      <div class="pane-header">
        <span class="title">\${label || id}</span>
        <span class="ctrls">
          <button onclick="closePane('\${id}')">×</button>
        </span>
      </div>
      <div class="pane-body" id="\${id}-body"></div>
      <div class="pane-input"><input type="text" placeholder="type a command or message, Enter to send" /></div>
      <div class="resize-handle"></div>
    \`;
    shell.appendChild(pane);
    panes.set(id, pane);
    setupDrag(pane);
    setupResize(pane);
    setupInput(pane, id);
    return id;
  }

  window.newPane = () => makePane();
  window.closePane = (id) => {
    const p = panes.get(id);
    if (p) { p.remove(); panes.delete(id); }
  };

  // Snap-to-grid (12px) when dragging or resizing
  const SNAP = 12;
  const snap = v => Math.round(v / SNAP) * SNAP;

  function setupDrag(pane) {
    const header = pane.querySelector('.pane-header');
    let startX, startY, origX, origY, dragging = false;
    header.addEventListener('mousedown', e => {
      if (e.target.tagName === 'BUTTON') return;
      dragging = true;
      startX = e.clientX; startY = e.clientY;
      origX = pane.offsetLeft; origY = pane.offsetTop;
      pane.style.zIndex = ++topZ;
      e.preventDefault();
    });
    document.addEventListener('mousemove', e => {
      if (!dragging) return;
      pane.style.left = snap(origX + (e.clientX - startX)) + 'px';
      pane.style.top = Math.max(0, snap(origY + (e.clientY - startY))) + 'px';
    });
    document.addEventListener('mouseup', () => dragging = false);
  }

  function setupResize(pane) {
    const handle = pane.querySelector('.resize-handle');
    let startX, startY, origW, origH, resizing = false;
    handle.addEventListener('mousedown', e => {
      resizing = true;
      startX = e.clientX; startY = e.clientY;
      origW = pane.offsetWidth; origH = pane.offsetHeight;
      e.preventDefault();
    });
    document.addEventListener('mousemove', e => {
      if (!resizing) return;
      pane.style.width = Math.max(280, snap(origW + (e.clientX - startX))) + 'px';
      pane.style.height = Math.max(200, snap(origH + (e.clientY - startY))) + 'px';
    });
    document.addEventListener('mouseup', () => resizing = false);
  }

  let topZ = 1;

  function setupInput(pane, id) {
    const input = pane.querySelector('input');
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && input.value.trim() && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'command', text: input.value.trim(), paneId: id }));
        appendOutput(id, '> ' + input.value);
        input.value = '';
      }
    });
  }

  function appendOutput(paneId, text) {
    const body = document.getElementById(paneId + '-body');
    if (!body) return;
    const div = document.createElement('div');
    div.className = 'out-line';
    div.textContent = text;
    body.appendChild(div);
    body.scrollTop = body.scrollHeight;
  }

  function appendOutputAll(text) {
    for (const id of panes.keys()) appendOutput(id, text);
  }

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(proto + '//' + location.host + '/ws');
    ws.onopen = () => {
      statusEl.textContent = 'connected';
      statusEl.classList.add('connected');
    };
    ws.onmessage = ev => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'output') {
          appendOutputAll(msg.text);
        } else if (msg.type === 'new-window') {
          makePane(msg.label);
        } else if (msg.type === 'history') {
          for (const line of msg.lines) appendOutputAll(line);
        }
      } catch { /* ignore */ }
    };
    ws.onclose = () => {
      statusEl.textContent = 'disconnected, retrying…';
      statusEl.classList.remove('connected');
      setTimeout(connect, 1500);
    };
  }

  // First pane on load
  makePane('main');
  connect();
})();
</script>
</body>
</html>
`

async function ensureStaticHtml(): Promise<void> {
  try {
    await mkdir(getClaudeConfigHomeDir(), { recursive: true })
    await writeFile(WEBUI_HTML_PATH, STATIC_HTML, 'utf-8')
  } catch { /* ignore */ }
}

// ─── Minimal RFC6455 WebSocket implementation ───────────────────────────────
// (Avoids adding a `ws` dep — uses Node's built-in tcp socket.)

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

function decodeFrame(buffer: Buffer): { payload: string; closed: boolean } | null {
  if (buffer.length < 2) return null
  const opcode = buffer[0]! & 0x0f
  const masked = (buffer[1]! & 0x80) !== 0
  let payloadLen = buffer[1]! & 0x7f
  let offset = 2
  if (payloadLen === 126) {
    payloadLen = buffer.readUInt16BE(offset); offset += 2
  } else if (payloadLen === 127) {
    payloadLen = Number(buffer.readBigUInt64BE(offset)); offset += 8
  }
  if (opcode === 0x8) return { payload: '', closed: true }
  if (opcode !== 0x1) return null  // only handle text frames
  if (!masked) return null
  const mask = buffer.slice(offset, offset + 4)
  offset += 4
  const data = Buffer.alloc(payloadLen)
  for (let i = 0; i < payloadLen; i++) {
    data[i] = buffer[offset + i]! ^ mask[i % 4]!
  }
  return { payload: data.toString('utf-8'), closed: false }
}

function encodeFrame(text: string): Buffer {
  const payload = Buffer.from(text, 'utf-8')
  const len = payload.length
  let header: Buffer
  if (len < 126) {
    header = Buffer.from([0x81, len])
  } else if (len < 65536) {
    header = Buffer.alloc(4)
    header[0] = 0x81; header[1] = 126
    header.writeUInt16BE(len, 2)
  } else {
    header = Buffer.alloc(10)
    header[0] = 0x81; header[1] = 127
    header.writeBigUInt64BE(BigInt(len), 2)
  }
  return Buffer.concat([header, payload])
}

function handleUpgrade(req: IncomingMessage, socket: import('net').Socket): void {
  const remote = socket.remoteAddress ?? ''
  if (remote !== '127.0.0.1' && remote !== '::1' && remote !== '::ffff:127.0.0.1') {
    socket.destroy()
    return
  }

  const key = req.headers['sec-websocket-key']
  if (!key) { socket.destroy(); return }
  const accept = createHash('sha1').update(key + WS_GUID).digest('base64')
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  )

  const ws: WebSocketLike = {
    send: (data: string) => { try { socket.write(encodeFrame(data)) } catch { /* ignore */ } },
    close: () => { try { socket.destroy() } catch { /* ignore */ } },
  }
  _websockets.add(ws)

  // Replay buffered output so a fresh client sees recent context
  try {
    socket.write(encodeFrame(JSON.stringify({
      type: 'history',
      lines: _outputBuffer.map(e => e.text),
    })))
  } catch { /* ignore */ }

  socket.on('data', (chunk: Buffer) => {
    const frame = decodeFrame(chunk)
    if (!frame) return
    if (frame.closed) { _websockets.delete(ws); return }
    try {
      const msg = JSON.parse(frame.payload) as { type: string; text?: string }
      if (msg.type === 'command' && typeof msg.text === 'string') {
        void enqueueCommand(msg.text)
      }
    } catch { /* ignore non-json */ }
  })
  socket.on('close', () => { _websockets.delete(ws) })
  socket.on('error', () => { _websockets.delete(ws) })
}

async function enqueueCommand(text: string): Promise<void> {
  try {
    const { enqueue } = await import('../../utils/messageQueueManager.js')
    enqueue({ value: text, mode: 'prompt', priority: 'now' })
    broadcastOutput(`[webui] queued: ${text}`)
  } catch (e) {
    broadcastOutput(`[webui] enqueue failed: ${e}`)
  }
}

async function handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.url === '/' || req.url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(STATIC_HTML)
    return
  }
  if (req.url === '/instances') {
    const list = await listInstances()
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(list))
    return
  }
  res.writeHead(404)
  res.end('not found')
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

export async function startWebuiServer(port?: number): Promise<{ ok: true; port: number } | { ok: false; error: string }> {
  if (_server) return { ok: true, port: _boundPort }
  await ensureStaticHtml()

  const fromEnv = parseInt(process.env.LOCALCLAWD_WEBUI_PORT ?? '', 10)
  const desired = port ?? (Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_PORT)
  return new Promise((resolve) => {
    const server = createServer((req, res) => { void handleHttp(req, res) })
    server.on('upgrade', (req, socket) => handleUpgrade(req, socket as import('net').Socket))
    server.on('error', (err) => {
      logForDebugging(`[webui] bind error: ${err.message}`)
      resolve({ ok: false, error: err.message })
    })
    server.listen(desired, '127.0.0.1', () => {
      const addr = server.address()
      if (addr && typeof addr === 'object') {
        _boundPort = addr.port
        _server = server
        logForDebugging(`[webui] listening on http://127.0.0.1:${_boundPort}`)
        void mkdir(getClaudeConfigHomeDir(), { recursive: true }).then(() =>
          writeFile(PORT_FILE, String(_boundPort), 'utf-8').catch(() => {}),
        )
        resolve({ ok: true, port: _boundPort })
      } else {
        resolve({ ok: false, error: 'no address bound' })
      }
    })
  })
}

export function stopWebuiServer(): void {
  if (_server) {
    for (const ws of _websockets) try { ws.close() } catch { /* ignore */ }
    _websockets.clear()
    _server.close()
    _server = null
    _boundPort = 0
  }
}

// Suppress unused-warning for randomBytes — held for future auth-token feature.
void randomBytes
