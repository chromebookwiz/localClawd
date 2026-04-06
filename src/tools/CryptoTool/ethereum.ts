/**
 * Minimal Ethereum toolkit — zero external dependencies.
 *
 * Implements:
 *  - Keccak-256 (pure JS, standard Keccak permutation)
 *  - secp256k1 key operations via Node.js createECDH
 *  - Address derivation from private key
 *  - EIP-155 transaction building + signing
 *  - JSON-RPC helpers (balance, nonce, gasPrice, broadcast)
 *
 * The private key is fetched from the secret store and never logged.
 */

import { createECDH, createPrivateKey, sign as cryptoSign } from 'crypto'
import { getSecret } from '../../services/secrets/secretStore.js'

// ─── Keccak-256 (pure JS) ────────────────────────────────────────────────────

function keccak256(data: Buffer): Buffer {
  const state = new BigUint64Array(25)
  const rateBytes = 136 // 1088 bits / 8
  const input = Buffer.concat([data, Buffer.alloc(0)])

  // Pad with multi-rate padding
  const padded = Buffer.alloc(Math.ceil((input.length + 1) / rateBytes) * rateBytes)
  input.copy(padded)
  padded[input.length] = 0x01
  padded[padded.length - 1] |= 0x80

  // Absorb
  for (let i = 0; i < padded.length; i += rateBytes) {
    for (let j = 0; j < rateBytes / 8; j++) {
      state[j] ^= padded.readBigUInt64LE(i + j * 8)
    }
    keccakF(state)
  }

  // Squeeze
  const out = Buffer.alloc(32)
  for (let i = 0; i < 4; i++) {
    out.writeBigUInt64LE(state[i]!, i * 8)
  }
  return out
}

const RC: bigint[] = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808An, 0x8000000080008000n,
  0x000000000000808Bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008An, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000An,
  0x000000008000808Bn, 0x800000000000008Bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800An, 0x800000008000000An,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
]

const ROTATIONS = [
   1, 62, 28, 27,  36,
  44,  6, 55, 20,   3,
  10, 43, 25, 39, 41,
  45, 15, 21,  8, 18,
   2, 61, 56, 14,
]

const PIXY = [
  10,  7, 11, 17, 18,
   3,  5, 16,  8, 21,
  24,  4, 15, 23, 19,
  13, 12,  2, 20, 14,
  22,  9,  6,  1,  0,
]

function rot64(n: bigint, r: number): bigint {
  r = r & 63
  return ((n << BigInt(r)) | (n >> BigInt(64 - r))) & 0xFFFFFFFFFFFFFFFFn
}

function keccakF(state: BigUint64Array): void {
  for (let round = 0; round < 24; round++) {
    // θ
    const c = new BigUint64Array(5)
    for (let x = 0; x < 5; x++)
      c[x] = state[x] ^ state[x + 5] ^ state[x + 10] ^ state[x + 15] ^ state[x + 20]
    const d = new BigUint64Array(5)
    for (let x = 0; x < 5; x++)
      d[x] = c[(x + 4) % 5]! ^ rot64(c[(x + 1) % 5]!, 1)
    for (let i = 0; i < 25; i++)
      state[i] ^= d[i % 5]!

    // ρ + π
    const b = new BigUint64Array(25)
    b[0] = state[0]
    for (let i = 1; i < 25; i++)
      b[PIXY[i - 1]!] = rot64(state[i]!, ROTATIONS[i - 1]!)

    // χ
    for (let x = 0; x < 5; x++)
      for (let y = 0; y < 5; y++) {
        const i = x + y * 5
        state[i] = b[i]! ^ (~b[((x + 1) % 5) + y * 5]! & b[((x + 2) % 5) + y * 5]!)
      }

    // ι
    state[0] ^= RC[round]!
  }
}

// ─── secp256k1 helpers ────────────────────────────────────────────────────────

