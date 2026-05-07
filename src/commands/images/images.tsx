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

function parseFlags(text: string): {
  cleaned: string
  steps?: number
  cfg?: number
  width?: number
  height?: number
  seed?: number
  model?: string
  negative?: string
} {
  let s = text
  const result: ReturnType<typeof parseFlags> = { cleaned: '' }
  const extract = (flag: string, fn: (v: string) => void) => {
    s = s.replace(new RegExp(`--${flag}\\s+(\\S+)`, 'i'), (_, v) => { fn(v); return '' })
  }
  extract('steps', v => { result.steps = parseInt(v, 10) || undefined })
  extract('cfg', v => { result.cfg = parseFloat(v) || undefined })
  extract('width', v => { result.width = parseInt(v, 10) || undefined })
  extract('height', v => { result.height = parseInt(v, 10) || undefined })
  extract('seed', v => { result.seed = parseInt(v, 10) })
  extract('model', v => { result.model = v })
  s = s.replace(/--negative\s+"([^"]+)"/i, (_, v) => { result.negative = v; return '' })
  s = s.replace(/--negative\s+'([^']+)'/i, (_, v) => { result.negative = v; return '' })
  result.cleaned = s.replace(/\s+/g, ' ').trim()
  return result
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
      '  Usage:   /image [flags] <prompt>',
      '  Workflow: /image <name>: [flags] <prompt>',
      '',
      '  Flags (override per-request):',
      '    --steps N    — sampling steps',
      '    --cfg N      — guidance scale',
      '    --width N    — image width in pixels',
      '    --height N   — image height in pixels',
      '    --seed N     — fixed seed for reproducibility',
      '    --model NAME — checkpoint filename',
      '',
      '  Examples:',
      '    /image a misty forest at dawn, cinematic lighting',
      '    /image --width 1024 --height 1024 a detailed portrait',
      '    /image txt2img: --steps 30 an elderly scholar by candlelight',
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
    lines.push('    /image-pipeline setup           — scaffold project folders')
    lines.push('    /image-pipeline config <url>    — set backend URL')
    lines.push('    /image-pipeline workflow <n>    — set default workflow')
    lines.push('    /image-pipeline defaults [...]  — set default parameters')
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

  // Extract --flags from the prompt text
  const flags = parseFlags(promptText)
  promptText = flags.cleaned

  if (!promptText) {
    onDone('◆ /image — Prompt required\n\n  Usage: /image [flags] <prompt>', { display: 'system' })
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

  const usingBuiltIn = !workflow
  if (!workflow) workflow = DEFAULT_WORKFLOW

  const seed = flags.seed ?? Math.floor(Math.random() * 2 ** 32)
  const negative = flags.negative ?? 'blurry, low quality, watermark, deformed'

  // For named workflows: preserve the workflow's own steps/cfg/size/model; only inject seed
  // and any explicit per-request flag overrides.
  // For the built-in fallback: inject all config defaults.
  const injectParams = usingBuiltIn
    ? {
        seed,
        model: flags.model ?? (config?.defaultModel || 'v1-5-pruned-emaonly.safetensors'),
        width: flags.width ?? config?.defaultWidth ?? 512,
        height: flags.height ?? config?.defaultHeight ?? 512,
        steps: flags.steps ?? config?.defaultSteps ?? 20,
        cfg: flags.cfg ?? config?.defaultCfg ?? 7,
      }
    : {
        seed,
        ...(flags.model ? { model: flags.model } : {}),
        ...(flags.width ? { width: flags.width } : {}),
        ...(flags.height ? { height: flags.height } : {}),
        ...(flags.steps ? { steps: flags.steps } : {}),
        ...(flags.cfg ? { cfg: flags.cfg } : {}),
      }

  const finalWorkflow = injectPrompt(workflow, promptText, negative, injectParams)

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
  const flagOverrides = [
    flags.steps ? `steps=${flags.steps}` : null,
    flags.cfg ? `cfg=${flags.cfg}` : null,
    flags.width ? `width=${flags.width}` : null,
    flags.height ? `height=${flags.height}` : null,
    flags.model ? `model=${flags.model}` : null,
  ].filter(Boolean).join(' ')
  const lines = savedPaths.length > 0
    ? [
        '◆ /image — Done',
        '',
        `  Saved to: ${savedPaths.join('\n            ')}`,
        `  Workflow: ${usedWorkflow}`,
        `  Prompt:   ${promptText.length > 80 ? promptText.slice(0, 80) + '…' : promptText}`,
        `  Seed:     ${seed}`,
        ...(flagOverrides ? [`  Overrides: ${flagOverrides}`] : []),
      ]
    : [
        '◆ /image — Done (download failed)',
        '',
        '  Job complete but image download failed.',
        `  ComfyUI filenames: ${comfyImages.join(', ') || '(none)'}`,
        `  Workflow: ${usedWorkflow}  ·  Seed: ${seed}`,
        `  Try fetching manually: ${backendUrl}/view?filename=${comfyImages[0] ?? ''}&type=output`,
      ]

  onDone(lines.join('\n'), { display: 'system' })
  return null
}
