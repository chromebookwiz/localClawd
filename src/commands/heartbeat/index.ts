import type { Command } from '../../commands.js'

const heartbeat: Command = {
  type: 'local-jsx',
  name: 'heartbeat',
  aliases: ['hb'],
  description:
    'Activate recurring autonomous mode: agent wakes every N minutes without stopping. ' +
    'Only you can stop it (Ctrl+C). /thinkharder is auto-enabled. ' +
    'Usage: /heartbeat <minutes>  e.g. /heartbeat 5',
  load: () => import('./heartbeat.js'),
}

export default heartbeat
