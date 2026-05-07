import { mkdir, writeFile, readFile, access } from 'fs/promises'
import { join } from 'path'
import { DEFAULT_COMFYUI_URL } from './comfyUI.js'

export interface PipelineConfig {
  backendUrl: string
  defaultWidth: number
  defaultHeight: number
  defaultSteps: number
  defaultCfg: number
  defaultSampler: string
  defaultModel: string
  outputDir: string
}

const DEFAULT_CONFIG: PipelineConfig = {
  backendUrl: DEFAULT_COMFYUI_URL,
  defaultWidth: 512,
  defaultHeight: 512,
  defaultSteps: 20,
  defaultCfg: 7,
  defaultSampler: 'euler',
  defaultModel: '',
  outputDir: '.localclawd/image-pipeline/outputs',
}

const EXAMPLE_PROMPT = {
  name: 'example-character',
  description: 'Character portrait template',
  positive: 'a fantasy warrior, detailed armor, dramatic lighting, 4k, highly detailed',
  negative: 'blurry, low quality, text, watermark, deformed',
  width: 512,
  height: 512,
  steps: 20,
  cfg: 7,
  sampler: 'euler',
}

const TXT2IMG_WORKFLOW = {
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

const GENERATE_SH = `#!/usr/bin/env bash
# localclawd image pipeline — quick generate helper
# Usage: ./scripts/generate.sh "positive prompt" "negative prompt"

set -e
BACKEND="\${COMFYUI_URL:-http://127.0.0.1:8000}"
POSITIVE="\${1:-a fantasy warrior}"
NEGATIVE="\${2:-blurry, low quality}"
SEED=\${RANDOM}

echo "Submitting to \$BACKEND ..."
curl -s -X POST "\$BACKEND/prompt" -H "Content-Type: application/json" -d '{
  "prompt": {
    "4": {"class_type":"CheckpointLoaderSimple","inputs":{"ckpt_name":"v1-5-pruned-emaonly.safetensors"}},
    "5": {"class_type":"EmptyLatentImage","inputs":{"width":512,"height":512,"batch_size":1}},
    "6": {"class_type":"CLIPTextEncode","inputs":{"clip":["4",1],"text":"'"$POSITIVE"'"}},
    "7": {"class_type":"CLIPTextEncode","inputs":{"clip":["4",1],"text":"'"$NEGATIVE"'"}},
    "3": {"class_type":"KSampler","inputs":{"model":["4",0],"positive":["6",0],"negative":["7",0],"latent_image":["5",0],"seed":'"$SEED"',"steps":20,"cfg":7,"sampler_name":"euler","scheduler":"normal","denoise":1}},
    "8": {"class_type":"VAEDecode","inputs":{"samples":["3",0],"vae":["4",2]}},
    "9": {"class_type":"SaveImage","inputs":{"filename_prefix":"localclawd","images":["8",0]}}
  }
}' | python3 -m json.tool
echo "Check ComfyUI output folder or /history endpoint for results."
`

const GENERATE_PS1 = `# localclawd image pipeline — quick generate helper (PowerShell)
# Usage: .\\scripts\\generate.ps1 "positive prompt" "negative prompt"
param(
  [string]$Positive = "a fantasy warrior",
  [string]$Negative = "blurry, low quality"
)
$Backend = if ($env:COMFYUI_URL) { $env:COMFYUI_URL } else { "http://127.0.0.1:8000" }
$Seed = Get-Random
Write-Host "Submitting to $Backend ..."
$body = @{
  prompt = @{
    "4" = @{ class_type = "CheckpointLoaderSimple"; inputs = @{ ckpt_name = "v1-5-pruned-emaonly.safetensors" } }
    "5" = @{ class_type = "EmptyLatentImage"; inputs = @{ width = 512; height = 512; batch_size = 1 } }
    "6" = @{ class_type = "CLIPTextEncode"; inputs = @{ clip = @("4",1); text = $Positive } }
    "7" = @{ class_type = "CLIPTextEncode"; inputs = @{ clip = @("4",1); text = $Negative } }
    "3" = @{ class_type = "KSampler"; inputs = @{ model = @("4",0); positive = @("6",0); negative = @("7",0); latent_image = @("5",0); seed = $Seed; steps = 20; cfg = 7; sampler_name = "euler"; scheduler = "normal"; denoise = 1 } }
    "8" = @{ class_type = "VAEDecode"; inputs = @{ samples = @("3",0); vae = @("4",2) } }
    "9" = @{ class_type = "SaveImage"; inputs = @{ filename_prefix = "localclawd"; images = @("8",0) } }
  }
} | ConvertTo-Json -Depth 10
Invoke-RestMethod -Uri "$Backend/prompt" -Method POST -ContentType "application/json" -Body $body
Write-Host "Done! Check ComfyUI output folder."
`

const README_CONTENT = `# Image Pipeline — .localclawd/image-pipeline/

Project-local image generation configuration for localclawd + ComfyUI.

## Quick Start

1. Start ComfyUI on this machine (default port 8000)
2. Run \`/image-pipeline\` in localclawd to check status
3. Use \`/image-pipeline generate "your prompt"\` to submit a job
4. Or run \`bash .localclawd/image-pipeline/scripts/generate.sh "prompt"\`

## Structure

\`\`\`
config.json       — backend URL and default params
prompts/          — reusable prompt templates (JSON)
workflows/        — full ComfyUI workflow JSON files
outputs/          — local output reference (actual files saved by ComfyUI)
scripts/          — generate.sh / generate.ps1 helpers
\`\`\`

## Remote ComfyUI

Edit \`config.json\` → set \`backendUrl\` to your remote URL, e.g.:
\`http://192.168.1.50:8000\`  or  \`http://mymachine.local:8000\`

## Workflow Templates

\`workflows/txt2img.json\` is a standard KSampler workflow.
Load it in ComfyUI via Menu → Load, customize, and save new workflows here.
Replace \`{{positive_prompt}}\` / \`{{negative_prompt}}\` placeholders before submitting.
`

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

  const dirs = [base, join(base, 'prompts'), join(base, 'workflows'), join(base, 'outputs'), join(base, 'scripts')]
  for (const dir of dirs) {
    await mkdir(dir, { recursive: true })
  }

  const created: string[] = []
  const configPath = join(base, 'config.json')

  if (!alreadyExisted) {
    await writeFile(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf-8')
    created.push('.localclawd/image-pipeline/config.json')

    await writeFile(join(base, 'prompts', 'example.json'), JSON.stringify(EXAMPLE_PROMPT, null, 2), 'utf-8')
    created.push('.localclawd/image-pipeline/prompts/example.json')

    await writeFile(join(base, 'workflows', 'txt2img.json'), JSON.stringify(TXT2IMG_WORKFLOW, null, 2), 'utf-8')
    created.push('.localclawd/image-pipeline/workflows/txt2img.json')

    await writeFile(join(base, 'scripts', 'generate.sh'), GENERATE_SH, 'utf-8')
    created.push('.localclawd/image-pipeline/scripts/generate.sh')

    await writeFile(join(base, 'scripts', 'generate.ps1'), GENERATE_PS1, 'utf-8')
    created.push('.localclawd/image-pipeline/scripts/generate.ps1')

    await writeFile(join(base, 'README.md'), README_CONTENT, 'utf-8')
    created.push('.localclawd/image-pipeline/README.md')
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

export async function listWorkflows(projectRoot: string): Promise<string[]> {
  try {
    const { readdir } = await import('fs/promises')
    const dir = join(projectRoot, '.localclawd', 'image-pipeline', 'workflows')
    const files = await readdir(dir)
    return files.filter(f => f.endsWith('.json'))
  } catch {
    return []
  }
}
