import type { Command } from '../../commands.js'

const heartbeat: Command = {
  type: 'local-jsx',
  name: 'heartbeat',
  aliases: ['hb'],
  description: 'Periodic autonomous mode — agent re-prompts every N minutes. Usage: /heartbeat 5',
  load: () => import('./heartbeat.js'),
}

export default heartbeat