/** Convert a raw 32-byte private key to a Node.js KeyObject (SEC1 DER) */
function rawPrivKeyToKeyObject(privKey: Buffer): ReturnType<typeof createPrivateKey> {
  // SEC1 DER structure for secp256k1:
  // SEQUENCE {
  //   INTEGER 1
  //   OCTET STRING <privKey>
  //   [0] OID secp256k1 (1.3.132.0.10)
  // }
  const oidSecp256k1 = Buffer.from('06052b8104000a', 'hex') // OID encoding
  const oidContext = Buffer.from([0xa0, oidSecp256k1.length, ...oidSecp256k1])
  const version = Buffer.from([0x02, 0x01, 0x01]) // INTEGER 1
  const privKeyOctet = Buffer.concat([Buffer.from([0x04, 0x20]), privKey])
  const seqContent = Buffer.concat([version, privKeyOctet, oidContext])
  const der = Buffer.concat([Buffer.from([0x30, seqContent.length]), seqContent])

  return createPrivateKey({ key: der, format: 'der', type: 'sec1' })
}

/** Derive Ethereum address from raw 32-byte private key */
export function privateKeyToAddress(privKey: Buffer): string {
  const ecdh = createECDH('secp256k1')
  ecdh.setPrivateKey(privKey)
  const pubKey = ecdh.getPublicKey() // 65 bytes uncompressed (04 prefix)
  const pubKeyNoPrefix = pubKey.slice(1) // 64 bytes
  const hash = keccak256(pubKeyNoPrefix) // 32 bytes
  const address = '0x' + hash.slice(12).toString('hex')
  return toChecksumAddress(address)
}

/** EIP-55 checksum encoding */
function toChecksumAddress(address: string): string {
  const addr = address.toLowerCase().replace('0x', '')
  const hash = keccak256(Buffer.from(addr, 'ascii')).toString('hex')
  let result = '0x'
  for (let i = 0; i < 40; i++) {
    result += parseInt(hash[i]!, 16) >= 8 ? addr[i]!.toUpperCase() : addr[i]!
  }
  return result
}

/** Sign an Ethereum message hash and return { r, s, v } */
export function ecSign(
  hash: Buffer,
  privKey: Buffer,
): { r: Buffer; s: Buffer; v: number } {
  const keyObj = rawPrivKeyToKeyObject(privKey)
  // Sign the pre-hashed data (algorithm = null means no additional hashing)
  const sig = cryptoSign(null, hash, {
    key: keyObj,
    dsaEncoding: 'ieee-p1363',
  })

  const r = sig.slice(0, 32)
  const s = sig.slice(32, 64)

  // Determine recovery bit by trying v=0 and v=1
  const ecdh = createECDH('secp256k1')
  ecdh.setPrivateKey(privKey)
  const expectedPub = ecdh.getPublicKey('hex')

  // Recovery: try both v=0 and v=1
  const v = recoverBit(hash, r, s, expectedPub)

  return { r, s, v }
}

function recoverBit(hash: Buffer, r: Buffer, s: Buffer, expectedPubHex: string): number {
  // Secp256k1 parameters
  const p = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2Fn
  const n = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n
  const Gx = 0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798n
  const Gy = 0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8n

  const rBig = bufToBig(r)
  const sBig = bufToBig(s)
  const eBig = bufToBig(hash)

  for (let recid = 0; recid < 4; recid++) {
    try {
      const x = rBig + BigInt(Math.floor(recid / 2)) * n
      if (x >= p) continue

      const y2 = (modpow(x, 3n, p) + 7n) % p
      let y = modpow(y2, (p + 1n) / 4n, p)
      if ((y & 1n) !== BigInt(recid & 1)) y = p - y

      const R = { x, y }
      const rInv = modInverse(rBig, n)
      // pubKey = r^-1 * (s*R - e*G)
      const sR = pointMul(R, sBig, p)
      const eG = pointMul({ x: Gx, y: Gy }, ((n - eBig) % n), p)
      const pub = pointAdd(sR, eG, p)
      if (!pub) continue

      const ecdh = createECDH('secp256k1')
      const pubHex = '04' +
        bigToHex(pub.x).padStart(64, '0') +
        bigToHex(pub.y).padStart(64, '0')

      if (pubHex === expectedPubHex) return recid & 1
    } catch { continue }
  }
  return 0
}

