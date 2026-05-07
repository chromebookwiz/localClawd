/**
 * /image-pipeline — ComfyUI image generation pipeline.
 *
 * Usage:
 *   /image-pipeline              — show status + help
 *   /image-pipeline setup        — scaffold project dirs, detect ComfyUI
 *   /image-pipeline generate <p> — submit prompt to ComfyUI queue
 *   /image-pipeline list         — list saved prompts and workflows
 *   /image-pipeline config <url> — set ComfyUI backend URL
 *   /image-pipeline <brief>      — scaffold + inject context for AI-driven setup
 *
 * Auto-detects ComfyUI at http://127.0.0.1:8188. Falls back to configured URL.
 * Scaffolds .localclawd/image-pipeline/ with templates on first run.
 */

import * as React from 'react'
import { Box, Text } from '../../ink.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import {
  detectComfyUI,
  DEFAULT_COMFYUI_URL,
  queuePrompt,
  pollForCompletion,
  extractOutputImages,
} from '../../services/imagePipeline/comfyUI.js'
import {
  scaffoldProject,
  loadConfig,
  saveConfig,
  listPrompts,
  listWorkflows,
} from '../../services/imagePipeline/imagePipeline.js'

// ─── UI helpers ───────────────────────────────────────────────────────────────

function Banner({
  title,
  lines,
  color,
  onReady,
}: {
  title: string
  lines: string[]
  color?: string
  onReady: () => void
}): React.ReactNode {
  React.useEffect(() => {
    const id = setTimeout(onReady, 0)
    return () => clearTimeout(id)
  }, [onReady])

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color={color ?? 'cyan'}>{title}</Text>
      {lines.map((line, i) => (
        <Text key={i} dimColor={i > 0}>{line}</Text>
      ))}
    </Box>
  )
}

function Spinner({ label }: { label: string }): React.ReactNode {
  return (
    <Box marginTop={1}>
      <Text color="cyan">{`◌ ${label}`}</Text>
    </Box>
  )
}

// ─── Status view ──────────────────────────────────────────────────────────────

async function showStatus(
  onDone: Parameters<LocalJSXCommandCall>[0],
  projectRoot: string,
): Promise<React.ReactNode> {
  const config = await loadConfig(projectRoot)
  const backendUrl = config?.backendUrl ?? DEFAULT_COMFYUI_URL
  const active = await detectComfyUI(backendUrl)

  let urlToUse = backendUrl
  let autoDetected = false
  if (!active && backendUrl !== DEFAULT_COMFYUI_URL) {
    const localActive = await detectComfyUI(DEFAULT_COMFYUI_URL)
    if (localActive) {
      urlToUse = DEFAULT_COMFYUI_URL
      autoDetected = true
    }
  }

  const prompts = await listPrompts(projectRoot)
  const workflows = await listWorkflows(projectRoot)

  const statusLine = (active || autoDetected)
    ? `● ComfyUI active at ${urlToUse}`
    : `○ ComfyUI not found at ${urlToUse}`

  const lines = [
    statusLine,
    `  Config: .localclawd/image-pipeline/config.json${config ? '' : ' (not scaffolded)'}`,
    `  Prompts: ${prompts.length} template${prompts.length !== 1 ? 's' : ''}  |  Workflows: ${workflows.length}`,
    '',
    '  Commands:',
    '    /image-pipeline setup             — scaffold project dirs',
    '    /image-pipeline generate <prompt> — submit to ComfyUI',
    '    /image-pipeline list              — list templates',
    '    /image-pipeline config <url>      — set backend URL',
  ]

  return (
    <Banner
      title="◆ Image Pipeline"
      lines={lines}
      color={active || autoDetected ? 'green' : 'yellow'}
      onReady={() => onDone(undefined)}
    />
  )
}

// ─── Generate view ────────────────────────────────────────────────────────────

