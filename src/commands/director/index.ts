import type { Command } from '../../types/command.js'

const director: Command = {
  type: 'local-jsx',
  name: 'director',
  aliases: ['dir'],
  description: 'Director mode — persistent memory, supervised autonomous operation',
  isEnabled: true,
  isHidden: false,
  source: 'builtin',
  load: () => import('./director.js'),
}

export default director
