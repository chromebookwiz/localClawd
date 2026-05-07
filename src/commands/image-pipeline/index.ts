import type { Command } from '../../commands.js'

const imagePipeline: Command = {
  type: 'local-jsx',
  name: 'image-pipeline',
  aliases: ['comfyui', 'imgpipe'],
  description: 'ComfyUI image generation pipeline — auto-detects local ComfyUI, scaffolds project templates, and submits generation jobs',
  argumentHint: '[setup|generate|list|config] [args]',
  load: () => import('./image-pipeline.js'),
}

export default imagePipeline
