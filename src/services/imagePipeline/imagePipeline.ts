import { mkdir, writeFile, readFile, access } from 'fs/promises'
import { join } from 'path'
import { DEFAULT_COMFYUI_URL } from './comfyUI.js'

export interface WorkflowNode {
  class_type: string
  inputs: Record<string, unknown>
  _meta?: Record<string, unknown>
}

export interface PipelineConfig {
  backendUrl: string
  defaultWidth: number
  defaultHeight: number
  defaultSteps: number
  defaultCfg: number
  defaultSampler: string
  defaultModel: string
  outputDir: string
  defaultWorkflow?: string
}

const DEFAULT_CONFIG: PipelineConfig = {
  backendUrl: DEFAULT_COMFYUI_URL,
  defaultWidth: 512,
  defaultHeight: 512,
  defaultSteps: 20,
  defaultCfg: 7,
  defaultSampler: 'euler',
  defaultModel: '',
  outputDir: '.localclawd/image-pipeline/generated',
  defaultWorkflow: 'z_image_turbo',
}


export const DEFAULT_WORKFLOW: Record<string, WorkflowNode> = {
  '4': {
    class_type: 'CheckpointLoaderSimple',
    inputs: { ckpt_name: 'v1-5-pruned-emaonly.safetensors' },
  },
  '5': {
    class_type: 'EmptyLatentImage',
    inputs: { batch_size: 1, height: 512, width: 512 },
  },
  '6': {
    class_type: 'CLIPTextEncode',
    inputs: { clip: ['4', 1], text: '{{positive_prompt}}' },
  },
  '7': {
    class_type: 'CLIPTextEncode',
    inputs: { clip: ['4', 1], text: '{{negative_prompt}}' },
  },
  '3': {
    class_type: 'KSampler',
    inputs: {
      cfg: 7,
      denoise: 1,
      latent_image: ['5', 0],
      model: ['4', 0],
      negative: ['7', 0],
      positive: ['6', 0],
      sampler_name: 'euler',
      scheduler: 'normal',
      seed: 42,
      steps: 20,
    },
  },
  '8': {
    class_type: 'VAEDecode',
    inputs: { samples: ['3', 0], vae: ['4', 2] },
  },
  '9': {
    class_type: 'SaveImage',
    inputs: { filename_prefix: 'localclawd', images: ['8', 0] },
  },
}

export function injectPrompt(
  workflow: Record<string, WorkflowNode>,
  positivePrompt: string,
  negativePrompt: string,
  params: {
    seed?: number
    width?: number
    height?: number
    steps?: number
    cfg?: number
    model?: string
  } = {},
): Record<string, WorkflowNode> {
  // Step 1: deep clone + text template substitution
  const wf = replaceTemplatesDeep(JSON.parse(JSON.stringify(workflow)), {
    positive_prompt: positivePrompt,
    negative_prompt: negativePrompt,
  }) as Record<string, WorkflowNode>

  // Step 2: graph traversal for numeric/config params
  for (const node of Object.values(wf)) {
    const ct = node.class_type
    if (ct === 'KSampler' || ct === 'KSamplerAdvanced') {
      const posRef = node.inputs.positive as [string, number] | undefined
      const negRef = node.inputs.negative as [string, number] | undefined
      // Graph-based prompt injection (for workflows without {{}} templates)
      if (posRef?.[0] && wf[posRef[0]]?.class_type === 'CLIPTextEncode') {
        wf[posRef[0]].inputs.text = positivePrompt
      }
      if (negRef?.[0] && wf[negRef[0]]?.class_type === 'CLIPTextEncode') {
        wf[negRef[0]].inputs.text = negativePrompt
      }
      if (params.seed !== undefined) node.inputs.seed = params.seed
      if (params.steps !== undefined) node.inputs.steps = params.steps
      if (params.cfg !== undefined) node.inputs.cfg = params.cfg
    }
    if (node.class_type === 'EmptyLatentImage' || node.class_type === 'EmptySD3LatentImage') {
      if (params.width !== undefined) node.inputs.width = params.width
      if (params.height !== undefined) node.inputs.height = params.height
    }
    if (node.class_type === 'CheckpointLoaderSimple' && params.model) {
      node.inputs.ckpt_name = params.model
    }
  }

  return wf
}

