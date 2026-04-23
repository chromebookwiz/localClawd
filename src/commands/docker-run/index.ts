import type { Command } from '../../commands.js'

const dockerRun: Command = {
  type: 'local-jsx',
  name: 'docker-run',
  aliases: ['docker'],
  get description() {
    return 'Run a command in an ephemeral Docker container: /docker-run <image> -- <command>'
  },
  get immediate() {
    return true
  },
  load: () => import('./docker-run.js'),
}

export default dockerRun
