/**
 * Local Tool RPC — a zero-auth HTTP server on 127.0.0.1 that exposes a
 * whitelist of tool primitives (read, write, edit, bash, glob, grep) so
 * scripts running on the same host can call them without routing through
 * the LLM.
 *
 * This collapses multi-step pipelines ("read file, transform, write
 * back") from N agent turns (= N context windows) into one Python
 * script that calls the tools directly.
 *
 * Security: binds to 127.0.0.1 only. Any process on the local machine
 * can hit it — that's intentional for dev ergonomics. Do NOT expose to
 * other hosts, run inside shared accounts, or on multi-user systems.
 *
 * Port chosen by default: 7149 (pseudo-random; overridable via
 * LOCALCLAWD_RPC_PORT). When the server starts it writes the bound
 * port to ~/.claude/rpc-port so a companion Python helper can find it.
 */

import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'http'
import { readFile, writeFile, mkdir, readdir, stat } from 'fs/promises'
import { spawn } from 'child_process'
import { join, resolve as resolvePath, relative } from 'path'
import { homedir } from 'os'
import { logForDebugging } from '../../utils/debug.js'

const DEFAULT_PORT = 7149
const PORT_FILE = join(homedir(), '.claude', 'rpc-port')

let _server: Server | null = null
let _boundPort = 0

// ─── Tool primitives ────────────────────────────────────────────────────────

interface ReadParams { path: string; maxBytes?: number }
interface WriteParams { path: string; content: string }
interface EditParams { path: string; oldString: string; newString: string; replaceAll?: boolean }
interface BashParams { command: string; cwd?: string; timeoutMs?: number }
interface GlobParams { pattern: string; cwd?: string }
interface GrepParams { pattern: string; path?: string; glob?: string; max?: number }

interface RpcResult<T> {
  ok: boolean
  data?: T
  error?: string
}

async function handleRead(p: ReadParams): Promise<RpcResult<string>> {
  try {
    const raw = await readFile(p.path, 'utf-8')
    const content = p.maxBytes && raw.length > p.maxBytes ? raw.slice(0, p.maxBytes) : raw
    return { ok: true, data: content }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

async function handleWrite(p: WriteParams): Promise<RpcResult<{ bytes: number }>> {
  try {
    await writeFile(p.path, p.content, 'utf-8')
    return { ok: true, data: { bytes: Buffer.byteLength(p.content, 'utf-8') } }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

async function handleEdit(p: EditParams): Promise<RpcResult<{ replacements: number }>> {
  try {
    const content = await readFile(p.path, 'utf-8')
    let updated: string
    let replacements = 0
    if (p.replaceAll) {
      const parts = content.split(p.oldString)
      replacements = parts.length - 1
      updated = parts.join(p.newString)
    } else {
      if (!content.includes(p.oldString)) {
        return { ok: false, error: 'oldString not found in file' }
      }
      const idx = content.indexOf(p.oldString)
      const second = content.indexOf(p.oldString, idx + 1)
      if (second !== -1) {
        return { ok: false, error: 'oldString matches multiple locations — set replaceAll:true or use a more specific oldString' }
      }
      updated = content.replace(p.oldString, p.newString)
      replacements = 1
    }
    await writeFile(p.path, updated, 'utf-8')
    return { ok: true, data: { replacements } }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

function handleBash(p: BashParams): Promise<RpcResult<{ stdout: string; stderr: string; exitCode: number | null }>> {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(p.command, { shell: true, cwd: p.cwd })
    } catch (e) {
      resolve({ ok: false, error: String(e) })
      return
    }
    const timer = setTimeout(() => child.kill('SIGTERM'), p.timeoutMs ?? 60_000)
    child.stdout?.on('data', (c: Buffer) => { stdout += c.toString('utf-8') })
    child.stderr?.on('data', (c: Buffer) => { stderr += c.toString('utf-8') })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ ok: true, data: { stdout, stderr, exitCode: code } })
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      resolve({ ok: false, error: String(err) })
    })
  })
}

// Simple glob: supports **, *, ?, and literal segments. Not a full globstar
// implementation — good enough for the 95% case of /rpc callers.
function globToRegex(pattern: string): RegExp {
  let src = ''
  let i = 0
  while (i < pattern.length) {
    const c = pattern[i]!
    if (c === '*' && pattern[i + 1] === '*') {
      src += '.*'
      i += 2
      if (pattern[i] === '/') i++  // consume trailing slash
    } else if (c === '*') {
      src += '[^/\\\\]*'
      i++
    } else if (c === '?') {
      src += '[^/\\\\]'
      i++
    } else if ('.+^$(){}|[]\\'.includes(c)) {
      src += '\\' + c
      i++
    } else {
      src += c
      i++
    }
  }
  return new RegExp('^' + src + '$')
}

