import { BASH_TOOL_NAME } from '../../tools/BashTool/toolName.js'
import { FILE_EDIT_TOOL_NAME } from '../../tools/FileEditTool/constants.js'
import { FILE_READ_TOOL_NAME } from '../../tools/FileReadTool/prompt.js'
import { FILE_WRITE_TOOL_NAME } from '../../tools/FileWriteTool/prompt.js'
import { GLOB_TOOL_NAME } from '../../tools/GlobTool/prompt.js'
import { GREP_TOOL_NAME } from '../../tools/GrepTool/prompt.js'
import { ASK_USER_QUESTION_TOOL_NAME } from '../../tools/AskUserQuestionTool/prompt.js'
import { POWERSHELL_TOOL_NAME } from '../../tools/PowerShellTool/toolName.js'
import { registerBundledSkill } from '../bundledSkills.js'

const SKILL_FILES = {
  'README.md': `# Local Image Pipeline Reference

Use this reference to create a project-local texture and image workflow under .localclawd/image-pipeline/.

## Goals

- Keep prompts, generator config, generated outputs, and review notes inside the project.
- Prefer local generation backends already running on the machine.
- Review final images visually when the current model can read images.

## Recommended Project Layout

\`\`\`
.localclawd/
  image-pipeline/
    config.json
    prompts/
    generated/
    reviews/
    workflows/
      comfyui/
      automatic1111/
\`\`\`

## Backend Priority

1. ComfyUI HTTP API on http://127.0.0.1:8188
2. Automatic1111 HTTP API on http://127.0.0.1:7860
3. A project-defined custom command in config.json

## ComfyUI Helper

- Copy the bundled helper into the project at \.localclawd/image-pipeline/helpers/comfyui-generate.mjs
- Feed it an API workflow JSON, not the UI-only workflow export with extra canvas metadata
- Use placeholders like {{prompt}}, {{negative_prompt}}, {{width}}, {{height}}, and {{seed}} in the workflow JSON so the helper can inject run-specific values
- The helper writes downloaded images and a run manifest into the chosen output directory

## Review Rubric For Game Textures

- Readability at intended size
- Seam quality for tiling textures
- Controlled value range and silhouette separation
- Palette fit with the project's art direction
- Edge noise, compression artifacts, and alpha cleanliness
- Whether the prompt should be tightened, simplified, or restyled
`,
  'templates/config.json': `{
  "defaultBackend": "comfyui",
  "backends": {
    "comfyui": {
      "enabled": true,
      "baseUrl": "http://127.0.0.1:8188",
      "workflow": ".localclawd/image-pipeline/workflows/comfyui/texture-2d.json",
      "helperScript": ".localclawd/image-pipeline/helpers/comfyui-generate.mjs"
    },
    "automatic1111": {
      "enabled": true,
      "baseUrl": "http://127.0.0.1:7860",
      "endpoint": "/sdapi/v1/txt2img"
    },
    "customCommand": {
      "enabled": false,
      "command": "",
      "notes": "Set this if your project uses InvokeAI, Fooocus, or another local generator."
    }
  },
  "outputDir": ".localclawd/image-pipeline/generated",
  "reviewDir": ".localclawd/image-pipeline/reviews"
}
`,
  'templates/review-template.md': `# Image Review

## Request

- Asset:
- Style:
- Target size:

## Findings

- Strengths:
- Weaknesses:
- Tiling / seams:
- Readability at size:
- Palette / material fit:

## Next Prompt Revision

\`\`\`
<fill in revised prompt>
\`\`\`
`,
  'templates/helpers/comfyui-generate.mjs': `#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

function printUsage() {
  console.error(
    [
      'Usage:',
      '  node comfyui-generate.mjs --workflow <workflow.json> --output-dir <dir> --prompt <text>',
      'Optional:',
      '  --api-base-url <url> --negative-prompt <text> --width <n> --height <n> --seed <n>',
      '  --prompt-json <file.json> --prefix <name> --poll-ms <n> --timeout-ms <n>',
    ].join('\n'),
  )
}

function parseArgs(argv) {
  const args = {}
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token || !token.startsWith('--')) continue
    const key = token.slice(2)
    const next = argv[index + 1]
    if (!next || next.startsWith('--')) {
      args[key] = 'true'
      continue
    }
    args[key] = next
    index += 1
  }
  return args
}

function toInt(value, fallback) {
  if (value === undefined) return fallback
  const parsed = Number.parseInt(String(value), 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function replacePlaceholders(raw, values) {
  return raw.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key) => {
    if (!(key in values)) return match
    return String(values[key])
  })
}

async function readPromptJson(filePath) {
  if (!filePath) return {}
  const raw = await readFile(filePath, 'utf8')
  const parsed = JSON.parse(raw)
  return typeof parsed === 'object' && parsed !== null ? parsed : {}
}

async function fetchJson(url, init) {
  const response = await fetch(url, init)
  if (!response.ok) {
    const text = await response.text()
    throw new Error('HTTP ' + response.status + ' from ' + url + ': ' + text)
  }
  return response.json()
}

async function fetchBytes(url) {
  const response = await fetch(url)
  if (!response.ok) {
    const text = await response.text()
    throw new Error('HTTP ' + response.status + ' from ' + url + ': ' + text)
  }
  const buffer = await response.arrayBuffer()
  return Buffer.from(buffer)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.workflow || !args['output-dir']) {
    printUsage()
    process.exitCode = 1
    return
  }

  const promptPayload = await readPromptJson(args['prompt-json'])
  const prompt = args.prompt ?? promptPayload.prompt
  if (!prompt) {
    throw new Error('Missing prompt. Pass --prompt or --prompt-json with a prompt field.')
  }

  const negativePrompt =
    args['negative-prompt'] ?? promptPayload.negative_prompt ?? ''
  const width = toInt(args.width ?? promptPayload.width, 1024)
  const height = toInt(args.height ?? promptPayload.height, 1024)
  const seed = toInt(args.seed ?? promptPayload.seed, -1)
  const prefix = args.prefix ?? promptPayload.prefix ?? 'comfyui'
  const apiBaseUrl = (args['api-base-url'] ?? 'http://127.0.0.1:8188').replace(/\/$/, '')
  const pollMs = toInt(args['poll-ms'], 1500)
  const timeoutMs = toInt(args['timeout-ms'], 180000)
  const workflowPath = path.resolve(args.workflow)
  const outputDir = path.resolve(args['output-dir'])

  const workflowRaw = await readFile(workflowPath, 'utf8')
  const hydratedWorkflowRaw = replacePlaceholders(workflowRaw, {
    prompt,
    negative_prompt: negativePrompt,
    width,
    height,
    seed,
  })
  const workflow = JSON.parse(hydratedWorkflowRaw)

  await mkdir(outputDir, { recursive: true })

  const queued = await fetchJson(apiBaseUrl + '/prompt', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      prompt: workflow,
      client_id: crypto.randomUUID(),
    }),
  })

  const promptId = queued.prompt_id
  if (!promptId) {
    throw new Error('ComfyUI did not return a prompt_id.')
  }

  const startedAt = Date.now()
  let historyEntry = null
  while (Date.now() - startedAt < timeoutMs) {
    const history = await fetchJson(apiBaseUrl + '/history/' + promptId)
    historyEntry = history?.[promptId] ?? null
    if (historyEntry?.outputs) {
      break
    }
    await sleep(pollMs)
  }

  if (!historyEntry?.outputs) {
    throw new Error('Timed out waiting for ComfyUI history for prompt ' + promptId)
  }

  const savedImages = []
  let imageIndex = 0
  for (const [nodeId, output] of Object.entries(historyEntry.outputs)) {
    if (!output || typeof output !== 'object') continue
    const images = output.images
    if (!Array.isArray(images)) continue
    for (const image of images) {
      if (!image || typeof image !== 'object') continue
      const filename = image.filename
      const subfolder = image.subfolder ?? ''
      const type = image.type ?? 'output'
      if (typeof filename !== 'string') continue
      const query = new URLSearchParams({ filename, subfolder, type })
      const bytes = await fetchBytes(apiBaseUrl + '/view?' + query.toString())
      imageIndex += 1
      const ext = path.extname(filename) || '.png'
      const targetName = prefix + '-' + String(imageIndex).padStart(2, '0') + ext
      const targetPath = path.join(outputDir, targetName)
      await writeFile(targetPath, bytes)
      savedImages.push({ nodeId, source: filename, path: targetPath })
    }
  }

  const manifestPath = path.join(outputDir, prefix + '-run.json')
  await writeFile(
    manifestPath,
    JSON.stringify(
      {
        promptId,
        apiBaseUrl,
        workflowPath,
        prompt,
        negativePrompt,
        width,
        height,
        seed,
        images: savedImages,
      },
      null,
      2,
    ),
    'utf8',
  )

  console.log(
    JSON.stringify(
      {
        promptId,
        outputDir,
        manifestPath,
        imageCount: savedImages.length,
        images: savedImages,
      },
      null,
      2,
    ),
  )
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
`,
  'templates/comfyui/texture-2d.json': `{
  "note": "Export an API workflow from ComfyUI and replace this placeholder graph with real nodes. The helper replaces {{prompt}}, {{negative_prompt}}, {{width}}, {{height}}, and {{seed}} before sending the workflow to /prompt.",
  "expectedInputs": ["prompt", "negative_prompt", "width", "height", "seed"],
  "placeholderTokens": {
    "prompt": "{{prompt}}",
    "negative_prompt": "{{negative_prompt}}",
    "width": "{{width}}",
    "height": "{{height}}",
    "seed": "{{seed}}"
  }
}
`,
  'templates/comfyui/prompt.json': `{
  "prompt": "stylized hand-painted stone floor texture, seamless tile, game-ready, top-down, readable pattern language, subtle wear",
  "negative_prompt": "text, watermark, logo, frame, perspective scene, blurry, muddy values, noisy clutter",
  "width": 1024,
  "height": 1024,
  "seed": -1,
  "prefix": "stone-floor"
}
`,
  'templates/automatic1111/payload.json': `{
  "prompt": "stylized hand-painted stone floor texture, seamless tile, game-ready, top-down, material definition, clean lighting",
  "negative_prompt": "text, watermark, logo, frame, blurry, muddy, photoreal clutter, perspective view",
  "width": 1024,
  "height": 1024,
  "steps": 28,
  "cfg_scale": 7,
  "sampler_name": "DPM++ 2M Karras",
  "tile": true
}
`,
  'templates/prompt-brief.md': `# Texture Brief

- Asset type:
- Theme:
- Material:
- Resolution:
- Tileable: yes/no
- Readability constraints:
- Palette constraints:
- Engine/runtime notes:
`,
} as const

