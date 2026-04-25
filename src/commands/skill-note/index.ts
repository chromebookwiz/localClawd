import type { Command } from '../../commands.js'

const skillNote: Command = {
  type: 'local-jsx',
  name: 'skill-note',
  aliases: ['note-skill'],
  get description() {
    return 'Append a "lesson learned" to a skill: /skill-note <skill> <note text>'
  },
  get immediate() {
    return true
  },
  load: () => import('./skill-note.js'),
}

export default skillNote
