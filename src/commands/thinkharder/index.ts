import type { Command } from '../../commands.js'

const thinkharder: Command = {
  type: 'local-jsx',
  name: 'thinkharder',
  aliases: ['th'],
  description: 'Enable careful mode: model double-checks its work at each step and queries memory more frequently. Use /thinknormal to return to default.',
  load: () => import('./thinkharder.js'),
}

export default thinkharder
