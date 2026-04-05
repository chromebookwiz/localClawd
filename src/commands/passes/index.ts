import type { Command } from '../../commands.js'

export default {
  type: 'local-jsx',
  name: 'passes',
  description: 'Share referral passes',
  isEnabled: () => false,
  get isHidden() {
    return true
  },
  load: () => import('./passes.js'),
} satisfies Command
