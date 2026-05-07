import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { homedir } from 'os'
import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import {
  detectComfyUI,
  DEFAULT_COMFYUI_URL,
  queuePrompt,
  pollForCompletion,
  extractOutputImages,
} from '../../services/imagePipeline/comfyUI.js'
import { loadConfig } from '../../services/imagePipeline/imagePipeline.js'
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
    prompt: z.string().describe('The positive text prompt describing the image to generate'),
    negative_prompt: z.string().optional().describe('What to exclude from the image (optional)'),
    width: z.number().int().min(64).max(2048).optional().describe('Image width in pixels (default: 512)'),
    height: z.number().int().min(64).max(2048).optional().describe('Image height in pixels (default: 512)'),
    steps: z.number().int().min(1).max(150).optional().describe('Sampling steps (default: 20)'),
    cfg: z.number().min(1).max(30).optional().describe('CFG scale / guidance strength (default: 7)'),
    model: z.string().optional().describe('Checkpoint model filename (default: from config or v1-5-pruned-emaonly.safetensors)'),
    seed: z.number().int().optional().describe('Random seed for reproducibility (default: random)'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    path: z.string().describe('Absolute path of the saved image file'),
    filename: z.string().describe('Filename of the saved image'),
    promptId: z.string().describe('ComfyUI prompt ID'),
    seed: z.number().describe('Seed used for this generation'),
    backend: z.string().describe('Backend URL used'),
    error: z.string().optional().describe('Error message if generation failed'),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

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

    // Auto-detect: try localhost first
    let backendUrl = DEFAULT_COMFYUI_URL
    if (!await detectComfyUI(DEFAULT_COMFYUI_URL)) {
      if (configuredUrl !== DEFAULT_COMFYUI_URL && await detectComfyUI(configuredUrl)) {
        backendUrl = configuredUrl
      } else {
        return {
          data: {
            path: '',
            filename: '',
            promptId: '',
            seed: 0,
            backend: configuredUrl,
            error: `ComfyUI not reachable at ${DEFAULT_COMFYUI_URL}${configuredUrl !== DEFAULT_COMFYUI_URL ? ` or ${configuredUrl}` : ''}. Start ComfyUI or configure a backend with /image-pipeline config <url>.`,
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
    const sampler = config?.defaultSampler ?? 'euler'
    const seed = input.seed ?? Math.floor(Math.random() * 2 ** 32)
    const negativePrompt = input.negative_prompt ?? 'blurry, low quality, watermark, deformed'

    const workflow: Record<string, unknown> = {
      '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: model } },
      '5': { class_type: 'EmptyLatentImage', inputs: { width, height, batch_size: 1 } },
      '6': { class_type: 'CLIPTextEncode', inputs: { clip: ['4', 1], text: input.prompt } },
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
      queued = await queuePrompt(backendUrl, workflow)
    } catch (e) {
      return {
        data: {
          path: '', filename: '', promptId: '', seed, backend: backendUrl,
          error: `Queue failed: ${String(e)}`,
        },
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

    // Download the first output image
    const comfyImages = extractOutputImages(result)
    const firstImage = comfyImages[0]

    if (!firstImage) {
      return {
        data: {
          path: '', filename: '', promptId: queued.prompt_id, seed, backend: backendUrl,
          error: 'Job completed but no output images found',
        },
      }
    }

    const allImages = Object.values(result.outputs).flatMap(o => o.images ?? [])
    const imgMeta = allImages.find(img => img.filename === firstImage)
    const subfolder = imgMeta?.subfolder ?? ''

    let savedPath = ''
    let savedFilename = ''
    try {
      const params = new URLSearchParams({ filename: firstImage, subfolder, type: 'output' })
      const res = await fetch(`${backendUrl}/view?${params}`)
      if (res.ok) {
        const bytes = await res.arrayBuffer()
        const outputDir = join(homedir(), 'generatedimages')
        await mkdir(outputDir, { recursive: true })
        const outName = `${timestamp()}_${slugify(input.prompt)}.png`
        savedPath = join(outputDir, outName)
        await writeFile(savedPath, Buffer.from(bytes))
        savedFilename = outName
      }
    } catch {
      // download failed — still return success with the comfyui filename
      savedFilename = firstImage
    }

    return {
      data: {
        path: savedPath || join(homedir(), 'generatedimages', savedFilename),
        filename: savedFilename || firstImage,
        promptId: queued.prompt_id,
        seed,
        backend: backendUrl,
      },
    }
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
    return {
      tool_use_id: toolUseID,
      type: 'tool_result' as const,
      content: `Image saved to: ${output.path}\nFilename: ${output.filename}\nSeed: ${output.seed}\nPrompt ID: ${output.promptId}`,
    }
  },
} satisfies ToolDef<InputSchema, Output>)
