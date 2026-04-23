import type { Command } from '../../commands.js'

const distillSkill: Command = {
  type: 'local-jsx',
  name: 'distill-skill',
  aliases: ['skill-suggest'],
  get description() {
    return 'Propose a reusable skill from the most recent session'
  },
  get immediate() {
    return true
  },
  load: () => import('./distill-skill.js'),
}

export default distillSkill
