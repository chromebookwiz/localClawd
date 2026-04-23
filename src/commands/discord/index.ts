import type { Command } from '../../commands.js'

const discord: Command = {
  type: 'local-jsx',
  name: 'discord',
  get description() {
    return 'Show Discord bridge status, or send a message: /discord <text>'
  },
  get immediate() {
    return true
  },
  load: () => import('./discord.js'),
}

export default discord
