import type { Command } from '../../commands.js'

const images: Command = {
  type: 'local-jsx',
  name: 'images',
  aliases: ['image'],
  description:
    'Set up the local image pipeline for this project. Defaults to a ComfyUI-friendly project-local workflow under .localclawd/image-pipeline/.',
  argumentHint: '[setup|help|review] [brief]',
  load: () => import('./images.js'),
}

export default images