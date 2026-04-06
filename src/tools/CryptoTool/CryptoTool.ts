/**
 * CryptoTool — Ethereum send/receive for localClawd.
 *
 * Tools:
 *   eth_address  — derive Ethereum address from stored private key
 *   eth_balance  — get ETH balance of any address
 *   eth_send     — sign and broadcast an ETH transfer
 */

import { z } from 'zod/v4'
import { buildTool } from '../../Tool.js'
import { getSecret } from '../../services/secrets/secretStore.js'
import {
  privateKeyToAddress,
  getBalance,
  sendEth,
  weiToEth,
  getChainId,
} from './ethereum.js'

const getPrivKey = (): { key: string; error?: never } | { error: string; key?: never } => {
  const raw = getSecret('eth_private_key')
  if (!raw) {
    return { error: 'No private key found. Use secret_set to store "eth_private_key" first.' }
  }
  return { key: raw.replace('0x', '') }
}

// ─── eth_address ─────────────────────────────────────────────────────────────

export const EthAddressTool = buildTool({
  name: 'eth_address',
  description:
    'Derive the Ethereum address from the stored private key (secret "eth_private_key"). ' +
    'Use this to find out what address to receive ETH at.',
  inputSchema: z.object({}),
  isReadOnly: () => true,
  async call() {
    const res = getPrivKey()
    if (res.error) return { type: 'text' as const, text: res.error }
    try {
      const address = privateKeyToAddress(Buffer.from(res.key!, 'hex'))
      return { type: 'text' as const, text: `Ethereum address: ${address}` }
    } catch (e) {
      return { type: 'text' as const, text: `Error deriving address: ${e}` }
    }
  },
  renderToolUseMessage: () => 'Get Ethereum address',
  renderToolResultMessage: (r: { type: string; text: string }) => r.text,
})

// ─── eth_balance ──────────────────────────────────────────────────────────────

export const EthBalanceTool = buildTool({
  name: 'eth_balance',
  description:
    'Get the ETH balance of any Ethereum address. ' +
    'If no address is provided, uses the address derived from stored private key.',
  inputSchema: z.object({
    address: z
      .string()
      .optional()
      .describe(
        'Ethereum address (0x...). Defaults to the address from stored "eth_private_key".',
      ),
  }),
  isReadOnly: () => true,
  async call({ address }) {
    let targetAddress = address
    if (!targetAddress) {
      const res = getPrivKey()
      if (res.error) return { type: 'text' as const, text: res.error }
      targetAddress = privateKeyToAddress(Buffer.from(res.key!, 'hex'))
    }
    try {
      const wei = await getBalance(targetAddress)
      const eth = weiToEth(wei)
      return {
        type: 'text' as const,
        text: `Balance of ${targetAddress}: ${eth} ETH (${wei} wei)`,
      }
    } catch (e) {
      return { type: 'text' as const, text: `Error fetching balance: ${e}` }
    }
  },
  renderToolUseMessage: (input: { address?: string }) =>
    `Get balance: ${input.address ?? '(own address)'}`,
  renderToolResultMessage: (r: { type: string; text: string }) => r.text,
})

// ─── eth_send ────────────────────────────────────────────────────────────────

export const EthSendTool = buildTool({
  name: 'eth_send',
  description:
    'Sign and broadcast an ETH transfer using the stored private key ("eth_private_key"). ' +
    'Returns the transaction hash. The RPC endpoint defaults to Cloudflare Ethereum ' +
    'but can be overridden by storing "eth_rpc_endpoint" as a secret.',
  inputSchema: z.object({
    to: z.string().describe('Recipient Ethereum address (0x...)'),
    amount_eth: z
      .string()
      .describe('Amount of ETH to send as a decimal string, e.g. "0.01"'),
    chain_id: z
      .number()
      .optional()
      .describe(
        'Chain ID. Defaults to the network reported by the RPC endpoint. ' +
          '1 = Ethereum mainnet, 11155111 = Sepolia.',
      ),
  }),
  isReadOnly: () => false,
  isDestructive: () => true,
  async call({ to, amount_eth, chain_id }) {
    const res = getPrivKey()
    if (res.error) return { type: 'text' as const, text: res.error }

    try {
      const chainId = chain_id ? BigInt(chain_id) : await getChainId()
      const txHash = await sendEth(res.key!, to, amount_eth, chainId)
      return {
        type: 'text' as const,
        text: `Transaction submitted!\nHash: ${txHash}\nAmount: ${amount_eth} ETH → ${to}`,
      }
    } catch (e) {
      return { type: 'text' as const, text: `Error sending ETH: ${e}` }
    }
  },
  renderToolUseMessage: (input: { to: string; amount_eth: string }) =>
    `Send ${input.amount_eth} ETH → ${input.to.slice(0, 10)}…`,
  renderToolResultMessage: (r: { type: string; text: string }) => r.text,
})
