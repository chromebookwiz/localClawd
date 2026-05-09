import type { Command } from '../../commands.js'

const memory: Command = {
  type: 'local-jsx',
  name: 'memory',
  description: 'Manage project memory: /memory [status|on|off|clear|search]',
  load: () => import('./memory.js'),
}

export default memory
