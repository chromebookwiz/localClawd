import type { Command } from '../../commands.js'

const image: Command = {
  type: 'local-jsx',
  name: 'image',
  aliases: ['images'],
  description: 'Generate an image via ComfyUI. Use "name: prompt" to select a workflow. Run /image-pipeline setup first.',
  argumentHint: '[workflow-name:] <prompt>',
  load: () => import('./images.js'),
}

export default image
