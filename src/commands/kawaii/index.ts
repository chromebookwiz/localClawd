import type { Command } from '../../commands.js'

const kawaii: Command = {
  type: 'local-jsx',
  name: 'kawaii',
  isHidden: true,
  get description() {
    return 'Hidden personality mode'
  },
  get immediate() {
    return true
  },
  load: () => import('./kawaii.js'),
}

export default kawaii
