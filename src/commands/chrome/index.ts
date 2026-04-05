import type { Command } from '../../commands.js'

const command: Command = {
  name: 'chrome',
  description: 'localclawd in Chrome (Beta) settings',
  availability: ['claude-ai'],
  isEnabled: () => false,
  get isHidden() {
    return true
  },
  type: 'local-jsx',
  load: () => import('./chrome.js'),
}

export default command
