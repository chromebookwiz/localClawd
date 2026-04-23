import type { Command } from '../../commands.js'

const rpc: Command = {
  type: 'local-jsx',
  name: 'rpc',
  get description() {
    return 'Show the local tool-RPC endpoint so Python scripts can call agent tools'
  },
  get immediate() {
    return true
  },
  load: () => import('./rpc.js'),
}

export default rpc
