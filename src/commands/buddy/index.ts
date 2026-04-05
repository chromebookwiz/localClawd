import type { Command } from '../../commands.js'

const buddy: Command = {
  type: 'local-jsx',
  name: 'buddy',
  description: 'Summon your session buddy — a little ASCII companion with a personality. Use /buddy pet to hear their thoughts.',
  argumentHint: '[pet]',
  load: () => import('./buddy.js'),
}

export default buddy
