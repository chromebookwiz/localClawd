import type { Command } from '../../commands.js'

const researchMode: Command = {
  type: 'local-jsx',
  name: 'research-mode',
  aliases: ['rmode', 'auto-research'],
  get description() {
    return 'Toggle persistent research mode — agent proactively web-searches before answering'
  },
  get immediate() {
    return true
  },
  load: () => import('./research-mode.js'),
}

export default researchMode
