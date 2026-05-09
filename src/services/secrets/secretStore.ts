/**
 * Per-project Encrypted Secret Store
 *
 * Secrets are stored AES-256-GCM encrypted in <project>/.localclawd/secrets.enc.
 *
 * Key derivation:
 *   1. LOCALCLAWD_SECRET_KEY env var — explicit passphrase (CI/CD, shared machines)
 *   2. Auto-generated per-project key stored in ~/.localclawd/keys/<project-id>.key
 *      (machine-local, never committed to the project directory)
 *
 * Both paths persist across restarts with no user configuration required.
 *
 * File format (binary):
 *   [4 bytes magic 'LCSC'] [1 byte version=1]
 *   [32 bytes salt] [12 bytes IV] [16 bytes authTag] [N bytes ciphertext]
 */

import {
  createCipheriv,
  createDecipheriv,
  pbkdf2Sync,
  randomBytes,
} from 'crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { basename, join, resolve } from 'path'
import { getProjectRoot } from '../../bootstrap/state.js'
import { logForDebugging } from '../../utils/debug.js'

// ─── Constants ────────────────────────────────────────────────────────────────

const MAGIC = Buffer.from('LCSC')
const VERSION = 1
const PBKDF2_ITERATIONS = 200_000

/** Machine-local key store — outside the project so keys are never committed. */
const MACHINE_KEYS_DIR = join(homedir(), '.localclawd', 'keys')

// ─── Path helpers (lazy — depend on project root set during setup) ────────────

function getProjectId(): string {
  const root = getProjectRoot()
  return basename(resolve(root))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64) || 'default'
}

function getSecretsFile(): string {
  return join(getProjectRoot(), '.localclawd', 'secrets.enc')
}

function getSecretsDir(): string {
  return join(getProjectRoot(), '.localclawd')
}

// ─── Key management ───────────────────────────────────────────────────────────

/**
 * Returns the passphrase for the current project.
 * - If LOCALCLAWD_SECRET_KEY is set, use it directly.
 * - Otherwise, load or generate a per-project key in ~/.localclawd/keys/.
 */
function getOrCreatePassphrase(): string {
  const envKey = process.env.LOCALCLAWD_SECRET_KEY
  if (envKey) return envKey

  const keyFile = join(MACHINE_KEYS_DIR, `${getProjectId()}.key`)
  if (existsSync(keyFile)) {
    return readFileSync(keyFile, 'utf-8').trim()
  }

  const newKey = randomBytes(32).toString('hex')
  mkdirSync(MACHINE_KEYS_DIR, { recursive: true })
  writeFileSync(keyFile, newKey, { mode: 0o600 })
  logForDebugging(`[secrets] Generated new project key for ${getProjectId()}`)
  return newKey
}

// ─── In-memory store ──────────────────────────────────────────────────────────

let _secrets: Map<string, string> = new Map()
let _loaded = false

// ─── Public API ──────────────────────────────────────────────────────────────

export function isSecretStorePersistent(): boolean {
  return true  // Always persistent in per-project mode
}

/** Initialize the store. Called once at startup after project root is set. */
export function initSecretStore(): void {
  try {
    const passphrase = getOrCreatePassphrase()
    _secrets = loadFromDisk(passphrase)
    logForDebugging(`[secrets] Loaded ${_secrets.size} secret(s) from ${getSecretsFile()}`)
  } catch (e) {
    logForDebugging(`[secrets] No existing secrets file (first run): ${e}`)
    _secrets = new Map()
  }
  _loaded = true
}

export function setSecret(name: string, value: string): void {
  ensureLoaded()
  _secrets.set(name, value)
  persist()
}

export function getSecret(name: string): string | undefined {
  ensureLoaded()
  return _secrets.get(name)
}

export function deleteSecret(name: string): boolean {
  ensureLoaded()
  const existed = _secrets.has(name)
  _secrets.delete(name)
  if (existed) persist()
  return existed
}

export function listSecretNames(): string[] {
  ensureLoaded()
  return [..._secrets.keys()].sort()
}

export function hasSecret(name: string): boolean {
  ensureLoaded()
  return _secrets.has(name)
}

// ─── Internals ────────────────────────────────────────────────────────────────

function ensureLoaded(): void {
  if (!_loaded) initSecretStore()
}

function persist(): void {
  try {
    saveToDisk(getOrCreatePassphrase())
  } catch (e) {
    logForDebugging(`[secrets] Failed to persist secrets: ${e}`, { level: 'warn' })
  }
}

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return pbkdf2Sync(passphrase, salt, PBKDF2_ITERATIONS, 32, 'sha256')
}

function saveToDisk(passphrase: string): void {
  const plaintext = JSON.stringify(Object.fromEntries(_secrets))
  const salt = randomBytes(32)
  const iv = randomBytes(12)
  const key = deriveKey(passphrase, salt)

  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ])
  const authTag = cipher.getAuthTag()

  const header = Buffer.from([VERSION])
  const file = Buffer.concat([MAGIC, header, salt, iv, authTag, ciphertext])

  mkdirSync(getSecretsDir(), { recursive: true })
  writeFileSync(getSecretsFile(), file, { mode: 0o600 })
}

function loadFromDisk(passphrase: string): Map<string, string> {
  const secretsFile = getSecretsFile()
  if (!existsSync(secretsFile)) return new Map()

  const file = readFileSync(secretsFile)

  if (!file.slice(0, 4).equals(MAGIC)) {
    throw new Error('Invalid secrets file format')
  }
  const version = file[4]
  if (version !== VERSION) {
    throw new Error(`Unsupported secrets file version: ${version}`)
  }

  let offset = 5
  const salt = file.slice(offset, offset + 32); offset += 32
  const iv = file.slice(offset, offset + 12); offset += 12
  const authTag = file.slice(offset, offset + 16); offset += 16
  const ciphertext = file.slice(offset)

  const key = deriveKey(passphrase, salt)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(authTag)

  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  const obj = JSON.parse(plaintext.toString('utf8')) as Record<string, string>
  return new Map(Object.entries(obj))
}
