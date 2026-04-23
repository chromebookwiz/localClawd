import type { Command } from '../../commands.js'

const slack: Command = {
  type: 'local-jsx',
  name: 'slack',
  get description() {
    return 'Show Slack bridge status, or send a message: /slack <text>'
  },
  get immediate() {
    return true
  },
  load: () => import('./slack.js'),
}

export default slack