// ─── Minimal secp256k1 field math ────────────────────────────────────────────

function modpow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n
  base = base % mod
  while (exp > 0n) {
    if (exp & 1n) result = (result * base) % mod
    exp >>= 1n
    base = (base * base) % mod
  }
  return result
}

function modInverse(a: bigint, m: bigint): bigint {
  return modpow(a, m - 2n, m) // works for prime m
}

function pointAdd(
  P: { x: bigint; y: bigint },
  Q: { x: bigint; y: bigint },
  p: bigint,
): { x: bigint; y: bigint } | null {
  if (P.x === Q.x && P.y === Q.y) return pointDouble(P, p)
  const dx = ((Q.x - P.x) % p + p) % p
  const dy = ((Q.y - P.y) % p + p) % p
  const m = (dy * modInverse(dx, p)) % p
  const x = ((m * m - P.x - Q.x) % p + p) % p
  const y = ((m * (P.x - x) - P.y) % p + p) % p
  return { x, y }
}

function pointDouble(P: { x: bigint; y: bigint }, p: bigint): { x: bigint; y: bigint } {
  const m = (3n * P.x * P.x * modInverse(2n * P.y, p)) % p
  const x = ((m * m - 2n * P.x) % p + p) % p
  const y = ((m * (P.x - x) - P.y) % p + p) % p
  return { x, y }
}

function pointMul(
  P: { x: bigint; y: bigint },
  k: bigint,
  p: bigint,
): { x: bigint; y: bigint } {
  let R: { x: bigint; y: bigint } | null = null
  let Q = P
  while (k > 0n) {
    if (k & 1n) R = R ? pointAdd(R, Q, p) : Q
    Q = pointDouble(Q, p)
    k >>= 1n
  }
  return R!
}

function bufToBig(b: Buffer): bigint {
  return BigInt('0x' + b.toString('hex'))
}

function bigToHex(n: bigint): string {
  return n.toString(16)
}

// ─── RLP encoding ─────────────────────────────────────────────────────────────

function rlpEncode(input: Buffer | Buffer[]): Buffer {
  if (Buffer.isBuffer(input)) {
    if (input.length === 1 && input[0]! < 0x80) return input
    const lenBuf = encodeLength(input.length, 0x80)
    return Buffer.concat([lenBuf, input])
  }
  const encoded = input.map(rlpEncode)
  const joined = Buffer.concat(encoded)
  const lenBuf = encodeLength(joined.length, 0xc0)
  return Buffer.concat([lenBuf, joined])
}

function encodeLength(len: number, offset: number): Buffer {
  if (len < 56) return Buffer.from([offset + len])
  const lenOfLen = Math.ceil(Math.log2(len + 1) / 8)
  const buf = Buffer.alloc(lenOfLen)
  let l = len
  for (let i = lenOfLen - 1; i >= 0; i--) {
    buf[i] = l & 0xff
    l >>= 8
  }
  return Buffer.concat([Buffer.from([offset + 55 + lenOfLen]), buf])
}

function bigintToBuffer(n: bigint): Buffer {
  if (n === 0n) return Buffer.alloc(0)
  const hex = n.toString(16).padStart(n.toString(16).length + (n.toString(16).length % 2), '0')
  return Buffer.from(hex, 'hex')
}

// ─── JSON-RPC client ──────────────────────────────────────────────────────────

async function rpc(endpoint: string, method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
    signal: AbortSignal.timeout(15_000),
  })
  const json = await res.json() as { result?: unknown; error?: { message: string } }
  if (json.error) throw new Error(`RPC error: ${json.error.message}`)
  return json.result
}

