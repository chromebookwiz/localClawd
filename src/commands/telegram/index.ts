import type { Command } from '../../commands.js'

const telegram: Command = {
  type: 'local-jsx',
  name: 'telegram',
  aliases: ['tg'],
  get description() {
    return 'Show Telegram bridge status, or send a message: /telegram <text>'
  },
  get immediate() {
    return true
  },
  load: () => import('./telegram.js'),
}

export default telegram