async function walk(root: string, out: string[], maxEntries: number): Promise<void> {
  if (out.length >= maxEntries) return
  let entries: Awaited<ReturnType<typeof readdir>>
  try { entries = await readdir(root, { withFileTypes: true }) } catch { return }
  for (const entry of entries) {
    if (out.length >= maxEntries) return
    const full = join(root, entry.name)
    // Skip common noise
    if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.next') continue
    if (entry.isDirectory()) {
      await walk(full, out, maxEntries)
    } else if (entry.isFile()) {
      out.push(full)
    }
  }
}

async function handleGlob(p: GlobParams): Promise<RpcResult<string[]>> {
  try {
    const cwd = resolvePath(p.cwd ?? '.')
    const re = globToRegex(p.pattern)
    const all: string[] = []
    await walk(cwd, all, 10_000)
    const matches = all
      .map(f => relative(cwd, f).replace(/\\/g, '/'))
      .filter(f => re.test(f))
    return { ok: true, data: matches }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

async function handleGrep(p: GrepParams): Promise<RpcResult<Array<{ file: string; line: number; text: string }>>> {
  try {
    const root = resolvePath(p.path ?? '.')
    const globRe = p.glob ? globToRegex(p.glob) : null
    const re = new RegExp(p.pattern)
    const out: Array<{ file: string; line: number; text: string }> = []
    const max = p.max ?? 200
    const files: string[] = []
    await walk(root, files, 5_000)
    for (const f of files) {
      if (out.length >= max) break
      if (globRe && !globRe.test(relative(root, f).replace(/\\/g, '/'))) continue
      let content: string
      try {
        const s = await stat(f)
        if (s.size > 5 * 1024 * 1024) continue  // skip files >5MB
        content = await readFile(f, 'utf-8')
      } catch { continue }
      const lines = content.split('\n')
      for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i]!)) {
          out.push({ file: f, line: i + 1, text: lines[i]!.slice(0, 300) })
          if (out.length >= max) break
        }
      }
    }
    return { ok: true, data: out }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

// ─── HTTP dispatch ───────────────────────────────────────────────────────────

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf-8')
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

async function dispatch(method: string, params: unknown): Promise<RpcResult<unknown>> {
  const p = (params ?? {}) as Record<string, unknown>
  switch (method) {
    case 'read':  return handleRead(p as unknown as ReadParams)
    case 'write': return handleWrite(p as unknown as WriteParams)
    case 'edit':  return handleEdit(p as unknown as EditParams)
    case 'bash':  return handleBash(p as unknown as BashParams)
    case 'glob':  return handleGlob(p as unknown as GlobParams)
    case 'grep':  return handleGrep(p as unknown as GrepParams)
    default:      return { ok: false, error: `unknown method: ${method}` }
  }
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // Hard lock to 127.0.0.1
  const remote = req.socket.remoteAddress ?? ''
  if (remote !== '127.0.0.1' && remote !== '::1' && remote !== '::ffff:127.0.0.1') {
    sendJson(res, 403, { ok: false, error: 'rpc is bound to localhost only' })
    return
  }

  if (req.method !== 'POST') {
    sendJson(res, 405, { ok: false, error: 'POST required' })
    return
  }

  if (req.url !== '/rpc') {
    sendJson(res, 404, { ok: false, error: 'POST /rpc' })
    return
  }

  let body: string
  try { body = await readBody(req) } catch (e) { sendJson(res, 400, { ok: false, error: String(e) }); return }

  let payload: { method?: string; params?: unknown }
  try { payload = JSON.parse(body) } catch { sendJson(res, 400, { ok: false, error: 'invalid JSON' }); return }

  if (!payload.method) { sendJson(res, 400, { ok: false, error: 'missing method' }); return }

  try {
    const result = await dispatch(payload.method, payload.params)
    sendJson(res, 200, result)
  } catch (e) {
    sendJson(res, 500, { ok: false, error: String(e) })
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function startToolRpcServer(): Promise<void> {
  if (_server) return
  const preferred = parseInt(process.env.LOCALCLAWD_RPC_PORT ?? '', 10) || DEFAULT_PORT

  const server = createServer((req, res) => { void handleRequest(req, res) })

  return new Promise((resolve) => {
    server.on('error', (err) => {
      logForDebugging(`[rpc] bind error: ${err.message}`)
      resolve()
    })
    server.listen(preferred, '127.0.0.1', () => {
      const addr = server.address()
      if (addr && typeof addr === 'object') {
        _boundPort = addr.port
        _server = server
        logForDebugging(`[rpc] listening on 127.0.0.1:${_boundPort}`)
        // Write the port file for clients to discover
        void mkdir(join(homedir(), '.claude'), { recursive: true }).then(() =>
          writeFile(PORT_FILE, String(_boundPort), 'utf-8').catch(() => {}),
        )
      }
      resolve()
    })
  })
}

export function stopToolRpcServer(): void {
  if (_server) {
    _server.close()
    _server = null
    _boundPort = 0
  }
}

export function getRpcPort(): number {
  return _boundPort
}