function getRpcEndpoint(): string {
  return getSecret('eth_rpc_endpoint') ?? 'https://cloudflare-eth.com'
}

// ─── Public Ethereum API ─────────────────────────────────────────────────────

/** Wei → ETH (human readable) */
export function weiToEth(wei: bigint): string {
  const eth = Number(wei) / 1e18
  return eth.toFixed(6)
}

/** ETH string → Wei */
export function ethToWei(eth: string): bigint {
  const [int, dec = ''] = eth.split('.')
  const decPadded = dec.slice(0, 18).padEnd(18, '0')
  return BigInt(int!) * (10n ** 18n) + BigInt(decPadded)
}

export async function getBalance(address: string): Promise<bigint> {
  const endpoint = getRpcEndpoint()
  const result = await rpc(endpoint, 'eth_getBalance', [address, 'latest'])
  return BigInt(result as string)
}

export async function getChainId(): Promise<bigint> {
  const endpoint = getRpcEndpoint()
  const result = await rpc(endpoint, 'eth_chainId', [])
  return BigInt(result as string)
}

export async function getNonce(address: string): Promise<bigint> {
  const endpoint = getRpcEndpoint()
  const result = await rpc(endpoint, 'eth_getTransactionCount', [address, 'latest'])
  return BigInt(result as string)
}

export async function getGasPrice(): Promise<bigint> {
  const endpoint = getRpcEndpoint()
  const result = await rpc(endpoint, 'eth_gasPrice', [])
  return BigInt(result as string)
}

export async function sendRawTransaction(rawTx: Buffer): Promise<string> {
  const endpoint = getRpcEndpoint()
  const result = await rpc(endpoint, 'eth_sendRawTransaction', ['0x' + rawTx.toString('hex')])
  return result as string
}

export async function estimateGas(from: string, to: string, value: bigint): Promise<bigint> {
  const endpoint = getRpcEndpoint()
  const result = await rpc(endpoint, 'eth_estimateGas', [{
    from,
    to,
    value: '0x' + value.toString(16),
  }])
  return BigInt(result as string)
}

/**
 * Build, sign, and broadcast an EIP-155 ETH transfer.
 * Returns the transaction hash.
 */
export async function sendEth(
  privateKeyHex: string,
  toAddress: string,
  ethAmount: string,
  chainId: bigint,
): Promise<string> {
  const privKey = Buffer.from(privateKeyHex.replace('0x', ''), 'hex')
  const fromAddress = privateKeyToAddress(privKey)
  const value = ethToWei(ethAmount)
  const nonce = await getNonce(fromAddress)
  const gasPrice = await getGasPrice()
  const gasLimit = await estimateGas(fromAddress, toAddress, value)

  // EIP-155 signing: RLP([nonce, gasPrice, gasLimit, to, value, data, chainId, 0, 0])
  const signingData = rlpEncode([
    bigintToBuffer(nonce),
    bigintToBuffer(gasPrice),
    bigintToBuffer(gasLimit),
    Buffer.from(toAddress.replace('0x', ''), 'hex'),
    bigintToBuffer(value),
    Buffer.alloc(0), // data
    bigintToBuffer(chainId),
    Buffer.alloc(0), // v placeholder
    Buffer.alloc(0), // r placeholder
  ])

  const hash = keccak256(signingData)
  const { r, s, v: recid } = ecSign(hash, privKey)
  const v = chainId * 2n + 35n + BigInt(recid)

  const signedTx = rlpEncode([
    bigintToBuffer(nonce),
    bigintToBuffer(gasPrice),
    bigintToBuffer(gasLimit),
    Buffer.from(toAddress.replace('0x', ''), 'hex'),
    bigintToBuffer(value),
    Buffer.alloc(0),
    bigintToBuffer(v),
    r,
    s,
  ])

  return sendRawTransaction(signedTx)
}
