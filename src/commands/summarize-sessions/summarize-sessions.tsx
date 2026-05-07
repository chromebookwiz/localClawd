import type { LocalJSXCommandCall } from '../../types/command.js'
import { summarizeAllPending } from '../../services/sessionSearch/sessionSummarize.js'
import { rebuildIndex } from '../../services/sessionSearch/fts5Index.js'

export const call: LocalJSXCommandCall = async (onDone, _context, args) => {
  const limit = parseInt((args ?? '').trim(), 10) || 20
  const result = await summarizeAllPending(limit)

  if (result.summarized > 0) {
    void rebuildIndex().catch(() => {})
  }

  const lines = [
    '◆ Summarize Sessions',
    '',
    `Summarized: ${result.summarized}`,
    `Skipped:    ${result.skipped}`,
  ]
  if (result.summarized === 0 && result.skipped === 0) {
    lines.push('')
    lines.push('No pending sessions. Run after accumulating more conversation history.')
  }
  if (result.skipped > 0) {
    lines.push('')
    lines.push('Skips usually mean the local LLM rejected or timed out on a session.')
  }
  lines.push('')
  lines.push('Summaries stored at: ~/.claude/session-summaries/')

  onDone(lines.join('\n'), { display: 'system' })
  return null
}
