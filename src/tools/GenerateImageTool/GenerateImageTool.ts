import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { homedir } from 'os'
import { access, mkdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import {
  detectComfyUI,
  DEFAULT_COMFYUI_URL,
  queuePrompt,
  pollForCompletion,
  extractOutputImages,
} from '../../services/imagePipeline/comfyUI.js'
import { loadConfig, loadWorkflow, injectPrompt, DEFAULT_WORKFLOW } from '../../services/imagePipeline/imagePipeline.js'
import { getCwd } from '../../utils/cwd.js'
import { DESCRIPTION, GENERATE_IMAGE_TOOL_NAME } from './prompt.js'
import {
  getToolUseSummary,
  renderToolResultMessage,
  renderToolUseErrorMessage,
  renderToolUseMessage,
  userFacingName,
} from './UI.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    prompt: z.string().describe('Positive text prompt describing the image to generate'),
    negative_prompt: z.string().optional().describe('What to exclude from the image (optional)'),
    workflow: z.string().optional().describe('Workflow name from .localclawd/image-pipeline/workflows/ (without .json). Omit to use default.'),
    width: z.number().int().min(64).max(2048).optional().describe('Width in pixels (default: 512)'),
    height: z.number().int().min(64).max(2048).optional().describe('Height in pixels (default: 512)'),
    steps: z.number().int().min(1).max(150).optional().describe('Sampling steps (default: 20)'),
    cfg: z.number().min(1).max(30).optional().describe('CFG / guidance scale (default: 7)'),
    model: z.string().optional().describe('Checkpoint filename (default: from config or v1-5-pruned-emaonly.safetensors)'),
    seed: z.number().int().optional().describe('Seed for reproducibility (default: random)'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    path: z.string().describe('Absolute path of the saved image file'),
    filename: z.string().describe('Filename of the saved image'),
    promptId: z.string().describe('ComfyUI prompt ID'),
    seed: z.number().describe('Seed used'),
    backend: z.string().describe('Backend URL used'),
    error: z.string().optional().describe('Error message if generation failed'),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

// Side-channel: store base64 image data keyed by output object reference.
// This avoids polluting the Output schema with large binary data.
// WeakMap auto-GCs when the output object is no longer referenced.
const imageDataCache = new WeakMap<object, { base64: string; mediaType: string }>()

function slugify(text: string, maxLen = 40): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, maxLen)
}

