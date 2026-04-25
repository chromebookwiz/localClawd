import type { Command } from '../../commands.js'

const skillsExport: Command = {
  type: 'local-jsx',
  name: 'skills-export',
  aliases: ['export-skill'],
  get description() {
    return 'Export a skill to a portable .md file. /skills-export <name> [dest-dir]'
  },
  get immediate() {
    return true
  },
  load: () => import('./skills-export.js'),
}

export default skillsExport
