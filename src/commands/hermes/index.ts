import type { Command } from '../../commands.js'

const hermes: Command = {
  type: 'local-jsx',
  name: 'hermes',
  get description() {
    return 'Show the localclawd feature map — shipped vs roadmap'
  },
  get immediate() {
    return true
  },
  load: () => import('./hermes.js'),
}

export default hermes
