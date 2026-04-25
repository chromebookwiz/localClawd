import type { Command } from '../../commands.js'

const reindexSessions: Command = {
  type: 'local-jsx',
  name: 'reindex-sessions',
  aliases: ['fts-rebuild'],
  get description() {
    return 'Rebuild the FTS5 session-summary index (no-op if SQLite FTS5 is unavailable)'
  },
  get immediate() {
    return true
  },
  load: () => import('./reindex-sessions.js'),
}

export default reindexSessions
