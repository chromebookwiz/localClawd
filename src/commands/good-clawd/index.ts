import type { LocalCommand } from '../../commands.js'

const goodClawd: LocalCommand = {
  type: 'local',
  name: 'good-clawd',
  description: 'Save positive feedback to memory for this session',
  isEnabled: true,
  isHidden: false,
  argCount: 0,
  aliases: [],
  userFacingName() {
    return 'good-clawd'
  },
  async call(_cmdAndArgs, _context) {
    return {
      type: 'text',
      text: 'Feedback noted — saving this as a positive session to memory.',
    }
  },
}

export default goodClawd
