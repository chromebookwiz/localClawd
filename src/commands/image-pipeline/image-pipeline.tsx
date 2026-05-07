/**
 * /image-pipeline — ComfyUI image generation pipeline.
 *
 * Usage:
 *   /image-pipeline              — show status + help
 *   /image-pipeline setup        — scaffold project dirs, detect ComfyUI
 *   /image-pipeline generate <p> — generate image, save to project generated/ folder
 *   /image-pipeline list         — list saved prompts and workflows
 *   /image-pipeline config <url> — set ComfyUI backend URL
 */

import type { LocalJSXCommandCall } from '../../types/command.js'
import { join } from 'path'
import { mkdir, writeFile } from 'fs/promises'
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

function timestamp(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`
}

function slugify(text: string, maxLen = 40): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, maxLen)
}

async function pickBackend(config: Awaited<ReturnType<typeof loadConfig>>): Promise<string | null> {
  if (await detectComfyUI(DEFAULT_COMFYUI_URL)) return DEFAULT_COMFYUI_URL
  const configured = config?.backendUrl
  if (configured && configured !== DEFAULT_COMFYUI_URL && await detectComfyUI(configured)) return configured
  return null
}

export const call: LocalJSXCommandCall = async (onDone, _context, args) => {
  const { getOriginalCwd } = await import('../../bootstrap/state.js')
  const projectRoot = getOriginalCwd() ?? process.cwd()
  const rawArgs = args?.trim() ?? ''
  const [subcmd, ...rest] = rawArgs ? rawArgs.split(/\s+/) : ['']
  const restText = rest.join(' ').trim()

  // ── status ────────────────────────────────────────────────────────────────
  if (!subcmd) {
    const config = await loadConfig(projectRoot)
    const backendUrl = config?.backendUrl ?? DEFAULT_COMFYUI_URL
    const active = await detectComfyUI(backendUrl)
    const scaffolded = config !== null
    const prompts = scaffolded ? await listPrompts(projectRoot) : []
    const workflows = scaffolded ? await listWorkflows(projectRoot) : []

    const lines: string[] = ['◆ Image Pipeline', '']

    if (active) {
      lines.push(`  ● ComfyUI active at ${backendUrl}`)
    } else {
      lines.push(`  ○ ComfyUI not found at ${backendUrl}`)
      lines.push(`  → Run: /image-pipeline config http://<host>:8188`)
    }

    if (scaffolded) {
      lines.push(`  Scaffold: .localclawd/image-pipeline/  (${prompts.length} prompts, ${workflows.length} workflows)`)
      lines.push(`  Output:   .localclawd/image-pipeline/generated/`)
    } else {
      lines.push(`  Not scaffolded — run: /image-pipeline setup`)
    }

    lines.push('')
    lines.push('  Commands:')
    lines.push('    /image-pipeline setup             — create project dirs and templates')
    lines.push('    /image-pipeline config <url>      — set ComfyUI backend URL')
    lines.push('    /image-pipeline generate <prompt> — generate image and save to project')
    lines.push('    /image-pipeline list              — list prompt/workflow templates')

    onDone(lines.join('\n'), { display: 'system' })
    return null
  }

  // ── setup ─────────────────────────────────────────────────────────────────
  if (subcmd === 'setup') {
    const { created, alreadyExisted } = await scaffoldProject(projectRoot)
    const config = await loadConfig(projectRoot)
    const backendUrl = config?.backendUrl ?? DEFAULT_COMFYUI_URL
    const active = await detectComfyUI(backendUrl)
    const outputDir = join(projectRoot, '.localclawd', 'image-pipeline', 'generated')

    const lines: string[] = ['◆ Image Pipeline — Setup', '']

    if (active) {
      lines.push(`  ● ComfyUI active at ${backendUrl}`)
    } else {
      lines.push(`  ○ ComfyUI not detected at ${backendUrl}`)
      lines.push(`  → To connect: /image-pipeline config http://<host>:8188`)
    }

    lines.push('')
    if (alreadyExisted) {
      lines.push('  Pipeline already scaffolded.')
    } else {
      lines.push(`  Created ${created.length} files:`)
      for (const f of created) lines.push(`    + ${f}`)
    }

    lines.push('')
    lines.push(`  Generated images will be saved to:`)
    lines.push(`    ${outputDir}`)

    onDone(lines.join('\n'), { display: 'system' })
    return null
  }

  // ── config ────────────────────────────────────────────────────────────────
  if (subcmd === 'config') {
    const newUrl = restText
    if (!newUrl || !newUrl.startsWith('http')) {
      onDone(
        '◆ Image Pipeline — Config\n\n  Usage: /image-pipeline config http://<host>:8188\n  Example: /image-pipeline config http://192.168.1.50:8188',
        { display: 'system' },
      )
      return null
    }

    await scaffoldProject(projectRoot)
    const existing = (await loadConfig(projectRoot)) ?? {
      backendUrl: DEFAULT_COMFYUI_URL,
      defaultWidth: 512, defaultHeight: 512, defaultSteps: 20, defaultCfg: 7,
      defaultSampler: 'euler', defaultModel: '', outputDir: '.localclawd/image-pipeline/generated',
    }
    existing.backendUrl = newUrl
    await saveConfig(projectRoot, existing)
    const active = await detectComfyUI(newUrl)

    const lines = [
      '◆ Image Pipeline — Config Saved',
      '',
      `  Backend URL: ${newUrl}`,
      active ? '  ● ComfyUI is reachable' : '  ○ ComfyUI not reachable yet (URL saved — start ComfyUI to connect)',
    ]

    onDone(lines.join('\n'), { display: 'system' })
    return null
  }

  // ── list ──────────────────────────────────────────────────────────────────
  if (subcmd === 'list') {
    const [prompts, workflows] = await Promise.all([listPrompts(projectRoot), listWorkflows(projectRoot)])
    const lines: string[] = ['◆ Image Pipeline — Templates', '']

    if (prompts.length === 0 && workflows.length === 0) {
      lines.push('  No templates yet.')
      lines.push('  Run /image-pipeline setup to scaffold the project.')
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

    onDone(lines.join('\n'), { display: 'system' })
    return null
  }

  // ── generate ──────────────────────────────────────────────────────────────
  const promptText = (subcmd === 'generate' || subcmd === 'gen') ? restText : rawArgs

  if (!promptText) {
    onDone(
      '◆ Image Pipeline — Generate\n\n  Usage: /image-pipeline generate <prompt>\n  Example: /image-pipeline generate a misty mountain at dawn, cinematic',
      { display: 'system' },
    )
    return null
  }

  const config = await loadConfig(projectRoot)
  const backend = await pickBackend(config)

  if (!backend) {
    const tried = config?.backendUrl ?? DEFAULT_COMFYUI_URL
    onDone(
      [
        '◆ Image Pipeline — No Backend',
        '',
        `  ComfyUI not reachable at ${tried}`,
        '  Start ComfyUI, then run: /image-pipeline generate <prompt>',
        '  Or set a remote URL:    /image-pipeline config http://<host>:8188',
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
    onDone(
      `◆ Image Pipeline — Queue Error\n\n  ${String(e)}\n  Is ComfyUI running and a model loaded?`,
      { display: 'system' },
    )
    return null
  }

  const result = await pollForCompletion(backend, queued.prompt_id)
  if (!result) {
    onDone(
      [
        '◆ Image Pipeline — Timed Out',
        '',
        `  Job queued: ${queued.prompt_id}`,
        `  Check: ${backend}/history/${queued.prompt_id}`,
      ].join('\n'),
      { display: 'system' },
    )
    return null
  }

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
        await writeFile(join(outputDir, outName), Buffer.from(await res.arrayBuffer()))
        savedPaths.push(join(outputDir, outName))
      }
    } catch {
      // skip failed downloads
    }
  }

  const lines = savedPaths.length > 0
    ? [
        '◆ Image Pipeline — Done',
        '',
        `  Saved ${savedPaths.length} image${savedPaths.length !== 1 ? 's' : ''}:`,
        ...savedPaths.map(p => `    ${p}`),
        `  Seed: ${seed}  ·  ${steps} steps  ·  ${width}×${height}  ·  ${model}`,
      ]
    : [
        '◆ Image Pipeline — Done (download failed)',
        '',
        `  Job complete but image download failed.`,
        `  Check ComfyUI output folder for: ${comfyImages.join(', ') || '(filenames unknown)'}`,
        `  Seed: ${seed}`,
      ]

  onDone(lines.join('\n'), { display: 'system' })
  return null
}
