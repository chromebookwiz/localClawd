import type { Command } from '../../commands.js'

const memoryStats: Command = {
  type: 'local-jsx',
  name: 'memory-stats',
  aliases: ['effectiveness'],
  get description() {
    return 'Show effectiveness scores: which memories/skills actually led to good outcomes'
  },
  get immediate() {
    return true
  },
  load: () => import('./memory-stats.js'),
}

export default memoryStats
