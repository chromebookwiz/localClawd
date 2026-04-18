import type { Command } from '../../commands.js'

const contextsize: Command = {
  type: 'local-jsx',
  name: 'contextsize',
  aliases: ['ctxsize'],
  description: 'Set context window size. Usage: /contextsize 200k | /contextsize auto',
  load: () => import('./contextsize.js'),
}

export default contextsize
