import type { Command } from '../../commands.js'

const desktop = {
  type: 'local-jsx',
  name: 'desktop',
  aliases: ['app'],
  description: 'Continue the current session in localclawd Desktop',
  availability: ['claude-ai'],
  isEnabled: () => false,
  get isHidden() {
    return true
  },
  load: () => import('./desktop.js'),
} satisfies Command

export default desktop
