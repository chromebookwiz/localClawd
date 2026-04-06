/**
 * Encrypted Secret Store
 *
 * Secrets are stored encrypted (AES-256-GCM) in ~/.localclawd/secrets.enc.
 * The encryption key is derived via PBKDF2 from LOCALCLAWD_SECRET_KEY env var.
 * The plaintext value NEVER touches disk — only the ciphertext is persisted.
 *
 * If LOCALCLAWD_SECRET_KEY is not set, secrets are kept in-memory only
 * (lost on restart) and the model is warned.
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
import { join } from 'path'
import { logForDebugging } from '../../utils/debug.js'

// ─── Constants ────────────────────────────────────────────────────────────────

const MAGIC = Buffer.from('LCSC')
const VERSION = 1
const PBKDF2_ITERATIONS = 200_000
const SECRETS_DIR = join(homedir(), '.localclawd')
const SECRETS_FILE = join(SECRETS_DIR, 'secrets.enc')

// ─── In-memory store ──────────────────────────────────────────────────────────

let _secrets: Map<string, string> = new Map()
let _loaded = false
let _persistent = false

// ─── Public API ──────────────────────────────────────────────────────────────

export function isSecretStorePersistent(): boolean {
  return _persistent
}

/** Initialize the store. Called once at startup. */
export function initSecretStore(): void {
  const key = process.env.LOCALCLAWD_SECRET_KEY
  if (!key) {
    logForDebugging('[secrets] LOCALCLAWD_SECRET_KEY not set — using session-only store')
    _persistent = false
    _loaded = true
    return
  }
  _persistent = true
  try {
    _secrets = loadFromDisk(key)
    logForDebugging(`[secrets] Loaded ${_secrets.size} secret(s) from encrypted store`)
  } catch (e) {
    logForDebugging(`[secrets] Failed to load secrets (may be first run): ${e}`)
    _secrets = new Map()
  }
  _loaded = true
}

export function setSecret(name: string, value: string): void {
  ensureLoaded()
  _secrets.set(name, value)
  maybePersist()
}

export function getSecret(name: string): string | undefined {
  ensureLoaded()
  return _secrets.get(name)
}

export function deleteSecret(name: string): boolean {
  ensureLoaded()
  const existed = _secrets.has(name)
  _secrets.delete(name)
  if (existed) maybePersist()
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

function maybePersist(): void {
  const key = process.env.LOCALCLAWD_SECRET_KEY
  if (!_persistent || !key) return
  try {
    saveToDisk(key)
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

  mkdirSync(SECRETS_DIR, { recursive: true })
  writeFileSync(SECRETS_FILE, file, { mode: 0o600 })
}

function loadFromDisk(passphrase: string): Map<string, string> {
  if (!existsSync(SECRETS_FILE)) return new Map()

  const file = readFileSync(SECRETS_FILE)

  // Validate magic
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