const IMAGE_PIPELINE_PROMPT = `# Local Image Generation And Review Pipeline

You are setting up or using a project-local workflow for generating and reviewing game textures and related images.

## Core Contract

- Keep the workflow inside the current project under \`.localclawd/image-pipeline/\`.
- Prefer local image generators already running on the user's machine.
- Never switch to a hosted image service unless the user explicitly asks.
- If the project does not already have this pipeline, create the scaffold immediately.
- When images are generated and the current runtime can read images, review them visually with the Read tool before declaring them good.
- If visual image review is unavailable or fails, say that clearly and fall back to reviewing prompts, filenames, metadata, and pipeline outputs only.

## When To Use This Skill

Use this whenever the user asks to:

- set up a local texture or concept-art pipeline
- generate sprites, icons, UI images, materials, decals, or tiling textures locally
- prompt-tune local image generation for a game project
- review generated images and suggest prompt revisions

## Required Workflow

1. Inspect the project for existing art-direction files, asset folders, naming conventions, and engine-specific constraints.
2. Ensure the project-local scaffold exists at \`.localclawd/image-pipeline/\` with \`config.json\`, \`prompts/\`, \`generated/\`, \`reviews/\`, and \`workflows/\`.
3. If the user only asked for setup, stop after scaffolding the pipeline, summarizing what was created, and identifying the configured local backend path.
4. If the user asked for an actual generation task, create a prompt brief under \`.localclawd/image-pipeline/prompts/\` that records the asset goal, style, constraints, and the final generation prompt.
5. Choose the local backend in this order unless the project already specifies one:
   - ComfyUI HTTP API on \`http://127.0.0.1:8188\`
   - Automatic1111 HTTP API on \`http://127.0.0.1:7860\`
   - a custom local command defined in \`.localclawd/image-pipeline/config.json\`
6. For ComfyUI, prefer installing the bundled helper into \`.localclawd/image-pipeline/helpers/comfyui-generate.mjs\` and invoking it with Node against a project-local API workflow JSON.
7. Use the shell tool appropriate to the environment to invoke the local generator, and write outputs into a dated subdirectory under \`.localclawd/image-pipeline/generated/\`.
8. If the workflow file is only a placeholder, replace it with a real ComfyUI API workflow export before trying to generate.
9. Review the strongest generated candidates. For each reviewed output, check:
   - readability at target size
   - palette and material fit
   - seam quality for tiling textures
   - silhouette/value separation
   - alpha cleanliness, edge noise, and artifacts
10. Write a concise review note under \`.localclawd/image-pipeline/reviews/\` with concrete prompt changes for the next iteration.

## ComfyUI Helper Usage

- Preferred command form: \`node .localclawd/image-pipeline/helpers/comfyui-generate.mjs --workflow .localclawd/image-pipeline/workflows/comfyui/texture-2d.json --prompt-json .localclawd/image-pipeline/prompts/<asset>.json --output-dir .localclawd/image-pipeline/generated/<run-name>\`
- The helper posts to \`/prompt\`, polls \`/history/<prompt_id>\`, downloads images from \`/view\`, and writes a run manifest JSON.
- Keep prompt JSON files project-local so iterations are reproducible.

## Tooling Rules

- Use ${FILE_READ_TOOL_NAME}, ${FILE_WRITE_TOOL_NAME}, and ${FILE_EDIT_TOOL_NAME} for project files.
- Use ${GLOB_TOOL_NAME} and ${GREP_TOOL_NAME} to inspect existing asset conventions.
- Use ${BASH_TOOL_NAME} or ${POWERSHELL_TOOL_NAME} only for local generator execution and filesystem commands that require the shell.
- Use ${ASK_USER_QUESTION_TOOL_NAME} only if a missing backend choice, art direction, or asset target blocks progress.

## Output Rules

- Be explicit about which backend was configured or detected.
- Do not claim an image looks good unless you actually reviewed it visually.
- When you review images, give short, concrete art-direction feedback and at least one better prompt revision.
`

export function registerImagePipelineSkill(): void {
  registerBundledSkill({
    name: 'image-pipeline',
    description:
      'Set up and operate a project-local image generation and review pipeline for game textures, sprites, and other art assets.',
    whenToUse:
      'Use when the user wants local texture generation, sprite/image iteration, project-local asset prompts, or visual review of generated game art.',
    argumentHint: '[setup request or asset brief]',
    allowedTools: [
      FILE_READ_TOOL_NAME,
      FILE_WRITE_TOOL_NAME,
      FILE_EDIT_TOOL_NAME,
      GLOB_TOOL_NAME,
      GREP_TOOL_NAME,
      BASH_TOOL_NAME,
      POWERSHELL_TOOL_NAME,
      ASK_USER_QUESTION_TOOL_NAME,
    ],
    userInvocable: true,
    files: SKILL_FILES,
    async getPromptForCommand(args) {
      const parts = [IMAGE_PIPELINE_PROMPT]
      if (args.trim().length > 0) {
        parts.push(`## User Request\n\n${args.trim()}`)
      }
      return [{ type: 'text', text: parts.join('\n\n') }]
    },
  })
}