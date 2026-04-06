import type { Command } from '../../commands.js'

const research: Command = {
  type: 'local-jsx',
  name: 'research',
  aliases: ['r'],
  description:
    'Spawn a head researcher who decomposes your query and runs parallel web research. ' +
    'Results are synthesized with full citations. ' +
    'Usage: /research <topic or question>  ' +
    'Chains: /thinkharder /research <topic>  |  /research <topic> /keepgoing',
  load: () => import('./research.js'),
}

export default research
