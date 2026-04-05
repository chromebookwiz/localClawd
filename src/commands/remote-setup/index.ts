import type { Command } from '../../commands.js'

const web = {
  type: 'local-jsx',
  name: 'web-setup',
  description:
    'Setup Claude Code on the web (requires connecting your GitHub account)',
  availability: ['claude-ai'],
  isEnabled: () => false,
  get isHidden() {
    return true
  },
  load: () => import('./remote-setup.js'),
} satisfies Command

export default web
