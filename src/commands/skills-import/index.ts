import type { Command } from '../../commands.js'

const skillsImport: Command = {
  type: 'local-jsx',
  name: 'skills-import',
  aliases: ['import-skill'],
  get description() {
    return 'Import a portable skill .md file: /skills-import <path>'
  },
  get immediate() {
    return true
  },
  load: () => import('./skills-import.js'),
}

export default skillsImport
