/**
 * LocalWebSearchTool — web search for local LLM providers.
 *
 * Strategy (in priority order):
 *  1. Brave Search API — if BRAVE_API_KEY secret is set (best quality)
 *  2. DuckDuckGo HTML lite — no API key required (always available)
 *
 * To enable Brave: use secret_set to store BRAVE_API_KEY.
 * Set SEARXNG_URL secret for a self-hosted SearXNG instance.
 */

import { z } from 'zod/v4'
import { buildTool } from '../../Tool.js'
import { getAPIProvider } from '../../utils/model/providers.js'
import { getSecret } from '../../services/secrets/secretStore.js'

export const LOCAL_WEB_SEARCH_TOOL_NAME = 'web_search'

type SearchHit = {
  title: string
  url: string
  snippet: string
}

// ─── Brave Search ─────────────────────────────────────────────────────────────

async function braveSearch(query: string, apiKey: string, count = 8): Promise<SearchHit[]> {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}&text_decorations=false`
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'Accept-Encoding': 'gzip',
      'X-Subscription-Token': apiKey,
    },
    signal: AbortSignal.timeout(12_000),
  })
  if (!res.ok) throw new Error(`Brave Search API error: ${res.status}`)
  const data = await res.json() as {
    web?: { results?: Array<{ title?: string; url?: string; description?: string }> }
  }
  return (data.web?.results ?? []).map(r => ({
    title: r.title ?? '',
    url: r.url ?? '',
    snippet: r.description ?? '',
  }))
}

// ─── SearXNG ──────────────────────────────────────────────────────────────────

async function searxngSearch(query: string, baseUrl: string, count = 8): Promise<SearchHit[]> {
  const url = `${baseUrl.replace(/\/$/, '')}/search?q=${encodeURIComponent(query)}&format=json&pageno=1`
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(12_000),
  })
  if (!res.ok) throw new Error(`SearXNG error: ${res.status}`)
  const data = await res.json() as {
    results?: Array<{ title?: string; url?: string; content?: string }>
  }
  return (data.results ?? []).slice(0, count).map(r => ({
    title: r.title ?? '',
    url: r.url ?? '',
    snippet: r.content ?? '',
  }))
}

// ─── DuckDuckGo HTML (fallback) ───────────────────────────────────────────────

async function duckduckgoSearch(query: string, count = 8): Promise<SearchHit[]> {
  // Use the lite HTML endpoint — minimal JS, stable markup
  const body = `q=${encodeURIComponent(query)}&kl=en-us&kp=-2`
  const res = await fetch('https://lite.duckduckgo.com/lite/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent':
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
    },
    body,
    signal: AbortSignal.timeout(12_000),
  })
  if (!res.ok) throw new Error(`DuckDuckGo error: ${res.status}`)
  const html = await res.text()
  return parseDuckDuckGoLite(html, count)
}

function parseDuckDuckGoLite(html: string, maxResults: number): SearchHit[] {
  const hits: SearchHit[] = []

  // DDG lite table structure:
  // <a class="result-link" href="URL">TITLE</a>
  // <td class="result-snippet">SNIPPET</td>
  const linkRe = /<a[^>]+class="result-link"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
  const snippetRe = /<td[^>]+class="result-snippet"[^>]*>([\s\S]*?)<\/td>/gi

  const links: Array<[string, string]> = []
  const snippets: string[] = []

  let lm: RegExpExecArray | null
  while ((lm = linkRe.exec(html)) !== null && links.length < maxResults * 2) {
    const url = lm[1]!.trim()
    const title = lm[2]!.replace(/<[^>]+>/g, '').trim()
    if (url && title && !url.startsWith('//duckduckgo')) {
      links.push([url, title])
    }
  }

  let sm: RegExpExecArray | null
  while ((sm = snippetRe.exec(html)) !== null) {
    snippets.push(sm[1]!.replace(/<[^>]+>/g, '').trim())
  }

  for (let i = 0; i < Math.min(links.length, maxResults); i++) {
    hits.push({
      url: links[i]![0],
      title: links[i]![1],
      snippet: snippets[i] ?? '',
    })
  }

  // Fallback: try simpler href extraction if lite format changed
  if (hits.length === 0) {
    const hrefRe = /href="(https?:\/\/[^"]+)"[^>]*>([^<]{5,80})</gi
    let hm: RegExpExecArray | null
    while ((hm = hrefRe.exec(html)) !== null && hits.length < maxResults) {
      const url = hm[1]!
      const title = hm[2]!.trim()
      if (!url.includes('duckduckgo.com')) {
        hits.push({ url, title, snippet: '' })
      }
    }
  }

  return hits
}

// ─── Main search dispatcher ───────────────────────────────────────────────────

async function performSearch(query: string, allowedDomains?: string[], blockedDomains?: string[]): Promise<SearchHit[]> {
  let results: SearchHit[] = []
  const errors: string[] = []

  // 1. Try Brave
  const braveKey = getSecret('brave_api_key') ?? getSecret('BRAVE_API_KEY')
  if (braveKey) {
    try {
      results = await braveSearch(query, braveKey)
    } catch (e) {
      errors.push(`Brave: ${e}`)
    }
  }

  // 2. Try SearXNG
  if (results.length === 0) {
    const searxUrl = getSecret('searxng_url') ?? process.env.SEARXNG_URL
    if (searxUrl) {
      try {
        results = await searxngSearch(query, searxUrl)
      } catch (e) {
        errors.push(`SearXNG: ${e}`)
      }
    }
  }

  // 3. DuckDuckGo fallback
  if (results.length === 0) {
    try {
      results = await duckduckgoSearch(query)
    } catch (e) {
      errors.push(`DuckDuckGo: ${e}`)
    }
  }

  if (results.length === 0 && errors.length > 0) {
    throw new Error(`All search providers failed:\n${errors.join('\n')}`)
  }

  // Apply domain filters
  if (allowedDomains?.length) {
    const allowed = allowedDomains.map(d => d.toLowerCase())
    results = results.filter(r => {
      try {
        return allowed.some(d => new URL(r.url).hostname.includes(d))
      } catch { return false }
    })
  }
  if (blockedDomains?.length) {
    const blocked = blockedDomains.map(d => d.toLowerCase())
    results = results.filter(r => {
      try {
        return !blocked.some(d => new URL(r.url).hostname.includes(d))
      } catch { return true }
    })
  }

  return results
}

// ─── Tool definition ──────────────────────────────────────────────────────────

export const LocalWebSearchTool = buildTool({
  name: LOCAL_WEB_SEARCH_TOOL_NAME,
  description: `Search the web for current information, news, documentation, and research.
