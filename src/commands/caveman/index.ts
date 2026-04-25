import type { Command } from '../../commands.js'

const caveman: Command = {
  type: 'local-jsx',
  name: 'caveman',
  isHidden: true,
  get description() {
    return 'Hidden personality mode'
  },
  get immediate() {
    return true
  },
  load: () => import('./caveman.js'),
}

export default caveman
