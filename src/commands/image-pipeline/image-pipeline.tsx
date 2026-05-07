/**
 * /image-pipeline — ComfyUI pipeline setup and configuration.
 *
 * Usage:
 *   /image-pipeline              — show status + help
 *   /image-pipeline setup        — scaffold project dirs and workflow templates
 *   /image-pipeline config <url> — set ComfyUI backend URL
 *   /image-pipeline workflow <n> — set default workflow (from workflows/ folder)
 *   /image-pipeline list         — list saved workflows and prompts
 *
 * To generate images, use /image.
 */

import type { LocalJSXCommandCall } from '../../types/command.js'
import { join } from 'path'
import {
  detectComfyUI,
  DEFAULT_COMFYUI_URL,
  fetchServerWorkflowList,
  fetchServerWorkflow,
} from '../../services/imagePipeline/comfyUI.js'
import {
  scaffoldProject,
  loadConfig,
  saveConfig,
  listPrompts,
  listWorkflows,
} from '../../services/imagePipeline/imagePipeline.js'
import { mkdir, writeFile } from 'fs/promises'

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
    const [prompts, workflows] = scaffolded
      ? await Promise.all([listPrompts(projectRoot), listWorkflows(projectRoot)])
      : [[], []]

    const lines: string[] = ['◆ Image Pipeline', '']

    if (active) {
      lines.push(`  ● ComfyUI active at ${backendUrl}`)
    } else {
      lines.push(`  ○ ComfyUI not found at ${backendUrl}`)
      lines.push(`  → To connect: /image-pipeline config http://<host>:8000`)
    }

    if (scaffolded) {
      const defaultWf = config?.defaultWorkflow ?? '(built-in txt2img)'
      lines.push(`  Scaffold:  .localclawd/image-pipeline/  (${prompts.length} prompts, ${workflows.length} workflows)`)
      lines.push(`  Generated: .localclawd/image-pipeline/generated/`)
      lines.push(`  Default workflow: ${defaultWf}`)
    } else {
      lines.push(`  Not scaffolded — run: /image-pipeline setup`)
    }

    lines.push('')
    lines.push('  Commands:')
    lines.push('    /image-pipeline setup             — create project dirs and workflow templates')
    lines.push('    /image-pipeline config <url>      — set ComfyUI backend URL')
    lines.push('    /image-pipeline workflow <name>   — set default workflow')
    lines.push('    /image-pipeline list              — list local + server workflows')
    lines.push('    /image-pipeline fetch <name>      — download workflow from ComfyUI server')
    lines.push('')
    lines.push('  To generate images:')
    lines.push('    /image <prompt>                   — generate with default workflow')
    lines.push('    /image <name>: <prompt>           — generate with named workflow')

    onDone(lines.join('\n'), { display: 'system' })
    return null
  }

  // ── setup ─────────────────────────────────────────────────────────────────
  if (subcmd === 'setup') {
    const { created, alreadyExisted } = await scaffoldProject(projectRoot)
    const config = await loadConfig(projectRoot)
    const backendUrl = config?.backendUrl ?? DEFAULT_COMFYUI_URL
    const active = await detectComfyUI(backendUrl)
    const generatedDir = join(projectRoot, '.localclawd', 'image-pipeline', 'generated')

    const lines: string[] = ['◆ Image Pipeline — Setup', '']

    if (active) {
      lines.push(`  ● ComfyUI active at ${backendUrl}`)
    } else {
      lines.push(`  ○ ComfyUI not detected at ${backendUrl}`)
      lines.push(`  → To connect: /image-pipeline config http://<host>:8000`)
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
    lines.push(`    ${generatedDir}`)
    lines.push('')
    lines.push('  Next steps:')
    lines.push('    /image-pipeline config http://127.0.0.1:8000  — confirm or change ComfyUI URL')
    lines.push('    /image-pipeline workflow txt2img              — set default workflow')
    lines.push('    /image a misty forest at dawn                 — generate an image')

    onDone(lines.join('\n'), { display: 'system' })
    return null
  }

  // ── config ────────────────────────────────────────────────────────────────
  if (subcmd === 'config') {
    const newUrl = restText
    if (!newUrl || !newUrl.startsWith('http')) {
      onDone(
        [
          '◆ Image Pipeline — Config',
          '',
          '  Usage:   /image-pipeline config http://<host>:8000',
          '  Example: /image-pipeline config http://192.168.1.50:8000',
        ].join('\n'),
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

    onDone(
      [
        '◆ Image Pipeline — Config Saved',
        '',
        `  Backend URL: ${newUrl}`,
        active ? '  ● ComfyUI is reachable' : '  ○ ComfyUI not reachable yet (URL saved — start ComfyUI to connect)',
      ].join('\n'),
      { display: 'system' },
    )
    return null
  }

  // ── workflow ──────────────────────────────────────────────────────────────
  if (subcmd === 'workflow') {
    const name = restText
    if (!name) {
      const workflows = await listWorkflows(projectRoot)
      const lines = [
        '◆ Image Pipeline — Set Default Workflow',
        '',
        '  Usage: /image-pipeline workflow <name>',
      ]
      if (workflows.length > 0) {
        lines.push('  Available:')
        for (const w of workflows) lines.push(`    • ${w.replace(/\.json$/, '')}`)
      } else {
        lines.push('  No workflows found — run /image-pipeline setup first.')
      }
      onDone(lines.join('\n'), { display: 'system' })
      return null
    }

    await scaffoldProject(projectRoot)
    const config = (await loadConfig(projectRoot)) ?? {
      backendUrl: DEFAULT_COMFYUI_URL,
      defaultWidth: 512, defaultHeight: 512, defaultSteps: 20, defaultCfg: 7,
      defaultSampler: 'euler', defaultModel: '', outputDir: '.localclawd/image-pipeline/generated',
    }

    // Verify the workflow file exists
    const workflows = await listWorkflows(projectRoot)
    const match = workflows.find(w => w === name || w === `${name}.json`)
    if (!match) {
      const lines = [
        `◆ Image Pipeline — Workflow not found: "${name}"`,
        '',
      ]
      if (workflows.length > 0) {
        lines.push('  Available:')
        for (const w of workflows) lines.push(`    • ${w.replace(/\.json$/, '')}`)
      } else {
        lines.push('  No workflows found — run /image-pipeline setup first.')
      }
      onDone(lines.join('\n'), { display: 'system' })
      return null
    }

    config.defaultWorkflow = name.replace(/\.json$/, '')
    await saveConfig(projectRoot, config)

    onDone(
      [
        '◆ Image Pipeline — Default Workflow Set',
        '',
        `  Default workflow: ${config.defaultWorkflow}`,
        '  Use /image <prompt> to generate with this workflow.',
        '  Or override per-generation: /image <other-workflow>: <prompt>',
      ].join('\n'),
      { display: 'system' },
    )
    return null
  }

  // ── list ──────────────────────────────────────────────────────────────────
  if (subcmd === 'list') {
    const config = await loadConfig(projectRoot)
    const backendUrl = config?.backendUrl ?? DEFAULT_COMFYUI_URL
    const [prompts, workflows] = await Promise.all([listPrompts(projectRoot), listWorkflows(projectRoot)])
    const defaultWf = config?.defaultWorkflow

    const lines: string[] = ['◆ Image Pipeline — Workflows & Templates', '']

    if (workflows.length > 0) {
      lines.push('  Local workflows (.localclawd/image-pipeline/workflows/):')
      for (const w of workflows) {
        const name = w.replace(/\.json$/, '')
        const marker = defaultWf && name === defaultWf ? '  ← default' : ''
        lines.push(`    • ${name}${marker}`)
      }
    } else {
      lines.push('  No local workflows — run /image-pipeline setup to scaffold.')
    }

    // Show server workflows if ComfyUI is reachable
    const serverList = await fetchServerWorkflowList(backendUrl)
    if (serverList && serverList.length > 0) {
      lines.push('')
      lines.push(`  Server workflows (${backendUrl}):`)
      for (const w of serverList) lines.push(`    • ${w.replace(/\.json$/, '')}`)
      lines.push('  → /image-pipeline fetch <name>  — download to local workflows/')
      lines.push('  Note: server workflows must be saved in API format to work with /image')
    } else if (await detectComfyUI(backendUrl)) {
      lines.push('')
      lines.push(`  Server (${backendUrl}): no saved workflows found`)
    }

    if (prompts.length > 0) {
      lines.push('')
      lines.push('  Prompt templates:')
      for (const p of prompts) lines.push(`    • prompts/${p}`)
    }

    lines.push('')
    lines.push('  To use:         /image <name>: <prompt>')
    lines.push('  To set default: /image-pipeline workflow <name>')

    onDone(lines.join('\n'), { display: 'system' })
    return null
  }

  // ── fetch ─────────────────────────────────────────────────────────────────
  if (subcmd === 'fetch') {
    const name = restText
    const config = await loadConfig(projectRoot)
    const backendUrl = config?.backendUrl ?? DEFAULT_COMFYUI_URL

    if (!name) {
      // List what's available on the server
      const serverList = await fetchServerWorkflowList(backendUrl)
      const lines = ['◆ Image Pipeline — Fetch Server Workflow', '']
      if (!serverList) {
        lines.push(`  ComfyUI not reachable at ${backendUrl}`)
        lines.push('  Start ComfyUI or run /image-pipeline config <url>')
      } else if (serverList.length === 0) {
        lines.push('  No workflows found on server.')
        lines.push('  Save workflows in ComfyUI (using API format) to make them available.')
      } else {
        lines.push('  Usage: /image-pipeline fetch <name>')
        lines.push('')
        lines.push('  Available on server:')
        for (const w of serverList) lines.push(`    • ${w.replace(/\.json$/, '')}`)
        lines.push('')
        lines.push('  Note: workflows must be saved in ComfyUI API format (not visual editor format).')
        lines.push('  Enable Dev Mode in ComfyUI settings to get "Save (API Format)" option.')
      }
      onDone(lines.join('\n'), { display: 'system' })
      return null
    }

    const workflowData = await fetchServerWorkflow(backendUrl, name)
    if (!workflowData) {
      onDone(
        [
          `◆ Image Pipeline — Fetch Failed: "${name}"`,
          '',
          `  Could not fetch from ${backendUrl}/userdata/workflows/${name}.json`,
          '  Check ComfyUI is running and the workflow name is correct.',
          '  Run /image-pipeline fetch (no args) to list available workflows.',
        ].join('\n'),
        { display: 'system' },
      )
      return null
    }

    await scaffoldProject(projectRoot)
    const filename = name.endsWith('.json') ? name : `${name}.json`
    const outPath = join(projectRoot, '.localclawd', 'image-pipeline', 'workflows', filename)
    await mkdir(join(projectRoot, '.localclawd', 'image-pipeline', 'workflows'), { recursive: true })
    await writeFile(outPath, JSON.stringify(workflowData, null, 2), 'utf-8')

    onDone(
      [
        `◆ Image Pipeline — Fetched: "${name}"`,
        '',
        `  Saved to: .localclawd/image-pipeline/workflows/${filename}`,
        `  Use: /image ${name.replace(/\.json$/, '')}: <prompt>`,
        '  Or set as default: /image-pipeline workflow ' + name.replace(/\.json$/, ''),
        '',
        '  Note: if this was saved from the ComfyUI visual editor (not API format),',
        '  it may not work. Enable Dev Mode in ComfyUI → Save (API Format) instead.',
      ].join('\n'),
      { display: 'system' },
    )
    return null
  }

  // ── unknown subcommand ────────────────────────────────────────────────────
  onDone(
    [
      `◆ Image Pipeline — Unknown subcommand: "${subcmd}"`,
      '',
      '  Commands:',
      '    /image-pipeline setup             — scaffold project',
      '    /image-pipeline config <url>      — set ComfyUI backend URL',
      '    /image-pipeline workflow <name>   — set default workflow',
      '    /image-pipeline list              — list local + server workflows',
      '    /image-pipeline fetch <name>      — download workflow from ComfyUI server',
    ].join('\n'),
    { display: 'system' },
  )
  return null
}
