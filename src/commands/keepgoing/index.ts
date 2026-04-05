import type { Command } from '../../commands.js'

const keepgoing: Command = {
  type: 'local-jsx',
  name: 'keepgoing',
  aliases: ['kg', 'continue'],
  description:
    'Continue working autonomously until the task is complete or you intervene (Ctrl+C)',
  load: () => import('./keepgoing.js'),
}

export default keepgoing