async function runGenerate(
  onDone: Parameters<LocalJSXCommandCall>[0],
  projectRoot: string,
  prompt: string,
): Promise<React.ReactNode> {
  if (!prompt.trim()) {
    return (
      <Banner
        title="◆ Image Pipeline — Generate"
        lines={['Usage: /image-pipeline generate <positive prompt>']}
        color="yellow"
        onReady={() => onDone(undefined)}
      />
    )
  }

  const config = await loadConfig(projectRoot)
  const backendUrl = config?.backendUrl ?? DEFAULT_COMFYUI_URL

  let urlToUse = backendUrl
  const active = await detectComfyUI(backendUrl)
  if (!active && backendUrl !== DEFAULT_COMFYUI_URL) {
    if (await detectComfyUI(DEFAULT_COMFYUI_URL)) {
      urlToUse = DEFAULT_COMFYUI_URL
    }
  }

  if (!(await detectComfyUI(urlToUse))) {
    return (
      <Banner
        title="◆ Image Pipeline — Generate Failed"
        lines={[
          `ComfyUI not reachable at ${urlToUse}`,
          'Start ComfyUI or run /image-pipeline config <url> to set a remote backend.',
        ]}
        color="red"
        onReady={() => onDone(undefined)}
      />
    )
  }

  const negativePrompt = config ? '' : 'blurry, low quality, watermark'
  const width = config?.defaultWidth ?? 512
  const height = config?.defaultHeight ?? 512
  const steps = config?.defaultSteps ?? 20
  const cfg = config?.defaultCfg ?? 7
  const sampler = config?.defaultSampler ?? 'euler'
  const model = config?.defaultModel || 'v1-5-pruned-emaonly.safetensors'
  const seed = Math.floor(Math.random() * 2 ** 32)

  const workflow: Record<string, unknown> = {
    '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: model } },
    '5': { class_type: 'EmptyLatentImage', inputs: { width, height, batch_size: 1 } },
    '6': { class_type: 'CLIPTextEncode', inputs: { clip: ['4', 1], text: prompt } },
    '7': { class_type: 'CLIPTextEncode', inputs: { clip: ['4', 1], text: negativePrompt } },
    '3': {
      class_type: 'KSampler',
      inputs: {
        model: ['4', 0], positive: ['6', 0], negative: ['7', 0], latent_image: ['5', 0],
        seed, steps, cfg, sampler_name: sampler, scheduler: 'normal', denoise: 1,
      },
    },
    '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'localclawd', images: ['8', 0] } },
  }

  let queued: Awaited<ReturnType<typeof queuePrompt>>
  try {
    queued = await queuePrompt(urlToUse, workflow)
  } catch (e) {
    return (
      <Banner
        title="◆ Image Pipeline — Queue Error"
        lines={[String(e)]}
        color="red"
        onReady={() => onDone(undefined)}
      />
    )
  }

  const result = await pollForCompletion(urlToUse, queued.prompt_id)
  const images = result ? extractOutputImages(result) : []

  const lines = result
    ? [
        `Job complete: ${queued.prompt_id}`,
        `Output file${images.length !== 1 ? 's' : ''}: ${images.join(', ') || '(check ComfyUI output folder)'}`,
        `Seed: ${seed}  ·  ${steps} steps  ·  ${width}×${height}`,
      ]
    : [
        `Job queued: ${queued.prompt_id}`,
        'Timed out waiting for completion — check ComfyUI directly.',
        `URL: ${urlToUse}/history/${queued.prompt_id}`,
      ]

  return (
    <Banner
      title="◆ Image Pipeline — Generate"
      lines={lines}
      color={result ? 'green' : 'yellow'}
      onReady={() => onDone(undefined)}
    />
  )
}

// ─── List view ────────────────────────────────────────────────────────────────

async function showList(
  onDone: Parameters<LocalJSXCommandCall>[0],
  projectRoot: string,
): Promise<React.ReactNode> {
  const [prompts, workflows] = await Promise.all([listPrompts(projectRoot), listWorkflows(projectRoot)])

  const lines: string[] = []
  if (prompts.length === 0 && workflows.length === 0) {
    lines.push('No templates yet. Run /image-pipeline setup to scaffold the project.')
  } else {
    if (prompts.length > 0) {
      lines.push('Prompt templates:')
      for (const p of prompts) lines.push(`  • prompts/${p}`)
    }
    if (workflows.length > 0) {
      lines.push('Workflows:')
      for (const w of workflows) lines.push(`  • workflows/${w}`)
    }
  }

  return (
    <Banner
      title="◆ Image Pipeline — Templates"
      lines={lines}
      onReady={() => onDone(undefined)}
    />
  )
}

