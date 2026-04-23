import type { Command } from '../../commands.js'

const schedule: Command = {
  type: 'local-jsx',
  name: 'schedule',
  aliases: ['cron'],
  get description() {
    return 'Schedule recurring prompts. /schedule <cron> <prompt>, /schedule list, /schedule rm <id>'
  },
  get immediate() {
    return true
  },
  load: () => import('./schedule.js'),
}

export default schedule
