/**
 * /image <prompt>          — generate via default workflow
 * /image <name>: <prompt>  — generate via named workflow from .localclawd/image-pipeline/workflows/
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
import {
  loadConfig,
  loadWorkflow,
  injectPrompt,
  DEFAULT_WORKFLOW,
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

export const call: LocalJSXCommandCall = async (onDone, _context, args) => {
  const raw = args?.trim() ?? ''

  const { getOriginalCwd } = await import('../../bootstrap/state.js')
  const projectRoot = getOriginalCwd() ?? process.cwd()

  if (!raw) {
    const config = await loadConfig(projectRoot)
    const workflows = await listWorkflows(projectRoot)
    const defaultWf = config?.defaultWorkflow ?? '(built-in txt2img)'
    const lines = [
      '◆ /image — Generate an image via ComfyUI',
      '',
      '  Usage:   /image <prompt>',
      '  Workflow: /image <name>: <prompt>',
      '',
      '  Examples:',
      '    /image a misty forest at dawn, cinematic lighting',
      '    /image txt2img: an elderly scholar by candlelight',
      '',
      `  Default workflow: ${defaultWf}`,
    ]
    if (workflows.length > 0) {
      lines.push('  Available workflows:')
      for (const w of workflows) lines.push(`    • ${w.replace(/\.json$/, '')}`)
    } else {
      lines.push('  No project workflows — run /image-pipeline setup to scaffold')
    }
    lines.push('')
    lines.push('  ComfyUI must be running. To configure:')
    lines.push('    /image-pipeline setup        — scaffold project folders')
    lines.push('    /image-pipeline config <url> — set backend URL')
    lines.push('    /image-pipeline workflow <n> — set default workflow')
    onDone(lines.join('\n'), { display: 'system' })
    return null
  }

  // Parse optional workflow prefix: "name: prompt text"
  let workflowName: string | undefined
  let promptText = raw
  const colonIdx = raw.indexOf(':')
  if (colonIdx > 0) {
    const candidate = raw.slice(0, colonIdx).trim()
    if (/^[\w-]+$/.test(candidate)) {
      workflowName = candidate
      promptText = raw.slice(colonIdx + 1).trim()
    }
  }

  if (!promptText) {
    onDone('◆ /image — Prompt required\n\n  Usage: /image <name>: <prompt>', { display: 'system' })
    return null
  }

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
        '◆ /image — ComfyUI not found',
        '',
        `  Tried: ${configuredUrl}`,
        '  Start ComfyUI, then try again.',
        '  To set a remote URL: /image-pipeline config http://<host>:8000',
      ].join('\n'),
      { display: 'system' },
    )
    return null
  }

  const effectiveWorkflowName = workflowName ?? config?.defaultWorkflow
  let workflow = effectiveWorkflowName ? await loadWorkflow(projectRoot, effectiveWorkflowName) : null

  if (effectiveWorkflowName && !workflow) {
    onDone(
      [
        `◆ /image — Workflow not found: "${effectiveWorkflowName}"`,
        '',
        '  Run /image-pipeline list to see available workflows.',
        '  Falling back to built-in txt2img workflow.',
      ].join('\n'),
      { display: 'system' },
    )
    // fall through to built-in
  }

  if (!workflow) workflow = DEFAULT_WORKFLOW

  const model = config?.defaultModel || 'v1-5-pruned-emaonly.safetensors'
  const width = config?.defaultWidth ?? 512
  const height = config?.defaultHeight ?? 512
  const steps = config?.defaultSteps ?? 20
  const cfg = config?.defaultCfg ?? 7
  const seed = Math.floor(Math.random() * 2 ** 32)
  const negative = 'blurry, low quality, watermark, deformed'

  const finalWorkflow = injectPrompt(workflow, promptText, negative, { seed, model, width, height, steps, cfg })

  let queued: Awaited<ReturnType<typeof queuePrompt>>
  try {
    queued = await queuePrompt(backendUrl, finalWorkflow as Record<string, unknown>)
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

  const projectGenDir = join(projectRoot, '.localclawd', 'image-pipeline', 'generated')
  const useProjectDir = await access(projectGenDir).then(() => true).catch(() => false)
  const outputDir = useProjectDir ? projectGenDir : join(homedir(), 'generatedimages')
  await mkdir(outputDir, { recursive: true })

  const comfyImages = extractOutputImages(result)
  const savedPaths: string[] = []

  for (const imgFilename of comfyImages) {
    const imgMeta = Object.values(result.outputs)
      .flatMap(o => o.images ?? [])
      .find(img => img.filename === imgFilename)
    const subfolder = imgMeta?.subfolder ?? ''
    const imgType = imgMeta?.type ?? 'output'
    try {
      const params = new URLSearchParams({ filename: imgFilename, subfolder, type: imgType })
      const res = await fetch(`${backendUrl}/view?${params}`)
      if (res.ok) {
        const outName = `${timestamp()}_${slugify(promptText)}.png`
        await writeFile(join(outputDir, outName), Buffer.from(await res.arrayBuffer()))
        savedPaths.push(join(outputDir, outName))
      }
    } catch {
      // skip failed downloads
    }
  }

  const usedWorkflow = effectiveWorkflowName ?? 'built-in txt2img'
  const lines = savedPaths.length > 0
    ? [
        '◆ /image — Done',
        '',
        `  Saved to: ${savedPaths.join('\n            ')}`,
        `  Workflow: ${usedWorkflow}  ·  Seed: ${seed}  ·  ${steps} steps  ·  ${width}×${height}`,
      ]
    : [
        '◆ /image — Done (download failed)',
        '',
        '  Job complete but image download failed.',
        `  ComfyUI filenames: ${comfyImages.join(', ') || '(none)'}`,
        `  Workflow: ${usedWorkflow}  ·  Seed: ${seed}`,
      ]

  onDone(lines.join('\n'), { display: 'system' })
  return null
}