// ─── Config view ──────────────────────────────────────────────────────────────

async function updateConfig(
  onDone: Parameters<LocalJSXCommandCall>[0],
  projectRoot: string,
  newUrl: string,
): Promise<React.ReactNode> {
  if (!newUrl.startsWith('http')) {
    return (
      <Banner
        title="◆ Image Pipeline — Config"
        lines={['Invalid URL. Example: /image-pipeline config http://192.168.1.50:8188']}
        color="yellow"
        onReady={() => onDone(undefined)}
      />
    )
  }

  const existing = (await loadConfig(projectRoot)) ?? {
    backendUrl: DEFAULT_COMFYUI_URL,
    defaultWidth: 512, defaultHeight: 512, defaultSteps: 20, defaultCfg: 7,
    defaultSampler: 'euler', defaultModel: '', outputDir: '.localclawd/image-pipeline/outputs',
  }
  existing.backendUrl = newUrl
  await saveConfig(projectRoot, existing)

  const active = await detectComfyUI(newUrl)

  return (
    <Banner
      title="◆ Image Pipeline — Config Updated"
      lines={[
        `Backend URL: ${newUrl}`,
        active ? '● ComfyUI reachable' : '○ ComfyUI not reachable at that URL',
      ]}
      color={active ? 'green' : 'yellow'}
      onReady={() => onDone(undefined)}
    />
  )
}

// ─── Setup view ───────────────────────────────────────────────────────────────

async function runSetup(
  onDone: Parameters<LocalJSXCommandCall>[0],
  projectRoot: string,
): Promise<React.ReactNode> {
  const { created, alreadyExisted } = await scaffoldProject(projectRoot)

  const config = await loadConfig(projectRoot)
  const configuredUrl = config?.backendUrl ?? DEFAULT_COMFYUI_URL

  const localActive = await detectComfyUI(DEFAULT_COMFYUI_URL)
  let activeUrl: string | null = null
  if (localActive) {
    activeUrl = DEFAULT_COMFYUI_URL
  } else if (configuredUrl !== DEFAULT_COMFYUI_URL && await detectComfyUI(configuredUrl)) {
    activeUrl = configuredUrl
  }

  const comfyLine = activeUrl
    ? `● ComfyUI active at ${activeUrl}`
    : `○ ComfyUI not detected — run: /image-pipeline config <url>`

  const lines: string[] = [
    comfyLine,
    '',
    alreadyExisted
      ? '  Pipeline already scaffolded.'
      : `  Created ${created.length} files under .localclawd/image-pipeline/`,
  ]

  if (!alreadyExisted) {
    for (const f of created) lines.push(`    + ${f}`)
  }

  lines.push(
    '',
    '  Commands:',
    '    /image-pipeline                   — status',
    '    /image-pipeline generate <prompt> — submit to ComfyUI',
    '    /image-pipeline config <url>      — set backend URL',
    '    /image-pipeline list              — list templates',
    '    /image <prompt>                   — quick generate + save to ~/generatedimages/',
  )

  return (
    <Banner
      title="◆ Image Pipeline — Setup"
      lines={lines}
      color={activeUrl ? 'green' : 'yellow'}
      onReady={() => onDone(undefined)}
    />
  )
}

// ─── Command entry point ──────────────────────────────────────────────────────

export const call: LocalJSXCommandCall = async (onDone, _context, args) => {
  const { getOriginalCwd } = await import('../../bootstrap/state.js')
  const projectRoot = getOriginalCwd() ?? process.cwd()
  const rawArgs = args?.trim() ?? ''

  if (!rawArgs) {
    return showStatus(onDone, projectRoot)
  }

  const [subcmd, ...rest] = rawArgs.split(/\s+/)
  const restText = rest.join(' ').trim()

  if (subcmd === 'list') {
    return showList(onDone, projectRoot)
  }

  if (subcmd === 'config') {
    return updateConfig(onDone, projectRoot, restText)
  }

  if (subcmd === 'generate' || subcmd === 'gen') {
    const promptText = restText || rawArgs
    return runGenerate(onDone, projectRoot, promptText)
  }

  // setup or any unrecognised arg — scaffold + show status
  return runSetup(onDone, projectRoot)
}
