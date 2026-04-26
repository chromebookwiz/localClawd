import type { Command } from '../../commands.js'

const webui: Command = {
  type: 'local-jsx',
  name: 'webui',
  aliases: ['dashboard'],
  get description() {
    return 'Open the localclawd dashboard in your browser; spawns a new pane if already running'
  },
  get immediate() {
    return true
  },
  load: () => import('./webui.js'),
}

export default webui
