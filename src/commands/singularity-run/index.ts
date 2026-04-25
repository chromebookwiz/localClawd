import type { Command } from '../../commands.js'

const singularityRun: Command = {
  type: 'local-jsx',
  name: 'singularity-run',
  aliases: ['apptainer-run', 'singularity', 'apptainer'],
  get description() {
    return 'Run a command in a Singularity/Apptainer SIF: /singularity-run <image> -- <cmd>'
  },
  get immediate() {
    return true
  },
  load: () => import('./singularity-run.js'),
}

export default singularityRun