Returns titles, URLs, and snippets from top search results.

Providers (in priority):
  1. Brave Search API — store "brave_api_key" via secret_set for best results
  2. SearXNG — store "searxng_url" via secret_set for self-hosted search
  3. DuckDuckGo — always available, no setup required

After answering with search results, always include a Sources section with markdown links.`,

  inputSchema: z.object({
    query: z.string().min(2).describe('The search query'),
    allowed_domains: z
      .array(z.string())
      .optional()
      .describe('Only include results from these domains (e.g. ["github.com"])'),
    blocked_domains: z
      .array(z.string())
      .optional()
      .describe('Exclude results from these domains'),
  }),

  isReadOnly: () => true,

  isEnabled() {
    return getAPIProvider() === 'local'
  },

  async call({ query, allowed_domains, blocked_domains }) {
    const start = Date.now()
    let results: SearchHit[]
    try {
      results = await performSearch(query, allowed_domains, blocked_domains)
    } catch (e) {
      return { type: 'text' as const, text: `Search failed: ${e}` }
    }

    if (results.length === 0) {
      return { type: 'text' as const, text: `No results found for: ${query}` }
    }

    const dur = ((Date.now() - start) / 1000).toFixed(1)
    const lines = [
      `Search results for: **${query}** (${results.length} results, ${dur}s)\n`,
      ...results.map(
        (r, i) =>
          `${i + 1}. **[${r.title}](${r.url})**\n   ${r.snippet || '(no snippet)'}`,
      ),
      `\n**Sources:**\n${results.map(r => `- [${r.title}](${r.url})`).join('\n')}`,
    ]

    return { type: 'text' as const, text: lines.join('\n') }
  },

  renderToolUseMessage: (input: { query: string }) => `Search: ${input.query}`,
  renderToolResultMessage: (result: { type: string; text: string }) => {
    const lines = result.text.split('\n').filter(Boolean)
    return lines[0] ?? result.text
  },
})
