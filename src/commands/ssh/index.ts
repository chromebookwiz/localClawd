import type { Command } from '../../commands.js'

const ssh: Command = {
  type: 'local-jsx',
  name: 'ssh',
  get description() {
    return 'Run a command on a remote machine over SSH: /ssh <user@host> <command>'
  },
  get immediate() {
    return true
  },
  load: () => import('./ssh.js'),
}

export default ssh
