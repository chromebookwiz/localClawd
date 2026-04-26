import type { Command } from '../../commands.js'

const memoryPrune: Command = {
  type: 'local-jsx',
  name: 'memory-prune',
  aliases: ['prune-memory'],
  get description() {
    return 'Drop the least-effective memories. /memory-prune [--force] [--capacity=2000]'
  },
  get immediate() {
    return true
  },
  load: () => import('./memory-prune.js'),
}

export default memoryPrune
