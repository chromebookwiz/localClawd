/**
 * SecretsTool — encrypted secret management for the model.
 *
 * Provides three tools the model can call:
 *   secret_set    — store a named secret (API key, password, private key…)
 *   secret_get    — retrieve a secret by name
 *   secret_delete — delete a secret
 *   secret_list   — list secret names (values are NEVER shown in list)
 *
 * Secrets are encrypted with AES-256-GCM using a key derived from
 * LOCALCLAWD_SECRET_KEY env var. If the env var is absent, secrets live only
 * in memory for this session.
 */

import { z } from 'zod/v4'
import { buildTool } from '../../Tool.js'
import {
  deleteSecret,
  getSecret,
  isSecretStorePersistent,
  listSecretNames,
  setSecret,
} from '../../services/secrets/secretStore.js'

// ─── secret_set ───────────────────────────────────────────────────────────────

export const SecretSetTool = buildTool({
  name: 'secret_set',
  description: `Store a named secret securely. The value is encrypted with AES-256-GCM and ${
    process.env.LOCALCLAWD_SECRET_KEY
      ? 'persisted to disk (LOCALCLAWD_SECRET_KEY is set).'
      : 'kept in memory only this session (set LOCALCLAWD_SECRET_KEY to persist).'
  } Use this for API keys, passwords, wallet private keys, etc. The value is NEVER stored as plaintext.`,
  async prompt() {
    return 'Store a named secret securely (encrypted). Use for API keys, passwords, private keys, etc.'
  },
  inputSchema: z.object({
    name: z
      .string()
      .describe(
        'Name for the secret (e.g. "openai_api_key", "wallet_private_key"). Use snake_case.',
      ),
    value: z
      .string()
      .describe('The secret value to store. Will be encrypted immediately.'),
  }),
  isReadOnly: () => false,
  async call({ name, value }) {
    const cleanName = name.trim().toLowerCase().replace(/\s+/g, '_')
    if (!cleanName) {
      return { type: 'text' as const, text: 'Error: secret name cannot be empty.' }
    }
    setSecret(cleanName, value)
    const persistent = isSecretStorePersistent()
    return {
      type: 'text' as const,
      text: persistent
        ? `Secret "${cleanName}" stored (encrypted, persisted to disk).`
        : `Secret "${cleanName}" stored in memory (session-only — set LOCALCLAWD_SECRET_KEY to persist across restarts).`,
    }
  },
  renderToolUseMessage: (input: { name: string; value: string }) =>
    `Store secret: ${input.name} (${input.value.length} chars)`,
  renderToolResultMessage: (result: { type: string; text: string }) =>
    result.text,
})

// ─── secret_get ───────────────────────────────────────────────────────────────

export const SecretGetTool = buildTool({
  name: 'secret_get',
  description:
    'Retrieve a stored secret by name. Returns the decrypted value. Only call this when you actually need to use the value.',
  async prompt() {
    return 'Retrieve a stored secret by name. Returns the decrypted value.'
  },
  inputSchema: z.object({
    name: z.string().describe('The secret name to retrieve.'),
  }),
  isReadOnly: () => true,
  async call({ name }) {
    const value = getSecret(name.trim().toLowerCase())
    if (value === undefined) {
      const names = listSecretNames()
      const hint =
        names.length > 0
          ? ` Available secrets: ${names.join(', ')}`
          : ' No secrets stored yet.'
      return { type: 'text' as const, text: `Secret "${name}" not found.${hint}` }
    }
    return { type: 'text' as const, text: value }
  },
  renderToolUseMessage: (input: { name: string }) => `Get secret: ${input.name}`,
  renderToolResultMessage: (result: { type: string; text: string }) =>
    result.text.length > 60
      ? `${result.text.slice(0, 30)}…[${result.text.length} chars]`
      : result.text,
})

// ─── secret_delete ────────────────────────────────────────────────────────────

export const SecretDeleteTool = buildTool({
  name: 'secret_delete',
  description: 'Delete a stored secret permanently.',
  async prompt() { return 'Delete a stored secret permanently.' },
  inputSchema: z.object({
    name: z.string().describe('The secret name to delete.'),
  }),
  isReadOnly: () => false,
  isDestructive: () => true,
  async call({ name }) {
    const deleted = deleteSecret(name.trim().toLowerCase())
    return {
      type: 'text' as const,
      text: deleted ? `Secret "${name}" deleted.` : `Secret "${name}" not found.`,
    }
  },
  renderToolUseMessage: (input: { name: string }) => `Delete secret: ${input.name}`,
  renderToolResultMessage: (result: { type: string; text: string }) => result.text,
})

// ─── secret_list ─────────────────────────────────────────────────────────────

export const SecretListTool = buildTool({
  name: 'secret_list',
  description: 'List all stored secret names. Values are never shown in the list.',
  async prompt() { return 'List all stored secret names. Values are never shown in the list.' },
  inputSchema: z.object({}),
  isReadOnly: () => true,
  async call() {
    const names = listSecretNames()
    const persistent = isSecretStorePersistent()
    const header = persistent ? 'Secrets (encrypted, persisted):' : 'Secrets (session-only):'
    if (names.length === 0) {
      return { type: 'text' as const, text: `${header}\n  (none)` }
    }
    return {
      type: 'text' as const,
      text: `${header}\n${names.map(n => `  • ${n}`).join('\n')}`,
    }
  },
  renderToolUseMessage: () => 'List secrets',
  renderToolResultMessage: (result: { type: string; text: string }) => result.text,
})
