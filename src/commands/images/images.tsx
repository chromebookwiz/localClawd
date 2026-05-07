/**
 * /image <prompt> — generate an image via ComfyUI and save to ~/generatedimages/.
 *
 * Auto-detects ComfyUI at http://127.0.0.1:8188.
 * Falls back to the URL in .localclawd/image-pipeline/config.json if set.
 * Saves output as ~/generatedimages/TIMESTAMP_<slug>.png
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
import { loadConfig } from '../../services/imagePipeline/imagePipeline.js'
import { homedir } from 'os'
import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'

// ─── UI ───────────────────────────────────────────────────────────────────────

function ImageCard({
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function slugify(text: string, maxLen = 40): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, maxLen)
}

function timestamp(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`
}

async function downloadImage(url: string, filename: string, subfolder: string): Promise<ArrayBuffer | null> {
  try {
    const params = new URLSearchParams({ filename, subfolder, type: 'output' })
    const res = await fetch(`${url}/view?${params}`)
    if (!res.ok) return null
    return res.arrayBuffer()
  } catch {
    return null
  }
}

// ─── Command ──────────────────────────────────────────────────────────────────

export const call: LocalJSXCommandCall = async (onDone, _context, args) => {
  const prompt = args?.trim() ?? ''

  if (!prompt) {
    return (
      <ImageCard
        title="◆ /image"
        lines={[
          'Usage: /image <prompt>',
          'Generates an image via ComfyUI and saves it to ~/generatedimages/.',
          'Example: /image a misty forest at dawn, cinematic lighting',
        ]}
        onReady={() => onDone(undefined)}
      />
    )
  }

  const { getOriginalCwd } = await import('../../bootstrap/state.js')
  const projectRoot = getOriginalCwd() ?? process.cwd()
  const config = await loadConfig(projectRoot)
  const configuredUrl = config?.backendUrl ?? DEFAULT_COMFYUI_URL

  // Auto-detect: try localhost first, then configured URL
  let backendUrl = DEFAULT_COMFYUI_URL
  const localActive = await detectComfyUI(DEFAULT_COMFYUI_URL)
  if (!localActive) {
    if (configuredUrl !== DEFAULT_COMFYUI_URL && await detectComfyUI(configuredUrl)) {
      backendUrl = configuredUrl
    } else {
      return (
        <ImageCard
          title="◆ /image — No Backend"
          lines={[
            `ComfyUI not found at ${DEFAULT_COMFYUI_URL}${configuredUrl !== DEFAULT_COMFYUI_URL ? ` or ${configuredUrl}` : ''}.`,
            'Start ComfyUI or run: /image-pipeline config <url>',
          ]}
          color="red"
          onReady={() => onDone(undefined)}
        />
      )
    }
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
    '6': { class_type: 'CLIPTextEncode', inputs: { clip: ['4', 1], text: prompt } },
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
    queued = await queuePrompt(backendUrl, workflow)
  } catch (e) {
    return (
      <ImageCard
        title="◆ /image — Queue Error"
        lines={[String(e), 'Is ComfyUI running and a model loaded?']}
        color="red"
        onReady={() => onDone(undefined)}
      />
    )
  }

  const result = await pollForCompletion(backendUrl, queued.prompt_id)
  if (!result) {
    return (
      <ImageCard
        title="◆ /image — Timed Out"
        lines={[
          `Job queued: ${queued.prompt_id}`,
          `Check ComfyUI: ${backendUrl}/history/${queued.prompt_id}`,
        ]}
        color="yellow"
        onReady={() => onDone(undefined)}
      />
    )
  }

  // Download and save
  const outputDir = join(homedir(), 'generatedimages')
  await mkdir(outputDir, { recursive: true })

  const comfyImages = extractOutputImages(result)
  const savedPaths: string[] = []

  for (const imgFilename of comfyImages) {
    const subfolder = Object.values(result.outputs).flatMap(o => o.images ?? [])
      .find(img => img.filename === imgFilename)?.subfolder ?? ''

    const bytes = await downloadImage(backendUrl, imgFilename, subfolder)
    if (bytes) {
      const outName = `${timestamp()}_${slugify(prompt)}.png`
      const outPath = join(outputDir, outName)
      await writeFile(outPath, Buffer.from(bytes))
      savedPaths.push(outPath)
    }
  }

  const lines = savedPaths.length > 0
    ? [`Saved to: ${savedPaths.join('\n         ')}`, `Seed: ${seed}  ·  ${steps} steps  ·  ${width}×${height}  ·  ${model}`]
    : [
        `Job complete but download failed. Images in ComfyUI output folder.`,
        `Filenames: ${comfyImages.join(', ') || '(none)'}`,
        `Seed: ${seed}`,
      ]

  return (
    <ImageCard
      title="◆ /image — Done"
      lines={lines}
      color="green"
      onReady={() => onDone(undefined)}
    />
  )
}
