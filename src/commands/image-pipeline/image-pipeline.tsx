/**
 * /image-pipeline — ComfyUI image generation pipeline.
 *
 * Usage:
 *   /image-pipeline              — show status + help
 *   /image-pipeline setup        — scaffold project dirs, detect ComfyUI
 *   /image-pipeline generate <p> — submit prompt, save to .localclawd/image-pipeline/generated/
 *   /image-pipeline list         — list saved prompts and workflows
 *   /image-pipeline config <url> — set ComfyUI backend URL
 */

import * as React from 'react'
import { Box, Text } from '../../ink.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
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

// ─── UI ──────────────────────────────────────────────────────────────────────

function PipelineCard({
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
        <Text key={i} dimColor={line === ''}>{line}</Text>
      ))}
    </Box>
  )
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timestamp(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`
}

function slugify(text: string, maxLen = 40): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, maxLen)
}

async function pickBackend(config: Awaited<ReturnType<typeof loadConfig>>): Promise<string | null> {
  const configured = config?.backendUrl ?? DEFAULT_COMFYUI_URL
  if (await detectComfyUI(DEFAULT_COMFYUI_URL)) return DEFAULT_COMFYUI_URL
  if (configured !== DEFAULT_COMFYUI_URL && await detectComfyUI(configured)) return configured
  return null
}

// ─── Command ─────────────────────────────────────────────────────────────────

export const call: LocalJSXCommandCall = async (onDone, _context, args) => {
  const { getOriginalCwd } = await import('../../bootstrap/state.js')
  const projectRoot = getOriginalCwd() ?? process.cwd()
  const rawArgs = args?.trim() ?? ''
  const [subcmd, ...rest] = rawArgs ? rawArgs.split(/\s+/) : ['']
  const restText = rest.join(' ').trim()

  // ── status (no args) ──────────────────────────────────────────────────────
  if (!subcmd) {
    const config = await loadConfig(projectRoot)
    const backendUrl = config?.backendUrl ?? DEFAULT_COMFYUI_URL
    const active = await detectComfyUI(backendUrl)
    const prompts = await listPrompts(projectRoot)
    const workflows = await listWorkflows(projectRoot)
    const scaffolded = config !== null

    const lines = [
      active ? `● ComfyUI active at ${backendUrl}` : `○ ComfyUI not found at ${backendUrl}`,
      scaffolded ? `  Scaffold: .localclawd/image-pipeline/ (${prompts.length} prompts, ${workflows.length} workflows)` : '  Not scaffolded — run /image-pipeline setup',
      '',
      '  /image-pipeline setup             scaffold project dirs',
      '  /image-pipeline generate <prompt> generate and save image',
      '  /image-pipeline config <url>      set ComfyUI URL',
      '  /image-pipeline list              list templates',
    ]

    return (
      <PipelineCard
        title="◆ Image Pipeline"
        lines={lines}
        color={active ? 'green' : 'yellow'}
        onReady={() => onDone(undefined)}
      />
    )
  }

  // ── setup ─────────────────────────────────────────────────────────────────
  if (subcmd === 'setup') {
    const { created, alreadyExisted } = await scaffoldProject(projectRoot)
    const config = await loadConfig(projectRoot)
    const backendUrl = config?.backendUrl ?? DEFAULT_COMFYUI_URL
    const active = await detectComfyUI(backendUrl)

    const lines: string[] = [
      active ? `● ComfyUI active at ${backendUrl}` : `○ ComfyUI not detected at ${backendUrl}`,
      '',
    ]

    if (alreadyExisted) {
      lines.push('  Pipeline already scaffolded.')
    } else {
      lines.push(`  Created ${created.length} files:`)
      for (const f of created) lines.push(`    + ${f}`)
    }

    if (!active) {
      lines.push('', '  To connect ComfyUI:', '    /image-pipeline config http://<host>:8188')
    }

    lines.push(
      '',
      '  Generated images will be saved to:',
      `    ${join(projectRoot, '.localclawd', 'image-pipeline', 'generated')}`,
    )

    return (
      <PipelineCard
        title="◆ Image Pipeline — Setup"
        lines={lines}
        color={active ? 'green' : 'yellow'}
        onReady={() => onDone(undefined)}
      />
    )
  }

  // ── config ────────────────────────────────────────────────────────────────
  if (subcmd === 'config') {
    const newUrl = restText
    if (!newUrl || !newUrl.startsWith('http')) {
      return (
        <PipelineCard
          title="◆ Image Pipeline — Config"
          lines={['Usage: /image-pipeline config http://<host>:8188']}
          color="yellow"
          onReady={() => onDone(undefined)}
        />
      )
    }

    const existing = (await loadConfig(projectRoot)) ?? {
      backendUrl: DEFAULT_COMFYUI_URL,
      defaultWidth: 512, defaultHeight: 512, defaultSteps: 20, defaultCfg: 7,
      defaultSampler: 'euler', defaultModel: '', outputDir: '.localclawd/image-pipeline/generated',
    }
    existing.backendUrl = newUrl
    await saveConfig(projectRoot, existing)
    const active = await detectComfyUI(newUrl)

    return (
      <PipelineCard
        title="◆ Image Pipeline — Config Saved"
        lines={[
          `  Backend URL: ${newUrl}`,
          active ? '  ● ComfyUI reachable' : '  ○ ComfyUI not reachable (saved anyway)',
        ]}
        color={active ? 'green' : 'yellow'}
        onReady={() => onDone(undefined)}
      />
    )
  }

  // ── list ──────────────────────────────────────────────────────────────────
  if (subcmd === 'list') {
    const [prompts, workflows] = await Promise.all([listPrompts(projectRoot), listWorkflows(projectRoot)])
    const lines: string[] = []

    if (prompts.length === 0 && workflows.length === 0) {
      lines.push('  No templates yet — run /image-pipeline setup')
    } else {
      if (prompts.length > 0) {
        lines.push('  Prompt templates:')
        for (const p of prompts) lines.push(`    • prompts/${p}`)
      }
      if (workflows.length > 0) {
        lines.push('  Workflows:')
        for (const w of workflows) lines.push(`    • workflows/${w}`)
      }
    }

    return (
      <PipelineCard
        title="◆ Image Pipeline — Templates"
        lines={lines}
        onReady={() => onDone(undefined)}
      />
    )
  }

  // ── generate ──────────────────────────────────────────────────────────────
  const promptText = (subcmd === 'generate' || subcmd === 'gen') ? restText : rawArgs
  if (!promptText) {
    return (
      <PipelineCard
        title="◆ Image Pipeline — Generate"
        lines={['  Usage: /image-pipeline generate <prompt>']}
        color="yellow"
        onReady={() => onDone(undefined)}
      />
    )
  }

  const config = await loadConfig(projectRoot)
  const backend = await pickBackend(config)
  if (!backend) {
    const tried = config?.backendUrl ?? DEFAULT_COMFYUI_URL
    return (
      <PipelineCard
        title="◆ Image Pipeline — No Backend"
        lines={[
          `  ComfyUI not reachable at ${tried}`,
          '  Start ComfyUI or run: /image-pipeline config <url>',
        ]}
        color="red"
        onReady={() => onDone(undefined)}
      />
    )
  }

  const model = config?.defaultModel || 'v1-5-pruned-emaonly.safetensors'
  const width = config?.defaultWidth ?? 512
  const height = config?.defaultHeight ?? 512
  const steps = config?.defaultSteps ?? 20
  const cfg = config?.defaultCfg ?? 7
  const sampler = config?.defaultSampler ?? 'euler'
  const seed = Math.floor(Math.random() * 2 ** 32)

  const workflow: Record<string, unknown> = {
    '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: model } },
    '5': { class_type: 'EmptyLatentImage', inputs: { width, height, batch_size: 1 } },
    '6': { class_type: 'CLIPTextEncode', inputs: { clip: ['4', 1], text: promptText } },
    '7': { class_type: 'CLIPTextEncode', inputs: { clip: ['4', 1], text: 'blurry, low quality, watermark, deformed' } },
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
    queued = await queuePrompt(backend, workflow)
  } catch (e) {
    return (
      <PipelineCard
        title="◆ Image Pipeline — Queue Error"
        lines={[`  ${String(e)}`]}
        color="red"
        onReady={() => onDone(undefined)}
      />
    )
  }

  const result = await pollForCompletion(backend, queued.prompt_id)
  if (!result) {
    return (
      <PipelineCard
        title="◆ Image Pipeline — Timed Out"
        lines={[
          `  Job queued: ${queued.prompt_id}`,
          `  Check: ${backend}/history/${queued.prompt_id}`,
        ]}
        color="yellow"
        onReady={() => onDone(undefined)}
      />
    )
  }

  // Download and save to <projectRoot>/.localclawd/image-pipeline/generated/
  const outputDir = join(projectRoot, '.localclawd', 'image-pipeline', 'generated')
  await mkdir(outputDir, { recursive: true })

  const comfyImages = extractOutputImages(result)
  const savedPaths: string[] = []

  for (const imgFilename of comfyImages) {
    const subfolder = Object.values(result.outputs)
      .flatMap(o => o.images ?? [])
      .find(img => img.filename === imgFilename)?.subfolder ?? ''
    try {
      const params = new URLSearchParams({ filename: imgFilename, subfolder, type: 'output' })
      const res = await fetch(`${backend}/view?${params}`)
      if (res.ok) {
        const outName = `${timestamp()}_${slugify(promptText)}.png`
        const outPath = join(outputDir, outName)
        await writeFile(outPath, Buffer.from(await res.arrayBuffer()))
        savedPaths.push(outPath)
      }
    } catch {
      // skip failed downloads
    }
  }

  const lines = savedPaths.length > 0
    ? [
        `  Saved ${savedPaths.length} image${savedPaths.length !== 1 ? 's' : ''}:`,
        ...savedPaths.map(p => `    ${p}`),
        `  Seed: ${seed}  ·  ${steps} steps  ·  ${width}×${height}  ·  ${model}`,
      ]
    : [
        `  Job complete — download failed, images in ComfyUI output folder.`,
        `  ComfyUI filenames: ${comfyImages.join(', ') || '(none)'}`,
        `  Seed: ${seed}`,
      ]

  return (
    <PipelineCard
      title="◆ Image Pipeline — Done"
      lines={lines}
      color={savedPaths.length > 0 ? 'green' : 'yellow'}
      onReady={() => onDone(undefined)}
    />
  )
}
