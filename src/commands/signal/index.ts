import type { Command } from '../../commands.js'

const signal: Command = {
  type: 'local-jsx',
  name: 'signal',
  get description() {
    return 'Show Signal bridge status or send a message: /signal <text>'
  },
  get immediate() {
    return true
  },
  load: () => import('./signal.js'),
}

export default signal
