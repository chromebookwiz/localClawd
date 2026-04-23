import type { Command } from '../../commands.js'

const compressSessions: Command = {
  type: 'local-jsx',
  name: 'compress-sessions',
  aliases: ['compress-trajectories'],
  get description() {
    return 'Compress past sessions into training-data-friendly trajectories'
  },
  get immediate() {
    return true
  },
  load: () => import('./compress-sessions.js'),
}

export default compressSessions
