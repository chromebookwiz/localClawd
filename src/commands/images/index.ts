import type { Command } from '../../commands.js'

const image: Command = {
  type: 'local-jsx',
  name: 'image',
  aliases: ['images'],
  description: 'Generate an image via ComfyUI and save to ~/generatedimages/. Auto-detects local ComfyUI.',
  argumentHint: '<prompt>',
  load: () => import('./images.js'),
}

export default image