function replaceTemplatesDeep(obj: unknown, vars: Record<string, string>): unknown {
  if (typeof obj === 'string') {
    let s = obj
    for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{{${k}}}`, v)
    return s
  }
  if (Array.isArray(obj)) return obj.map(item => replaceTemplatesDeep(item, vars))
  if (obj !== null && typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj as Record<string, unknown>).map(([k, v]) => [k, replaceTemplatesDeep(v, vars)])
    )
  }
  return obj
}

export async function loadWorkflow(
  projectRoot: string,
  name: string,
): Promise<Record<string, WorkflowNode> | null> {
  const wfBase = join(projectRoot, '.localclawd', 'image-pipeline', 'workflows')
  const filename = name.endsWith('.json') ? name : `${name}.json`

  // Try the name as a direct relative path first (e.g. "txt2img" or "comfyui/basicImage")
  try {
    const data = await readFile(join(wfBase, filename), 'utf-8')
    return JSON.parse(data) as Record<string, WorkflowNode>
  } catch {
    // fall through to basename search
  }

  // Search all workflows for a matching basename (e.g. "basicImage" matches "comfyui/basicImage.json")
  const all = await listWorkflows(projectRoot)
  const baseName = name.replace(/\.json$/, '').split(/[\\/]/).pop() ?? name
  const match = all.find(w => {
    const wBaseName = w.replace(/\.json$/, '').split(/[\\/]/).pop() ?? ''
    return wBaseName === baseName
  })
  if (!match) return null

  try {
    const data = await readFile(join(wfBase, match), 'utf-8')
    return JSON.parse(data) as Record<string, WorkflowNode>
  } catch {
    return null
  }
}

// Z-Image-Turbo workflow (API format, derived from official Comfy-Org template).
// Required models (download to ComfyUI/models/):
//   diffusion_models/z_image_turbo_bf16.safetensors
//   text_encoders/qwen_3_4b.safetensors
//   vae/ae.safetensors
export const Z_IMAGE_TURBO_WORKFLOW: Record<string, WorkflowNode> = {
  '28': { class_type: 'UNETLoader', inputs: { unet_name: 'z_image_turbo_bf16.safetensors', weight_dtype: 'default' } },
  '30': { class_type: 'CLIPLoader', inputs: { clip_name: 'qwen_3_4b.safetensors', type: 'lumina2' } },
  '29': { class_type: 'VAELoader', inputs: { vae_name: 'ae.safetensors' } },
  '27': { class_type: 'CLIPTextEncode', inputs: { clip: ['30', 0], text: '{{positive_prompt}}' } },
  '33': { class_type: 'ConditioningZeroOut', inputs: { conditioning: ['27', 0] } },
  '13': { class_type: 'EmptySD3LatentImage', inputs: { width: 1024, height: 1024, batch_size: 1 } },
  '11': { class_type: 'ModelSamplingAuraFlow', inputs: { model: ['28', 0], shift: 3 } },
  '3': {
    class_type: 'KSampler',
    inputs: {
      model: ['11', 0],
      positive: ['27', 0],
      negative: ['33', 0],
      latent_image: ['13', 0],
      seed: 42,
      steps: 8,
      cfg: 1,
      sampler_name: 'res_multistep',
      scheduler: 'simple',
      denoise: 1,
    },
  },
  '8': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['29', 0] } },
  '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'z-image-turbo', images: ['8', 0] } },
}


export async function scaffoldProject(projectRoot: string): Promise<{
  configPath: string
  created: string[]
  alreadyExisted: boolean
}> {
  const base = join(projectRoot, '.localclawd', 'image-pipeline')

  let alreadyExisted = false
  try {
    await access(join(base, 'config.json'))
    alreadyExisted = true
  } catch {
    // fresh install
  }

  const dirs = [base, join(base, 'workflows'), join(base, 'generated')]
  for (const dir of dirs) {
    await mkdir(dir, { recursive: true })
  }

  const created: string[] = []
  const configPath = join(base, 'config.json')

  if (!alreadyExisted) {
    await writeFile(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf-8')
    created.push('.localclawd/image-pipeline/config.json')
  }

  // Always ensure bundled workflow templates exist (idempotent, never overwrites user files)
  for (const [wfName, wfContent] of [
    ['txt2img.json', DEFAULT_WORKFLOW],
    ['z_image_turbo.json', Z_IMAGE_TURBO_WORKFLOW],
  ] as const) {
    const wfPath = join(base, 'workflows', wfName)
    try {
      await access(wfPath)
    } catch {
      await writeFile(wfPath, JSON.stringify(wfContent, null, 2), 'utf-8')
      created.push(`.localclawd/image-pipeline/workflows/${wfName}`)
    }
  }

  return { configPath, created, alreadyExisted }
}

export async function loadConfig(projectRoot: string): Promise<PipelineConfig | null> {
  try {
    const data = await readFile(join(projectRoot, '.localclawd', 'image-pipeline', 'config.json'), 'utf-8')
    return JSON.parse(data) as PipelineConfig
  } catch {
    return null
  }
}

export async function saveConfig(projectRoot: string, config: PipelineConfig): Promise<void> {
  await writeFile(
    join(projectRoot, '.localclawd', 'image-pipeline', 'config.json'),
    JSON.stringify(config, null, 2),
    'utf-8',
  )
}

export async function listPrompts(projectRoot: string): Promise<string[]> {
  try {
    const { readdir } = await import('fs/promises')
    const dir = join(projectRoot, '.localclawd', 'image-pipeline', 'prompts')
    const files = await readdir(dir)
    return files.filter(f => f.endsWith('.json'))
  } catch {
    return []
  }
}

// Returns paths relative to the workflows/ directory, e.g. ["txt2img.json", "comfyui/basicImage.json"]
export async function listWorkflows(projectRoot: string): Promise<string[]> {
  const base = join(projectRoot, '.localclawd', 'image-pipeline', 'workflows')
  const results: string[] = []

  async function scan(dir: string, rel: string): Promise<void> {
    try {
      const { readdir: rd } = await import('fs/promises')
      const entries = await rd(dir, { withFileTypes: true })
      for (const entry of entries) {
        const entryRel = rel ? `${rel}/${entry.name}` : entry.name
        if (entry.isDirectory()) {
          await scan(join(dir, entry.name), entryRel)
        } else if (entry.isFile() && entry.name.endsWith('.json')) {
          results.push(entryRel)
        }
      }
    } catch {
      // dir doesn't exist
    }
  }

  await scan(base, '')
  return results
}
