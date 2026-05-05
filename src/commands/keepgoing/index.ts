import type { Command } from '../../commands.js'

const keepgoing: Command = {
  type: 'local-jsx',
  name: 'keepgoing',
  aliases: ['kg', 'continue'],
  description: 'Continue autonomously until the task is done',
  load: () => import('./keepgoing.js'),
}

export default keepgoing
