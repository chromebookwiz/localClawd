/**
 * /image <prompt> — generate an image via ComfyUI and save locally.
 *
 * Auto-detects ComfyUI at http://127.0.0.1:8188.
 * Falls back to the URL in .localclawd/image-pipeline/config.json if set.
 * Saves to .localclawd/image-pipeline/generated/ if scaffolded, else ~/generatedimages/.
 */

import type { LocalJSXCommandCall } from '../../types/command.js'
import { homedir } from 'os'
import { access, mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import {
  detectComfyUI,
  DEFAULT_COMFYUI_URL,
  queuePrompt,
  pollForCompletion,
  extractOutputImages,
} from '../../services/imagePipeline/comfyUI.js'
import { loadConfig } from '../../services/imagePipeline/imagePipeline.js'

function timestamp(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`
}

function slugify(text: string, maxLen = 40): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, maxLen)
}

export const call: LocalJSXCommandCall = async (onDone, _context, args) => {
  const prompt = args?.trim() ?? ''

  if (!prompt) {
    onDone(
      [
        '◆ /image — Generate an image via ComfyUI',
        '',
        '  Usage:   /image <prompt>',
        '  Example: /image a misty forest at dawn, cinematic lighting',
        '',
        '  ComfyUI must be running. To set a remote URL:',
        '    /image-pipeline config http://<host>:8188',
        '  To scaffold the project output folder:',
        '    /image-pipeline setup',
      ].join('\n'),
      { display: 'system' },
    )
    return null
  }

  const { getOriginalCwd } = await import('../../bootstrap/state.js')
  const projectRoot = getOriginalCwd() ?? process.cwd()
  const config = await loadConfig(projectRoot)
  const configuredUrl = config?.backendUrl ?? DEFAULT_COMFYUI_URL

  let backendUrl: string | null = null
  if (await detectComfyUI(DEFAULT_COMFYUI_URL)) {
    backendUrl = DEFAULT_COMFYUI_URL
  } else if (configuredUrl !== DEFAULT_COMFYUI_URL && await detectComfyUI(configuredUrl)) {
    backendUrl = configuredUrl
  }

  if (!backendUrl) {
    onDone(
      [
        '◆ /image — No Backend',
        '',
        `  ComfyUI not found at ${configuredUrl}`,
        '  Start ComfyUI, then try again.',
        '  To set a remote URL: /image-pipeline config http://<host>:8188',
      ].join('\n'),
      { display: 'system' },
    )
    return null
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
    onDone(
      `◆ /image — Queue Error\n\n  ${String(e)}\n  Is a model loaded in ComfyUI?`,
      { display: 'system' },
    )
    return null
  }

  const result = await pollForCompletion(backendUrl, queued.prompt_id)
  if (!result) {
    onDone(
      [
        '◆ /image — Timed Out',
        '',
        `  Job queued: ${queued.prompt_id}`,
        `  Check: ${backendUrl}/history/${queued.prompt_id}`,
      ].join('\n'),
      { display: 'system' },
    )
    return null
  }

  // Save to project generated/ if scaffolded, else ~/generatedimages/
  const projectGenDir = join(projectRoot, '.localclawd', 'image-pipeline', 'generated')
  const useProjectDir = await access(projectGenDir).then(() => true).catch(() => false)
  const outputDir = useProjectDir ? projectGenDir : join(homedir(), 'generatedimages')
  await mkdir(outputDir, { recursive: true })

  const comfyImages = extractOutputImages(result)
  const savedPaths: string[] = []

  for (const imgFilename of comfyImages) {
    const subfolder = Object.values(result.outputs)
      .flatMap(o => o.images ?? [])
      .find(img => img.filename === imgFilename)?.subfolder ?? ''
    try {
      const params = new URLSearchParams({ filename: imgFilename, subfolder, type: 'output' })
      const res = await fetch(`${backendUrl}/view?${params}`)
      if (res.ok) {
        const outName = `${timestamp()}_${slugify(prompt)}.png`
        await writeFile(join(outputDir, outName), Buffer.from(await res.arrayBuffer()))
        savedPaths.push(join(outputDir, outName))
      }
    } catch {
      // skip failed downloads
    }
  }

  const lines = savedPaths.length > 0
    ? [
        '◆ /image — Done',
        '',
        `  Saved to: ${savedPaths.join('\n            ')}`,
        `  Seed: ${seed}  ·  ${steps} steps  ·  ${width}×${height}  ·  ${model}`,
      ]
    : [
        '◆ /image — Done (download failed)',
        '',
        `  Job complete but image download failed.`,
        `  ComfyUI filenames: ${comfyImages.join(', ') || '(none)'}`,
        `  Seed: ${seed}`,
      ]

  onDone(lines.join('\n'), { display: 'system' })
  return null
}
