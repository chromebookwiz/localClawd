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
} from '../../services/imagePipeline/comfyUI.js'
import {
  scaffoldProject,
  loadConfig,
  saveConfig,
  listPrompts,
  listWorkflows,
} from '../../services/imagePipeline/imagePipeline.js'

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
    lines.push('    /image-pipeline list              — list workflows and prompt templates')
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
    const [prompts, workflows] = await Promise.all([listPrompts(projectRoot), listWorkflows(projectRoot)])
    const defaultWf = config?.defaultWorkflow

    const lines: string[] = ['◆ Image Pipeline — Templates', '']

    if (prompts.length === 0 && workflows.length === 0) {
      lines.push('  No templates yet.')
      lines.push('  Run /image-pipeline setup to scaffold the project.')
    } else {
      if (workflows.length > 0) {
        lines.push('  Workflows:')
        for (const w of workflows) {
          const name = w.replace(/\.json$/, '')
          const marker = defaultWf && (name === defaultWf) ? '  ← default' : ''
          lines.push(`    • ${name}${marker}`)
        }
        lines.push('')
        lines.push('  To use:    /image <name>: <prompt>')
        lines.push('  To set default: /image-pipeline workflow <name>')
      }
      if (prompts.length > 0) {
        lines.push('')
        lines.push('  Prompt templates:')
        for (const p of prompts) lines.push(`    • prompts/${p}`)
      }
    }

    onDone(lines.join('\n'), { display: 'system' })
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
      '    /image-pipeline list              — list workflows and templates',
    ].join('\n'),
    { display: 'system' },
  )
  return null
}
