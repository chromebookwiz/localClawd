import type { Command } from '../../commands.js'

const thinknormal: Command = {
  type: 'local-jsx',
  name: 'thinknormal',
  aliases: ['tn'],
  description: 'Return to default pipeline. Disables /thinkharder careful mode and lattice memory is fallback-only.',
  load: async () => {
    const mod = await import('./thinkharder.js')
    return { call: mod.callNormal }
  },
}

export default thinknormal
