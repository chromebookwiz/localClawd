import type { LocalJSXCommandCall } from '../../types/command.js'
import { getSkillUsage, shouldNudgeDistillation } from '../../services/skills/skillUsage.js'

function timeAgo(ts: number): string {
  if (ts === 0) return 'never'
  const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  return `${Math.floor(hr / 24)}d ago`
}

export const call: LocalJSXCommandCall = async (onDone) => {
  const records = await getSkillUsage()
  const nudge = await shouldNudgeDistillation()

  const lines: string[] = ['◆ Skill Usage', '']
  if (records.length === 0) {
    lines.push('No skill invocations recorded yet.')
    lines.push('Skills become trackable once you invoke them via /skills.')
  } else {
    lines.push(`Total skills tracked: ${records.length}`)
    lines.push('')
    for (const r of records.slice(0, 15)) {
      const summary = `${r.invocations}× (${r.outcomes.success}✓ ${r.outcomes.aborted}✗)  · last ${timeAgo(r.lastUsed)}`
      lines.push(`  ${r.skillName.padEnd(28)} ${summary}`)
    }
  }

  if (nudge.nudge) {
    lines.push('')
    lines.push(`💡 ${nudge.reason}`)
  }

  onDone(lines.join('\n'), { display: 'system' })
  return null
}
