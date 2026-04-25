import type { Command } from '../../commands.js'

const daytonaRun: Command = {
  type: 'local-jsx',
  name: 'daytona-run',
  aliases: ['daytona'],
  get description() {
    return 'Run a command in a Daytona workspace: /daytona-run <workspace> -- <command>'
  },
  get immediate() {
    return true
  },
  load: () => import('./daytona-run.js'),
}

export default daytonaRun
