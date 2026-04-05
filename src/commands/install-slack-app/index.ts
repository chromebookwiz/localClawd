import type { Command } from '../../commands.js'

const installSlackApp = {
  type: 'local',
  name: 'install-slack-app',
  description: 'Install the localclawd Slack app',
  availability: ['claude-ai'],
  isEnabled: () => false,
  get isHidden() {
    return true
  },
  supportsNonInteractive: false,
  load: () => import('./install-slack-app.js'),
} satisfies Command

export default installSlackApp
