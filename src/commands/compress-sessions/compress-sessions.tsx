import type { LocalJSXCommandCall } from '../../types/command.js'
import { compressAllPending } from '../../services/sessionSearch/trajectoryCompress.js'

export const call: LocalJSXCommandCall = async (onDone, _context, args) => {
  const limit = parseInt((args ?? '').trim(), 10) || 20
  const r = await compressAllPending(limit)

  const lines = [
    '◆ Compress Sessions',
    '',
    `Compressed: ${r.compressed}`,
    `Skipped:    ${r.skipped}`,
  ]
  if (r.compressed > 0) {
    lines.push(`Ratio:      ${(r.totalRatio * 100).toFixed(1)}% of original size`)
  }
  lines.push('')
  lines.push('Stored at: ~/.claude/trajectories/')

  onDone(lines.join('\n'), { display: 'system' })
  return null
}