function timestamp(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`
}

export const GenerateImageTool = buildTool({
  name: GENERATE_IMAGE_TOOL_NAME,
  searchHint: 'generate an image using ComfyUI',
  maxResultSizeChars: 2_000,
  async description() {
    return DESCRIPTION
  },
  userFacingName,
  getToolUseSummary,
  getActivityDescription(input) {
    const s = getToolUseSummary(input)
    return s ? `Generating image ${s}` : 'Generating image'
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isConcurrencySafe() {
    return false
  },
  isReadOnly() {
    return false
  },
  toAutoClassifierInput(input) {
    return input.prompt
  },
  async checkPermissions(_input, _context) {
    return {
      behavior: 'ask' as const,
      message: 'localclawd wants to generate an image via ComfyUI and save it to ~/generatedimages/.',
    }
  },
  async prompt() {
    return DESCRIPTION
  },
  renderToolUseMessage,
  renderToolUseErrorMessage,
  renderToolResultMessage,
  async call(input, { abortController }) {
    const projectRoot = getCwd()
    const config = await loadConfig(projectRoot)
    const configuredUrl = config?.backendUrl ?? DEFAULT_COMFYUI_URL

    // Auto-detect backend: localhost first, then configured URL
    let backendUrl = DEFAULT_COMFYUI_URL
    if (!await detectComfyUI(DEFAULT_COMFYUI_URL)) {
      if (configuredUrl !== DEFAULT_COMFYUI_URL && await detectComfyUI(configuredUrl)) {
        backendUrl = configuredUrl
      } else {
        return {
          data: {
            path: '', filename: '', promptId: '', seed: 0, backend: configuredUrl,
            error: `ComfyUI not reachable at ${DEFAULT_COMFYUI_URL}${configuredUrl !== DEFAULT_COMFYUI_URL ? ` or ${configuredUrl}` : ''}. Start ComfyUI or run /image-pipeline config <url>.`,
          },
        }
      }
    }

    if (abortController.signal.aborted) {
      return { data: { path: '', filename: '', promptId: '', seed: 0, backend: backendUrl, error: 'Aborted' } }
    }

    const model = input.model ?? config?.defaultModel ?? 'v1-5-pruned-emaonly.safetensors'
    const width = input.width ?? config?.defaultWidth ?? 512
    const height = input.height ?? config?.defaultHeight ?? 512
    const steps = input.steps ?? config?.defaultSteps ?? 20
    const cfg = input.cfg ?? config?.defaultCfg ?? 7
    const seed = input.seed ?? Math.floor(Math.random() * 2 ** 32)
    const negativePrompt = input.negative_prompt ?? 'blurry, low quality, watermark, deformed'

    const workflowName = input.workflow ?? config?.defaultWorkflow
    const workflowBase = workflowName ? await loadWorkflow(projectRoot, workflowName) : null
    const workflow = injectPrompt(
      workflowBase ?? DEFAULT_WORKFLOW,
      input.prompt,
      negativePrompt,
      { seed, model, width, height, steps, cfg },
    )

    let queued: Awaited<ReturnType<typeof queuePrompt>>
    try {
      queued = await queuePrompt(backendUrl, workflow as Record<string, unknown>)
    } catch (e) {
      return {
        data: { path: '', filename: '', promptId: '', seed, backend: backendUrl, error: `Queue failed: ${String(e)}` },
      }
    }

    if (abortController.signal.aborted) {
      return { data: { path: '', filename: '', promptId: queued.prompt_id, seed, backend: backendUrl, error: 'Aborted' } }
    }

    const result = await pollForCompletion(backendUrl, queued.prompt_id)
    if (!result) {
      return {
        data: {
          path: '', filename: '', promptId: queued.prompt_id, seed, backend: backendUrl,
          error: `Timed out. Check ComfyUI: ${backendUrl}/history/${queued.prompt_id}`,
        },
      }
    }

    const comfyImages = extractOutputImages(result)
    const firstImage = comfyImages[0]
    if (!firstImage) {
      return {
        data: { path: '', filename: '', promptId: queued.prompt_id, seed, backend: backendUrl, error: 'Job completed but no output images found' },
      }
    }

    const allImageMeta = Object.values(result.outputs).flatMap(o => o.images ?? [])
    const imgMeta = allImageMeta.find(img => img.filename === firstImage)
    const subfolder = imgMeta?.subfolder ?? ''
    const imgType = imgMeta?.type ?? 'output'

    // Download from ComfyUI
    let rawBytes: Buffer | null = null
    try {
      const params = new URLSearchParams({ filename: firstImage, subfolder, type: imgType })
      const res = await fetch(`${backendUrl}/view?${params}`)
      if (res.ok) {
        rawBytes = Buffer.from(await res.arrayBuffer())
      }
    } catch {
      // download failed — proceed without image bytes
    }

    // Save to project pipeline folder if scaffolded, else ~/generatedimages/
    const projectGenDir = join(getCwd(), '.localclawd', 'image-pipeline', 'generated')
    const useProjectDir = await access(projectGenDir).then(() => true).catch(() => false)
    const outputDir = useProjectDir ? projectGenDir : join(homedir(), 'generatedimages')
    await mkdir(outputDir, { recursive: true })
    const outName = `${timestamp()}_${slugify(input.prompt)}.png`
    const savedPath = join(outputDir, outName)

    if (rawBytes) {
      await writeFile(savedPath, rawBytes)
    }

    const data: Output = {
      path: savedPath,
      filename: outName,
      promptId: queued.prompt_id,
      seed,
      backend: backendUrl,
    }

    // Store image bytes in side-channel for mapToolResultToToolResultBlockParam.
    // If we don't have the bytes from download, try reading the saved file.
    const imageBytes = rawBytes ?? await readFile(savedPath).catch(() => null)
    if (imageBytes && imageBytes.length > 0) {
      imageDataCache.set(data, {
        base64: imageBytes.toString('base64'),
        mediaType: 'image/png',
      })
    }

    return { data }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    if (output.error) {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result' as const,
        is_error: true,
        content: output.error,
      }
    }

    const imgData = imageDataCache.get(output)
    const textSummary = [
      `Image saved: ${output.path}`,
      `Seed: ${output.seed}  ·  Prompt ID: ${output.promptId}`,
      imgData
        ? 'Review the image above. If it does not match the description or has quality issues, call GenerateImage again with an improved prompt (up to 3 iterations total).'
        : `Image saved to ${output.path} — vision not available for inline review.`,
    ].join('\n')

    if (imgData) {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result' as const,
        content: [
          {
            type: 'image' as const,
            source: {
              type: 'base64' as const,
              data: imgData.base64,
              media_type: imgData.mediaType as 'image/png',
            },
          },
          {
            type: 'text' as const,
            text: textSummary,
          },
        ],
      }
    }

    return {
      tool_use_id: toolUseID,
      type: 'tool_result' as const,
      content: textSummary,
    }
  },
} satisfies ToolDef<InputSchema, Output>)
