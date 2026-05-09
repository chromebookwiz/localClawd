import type { Command } from '../../commands.js'

const includeMemory = {
  type: 'local',
  name: 'includememory',
  aliases: ['include-memory'],
  description: 'Stop gitignoring local memory so it can be committed',
  supportsNonInteractive: true,
  load: () => import('./includememory.js'),
} satisfies Command

export default includeMemory
