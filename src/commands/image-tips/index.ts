import type { Command } from '../../commands.js'

const imageTips: Command = {
  type: 'local',
  name: 'image-tips',
  aliases: ['image-fix', 'image-quality'],
  description: 'Guide for fixing image artifacts and improving ComfyUI output quality',
  isEnabled: () => true,
  supportsNonInteractive: true,
  argumentHint: '',
  load: () => import('./image-tips.js'),
}

export default imageTips
