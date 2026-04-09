/**
 * WebScreenshotTool — capture a webpage as an image for visual analysis.
 *
 * Uses (in order):
 *  1. System Chromium/Chrome with --headless --screenshot (no install needed)
 *  2. SCREENSHOT_API_URL env var or configured secret — any endpoint accepting ?url=<url> and returning PNG
 *
 * Without a browser or API key, falls back to returning the page as
 * markdown text (same as WebFetchTool) so the model still gets content.
 *
 * Setup:
 *  - Chromium: ensure `chromium`, `chromium-browser`, or `google-chrome` is in PATH
 *  - API: set SCREENSHOT_API_URL=https://yourapi.com/screenshot
 */

import { execFile } from 'child_process'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { promisify } from 'util'
import { z } from 'zod/v4'
import { buildTool } from '../../Tool.js'
import { getSecret } from '../../services/secrets/secretStore.js'

const execFileAsync = promisify(execFile)

const CHROME_BINARIES = [
  'chromium',
  'chromium-browser',
  'google-chrome',
  'google-chrome-stable',
  'chrome',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
]

async function findChrome(): Promise<string | null> {
  for (const bin of CHROME_BINARIES) {
    try {
      await execFileAsync(bin, ['--version'], { timeout: 3000 })
      return bin
    } catch {
      continue
    }
  }
  return null
}

async function screenshotWithChrome(url: string, width = 1280, height = 800): Promise<Buffer | null> {
  const chrome = await findChrome()
  if (!chrome) return null

  const tmpDir = mkdtempSync(join(tmpdir(), 'lc-screenshot-'))
  const outFile = join(tmpDir, 'screenshot.png')

  try {
    await execFileAsync(
      chrome,
      [
        '--headless=new',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        `--window-size=${width},${height}`,
        `--screenshot=${outFile}`,
        url,
      ],
      { timeout: 20_000 },
    )
    const data = readFileSync(outFile)
    return data
  } catch {
    return null
  } finally {
    try { rmSync(tmpDir, { recursive: true, force: true }) } catch { /* ignore */ }
  }
}

async function screenshotViaApi(url: string, apiBase: string): Promise<Buffer | null> {
  try {
    const endpoint = `${apiBase.replace(/\/$/, '')}?url=${encodeURIComponent(url)}`
    const res = await fetch(endpoint, {
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) return null
    const buf = await res.arrayBuffer()
    return Buffer.from(buf)
  } catch {
    return null
  }
}

async function fetchPageText(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; localclawd/1.0)' },
      signal: AbortSignal.timeout(15_000),
    })
    const html = await res.text()
    // Strip tags to get readable text
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s{3,}/g, '\n')
      .trim()
      .slice(0, 8000)
  } catch (e) {
    return `Could not fetch page: ${e}`
  }
}

export const WebScreenshotTool = buildTool({
  name: 'web_screenshot',
  description: `Capture a webpage as a screenshot image for visual analysis, or fetch its text content.

Returns:
  - A PNG screenshot (as base64) if Chromium/Chrome is available in PATH, OR
  - A text extract if no browser is available

Setup for screenshots:
  • Install Chromium/Chrome and add to PATH, OR
  • Set SCREENSHOT_API_URL to a screenshot endpoint if Chrome is unavailable

Use this tool to:
  • Visually inspect webpage layouts
  • Read content from JavaScript-heavy pages
  • Capture dashboards or charts`,
  async prompt() {
    return 'Capture a webpage as a screenshot image for visual analysis, or fetch its text content if no browser is available.'
  },

  inputSchema: z.object({
    url: z.string().describe('The URL to screenshot or fetch'),
    width: z.number().optional().default(1280).describe('Viewport width in pixels'),
    height: z.number().optional().default(800).describe('Viewport height in pixels'),
    text_fallback: z
      .boolean()
      .optional()
      .default(true)
      .describe('If true (default), return page text when screenshot unavailable'),
  }),

  isReadOnly: () => true,

  async call({ url, width = 1280, height = 800, text_fallback = true }) {
    // Try screenshot API secret first
    const apiUrl =
      process.env.SCREENSHOT_API_URL ??
      getSecret('screenshot_api_url') ??
      getSecret('SCREENSHOT_API_URL')
    if (apiUrl) {
      const buf = await screenshotViaApi(url, apiUrl)
      if (buf) {
        return {
          type: 'image' as const,
          source: { type: 'base64' as const, mediaType: 'image/png' as const, data: buf.toString('base64') },
        }
      }
    }

    // Try system Chrome
    const buf = await screenshotWithChrome(url, width, height)
    if (buf) {
      return {
        type: 'image' as const,
        source: { type: 'base64' as const, mediaType: 'image/png' as const, data: buf.toString('base64') },
      }
    }

    // Fallback to text
    if (text_fallback) {
      const text = await fetchPageText(url)
      return {
        type: 'text' as const,
        text: `Screenshot unavailable (no browser found). Page text content:\n\nURL: ${url}\n\n${text}\n\n---\nTo enable screenshots: install Chromium and add to PATH, or set SCREENSHOT_API_URL.`,
      }
    }

    return {
      type: 'text' as const,
      text: `Screenshot failed. Install Chromium/Chrome in PATH or set SCREENSHOT_API_URL.`,
    }
  },

  renderToolUseMessage: (input: { url: string }) => `Screenshot: ${input.url}`,
  renderToolResultMessage: (result: { type: string; text?: string }) =>
    result.type === 'image' ? '📸 Screenshot captured' : (result.text?.slice(0, 80) ?? ''),
})
