import type { Command } from '../../commands.js'

const windowsSetup: Command = {
  type: 'local-jsx',
  name: 'windows-setup',
  aliases: ['windows-doctor'],
  get description() {
    return 'Check Windows-side prerequisites for localclawd integrations'
  },
  get immediate() {
    return true
  },
  load: () => import('./windows-setup.js'),
}

export default windowsSetup
