import type { Command } from '../../types/command.js'

const director: Command = {
  type: 'local-jsx',
  name: 'director',
  aliases: ['dir'],
  description: 'Supervised autonomous mode with persistent project memory. Usage: /director <task>',
  source: 'builtin',
  load: () => import('./director.js'),
}

export default director
