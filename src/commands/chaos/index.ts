import type { Command } from '../../commands.js'

const chaos: Command = {
  type: 'local-jsx',
  name: 'chaos',
  isHidden: true,
  get description() {
    return 'Hidden personality mode'
  },
  get immediate() {
    return true
  },
  load: () => import('./chaos.js'),
}

export default chaos
