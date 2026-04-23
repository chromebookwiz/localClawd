import type { Command } from '../../commands.js'

const sessionsearch: Command = {
  type: 'local-jsx',
  name: 'sessionsearch',
  aliases: ['recall', 'find-session'],
  get description() {
    return 'Search past conversations: /sessionsearch <query>'
  },
  get immediate() {
    return true
  },
  load: () => import('./sessionsearch.js'),
}

export default sessionsearch
