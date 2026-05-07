import type { Command } from '../../commands.js'

const imagePipeline: Command = {
  type: 'local-jsx',
  name: 'image-pipeline',
  aliases: ['comfyui', 'imgpipe'],
  description: 'ComfyUI pipeline setup — scaffold workflows, configure backend, manage templates. Use /image to generate.',
  argumentHint: '[setup|config|workflow|list|fetch] [args]',
  load: () => import('./image-pipeline.js'),
}

export default imagePipeline
