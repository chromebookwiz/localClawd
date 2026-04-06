import type { Command } from '../../commands.js'

const sysprompt: Command = {
  type: 'local-jsx',
  name: 'sysprompt',
  aliases: ['sp'],
  description:
    'Replace the session system prompt with your own text. ' +
    'Usage: /sysprompt <your prompt text>  ' +
    'Run /sysprompt without arguments to view the current prompt or reset to default.',
  load: () => import('./sysprompt.js'),
}

export default sysprompt
