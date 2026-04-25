import type { Command } from '../../commands.js'

const skillStats: Command = {
  type: 'local-jsx',
  name: 'skill-stats',
  aliases: ['skill-usage'],
  get description() {
    return 'Show how often each skill has been used'
  },
  get immediate() {
    return true
  },
  load: () => import('./skill-stats.js'),
}

export default skillStats
