import type { Command } from '../../commands.js'

const summarizeSessions: Command = {
  type: 'local-jsx',
  name: 'summarize-sessions',
  aliases: ['summarise-sessions'],
  get description() {
    return 'LLM-summarize past conversations into a searchable index'
  },
  get immediate() {
    return true
  },
  load: () => import('./summarize-sessions.js'),
}

export default summarizeSessions
