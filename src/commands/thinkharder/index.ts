import type { Command } from '../../commands.js'

const thinkharder: Command = {
  type: 'local-jsx',
  name: 'thinkharder',
  aliases: ['th'],
  description: 'Enable careful mode: 5-phase verification pipeline (ORIENT → DRAFT → CRITIQUE → REFINE → VERIFY). Use /thinknormal to return to default.',
  load: () => import('./thinkharder.js'),
}

export default thinkharder
