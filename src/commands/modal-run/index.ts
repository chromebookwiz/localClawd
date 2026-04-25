import type { Command } from '../../commands.js'

const modalRun: Command = {
  type: 'local-jsx',
  name: 'modal-run',
  aliases: ['modal'],
  get description() {
    return 'Run a Modal app on serverless GPU/CPU: /modal-run <module>::<func> [args...]'
  },
  get immediate() {
    return true
  },
  load: () => import('./modal-run.js'),
}

export default modalRun
