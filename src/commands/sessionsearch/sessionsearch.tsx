import type { LocalJSXCommandCall } from '../../types/command.js'
import { searchSessions, formatMatches } from '../../services/sessionSearch/sessionSearch.js'

export const call: LocalJSXCommandCall = async (onDone, _context, args) => {
  const query = args?.trim() ?? ''
  if (!query) {
    onDone(
      '◆ Session Search\n\nUsage: /sessionsearch <query>\nExample: /sessionsearch auth token storage',
      { display: 'system' },
    )
    return null
  }

  const matches = await searchSessions(query, 10)
  const text = formatMatches(matches)
  onDone(`◆ Session Search — "${query}"\n\n${text}`, { display: 'system' })
  return null
}
