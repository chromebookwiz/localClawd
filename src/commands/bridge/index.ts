import type { Command } from '../../commands.js'

const bridge = {
  type: 'local-jsx',
  name: 'remote-control',
  aliases: ['rc'],
  description: 'Connect this terminal for remote-control sessions',
  argumentHint: '[name]',
  isEnabled: () => false,
  get isHidden() {
    return true
  },
  immediate: true,
  load: () => import('./bridge.js'),
} satisfies Command

export default bridge
