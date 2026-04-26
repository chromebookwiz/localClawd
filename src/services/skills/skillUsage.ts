/**
 * Skill usage tracking — records each skill invocation so the agent can
 * (a) suggest distillation when a workflow is being repeated by hand
 * and (b) show which skills are paying off.
 *
 * Data lives at ~/.claude/skill-usage.json — one entry per skill, capped
 * total entries at 500.
 */

import { mkdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'

const USAGE_PATH = join(getClaudeConfigHomeDir(), 'skill-usage.json')
const MAX_ENTRIES = 500

export interface SkillUseRecord {
  skillName: string
  invocations: number
  firstUsed: number
  lastUsed: number
  outcomes: { success: number; aborted: number; unknown: number }
}

interface UsageFile {
  version: 1
  records: SkillUseRecord[]
}

async function loadFile(): Promise<UsageFile> {
  try {
    const raw = await readFile(USAGE_PATH, 'utf-8')
    const parsed = JSON.parse(raw) as UsageFile
    if (parsed.version !== 1) return { version: 1, records: [] }
    return parsed
  } catch {
    return { version: 1, records: [] }
  }
}

async function saveFile(file: UsageFile): Promise<void> {
  await mkdir(getClaudeConfigHomeDir(), { recursive: true })
  // Cap by recency, drop oldest first
  if (file.records.length > MAX_ENTRIES) {
    file.records.sort((a, b) => b.lastUsed - a.lastUsed)
    file.records = file.records.slice(0, MAX_ENTRIES)
  }
  await writeFile(USAGE_PATH, JSON.stringify(file, null, 2), 'utf-8')
}

export async function recordSkillUse(
  skillName: string,
  outcome: 'success' | 'aborted' | 'unknown' = 'unknown',
): Promise<void> {
  const file = await loadFile()
  let record = file.records.find(r => r.skillName === skillName)
  if (!record) {
    record = {
      skillName,
      invocations: 0,
      firstUsed: Date.now(),
      lastUsed: 0,
      outcomes: { success: 0, aborted: 0, unknown: 0 },
    }
    file.records.push(record)
  }
  record.invocations++
  record.lastUsed = Date.now()
  record.outcomes[outcome]++
  await saveFile(file)

  // Bridge skills into the effectiveness loop so the same outcome
  // signal (TASK COMPLETE / failure) updates skill ranking too.
  try {
    const { recordRetrieval } = await import('../memory/effectiveness.js')
    recordRetrieval(skillName, 'skill')
  } catch { /* non-critical */ }
}

export async function getSkillUsage(): Promise<SkillUseRecord[]> {
  const file = await loadFile()
  return [...file.records].sort((a, b) => b.invocations - a.invocations)
}

export async function getMostUsedSkill(): Promise<SkillUseRecord | null> {
  const records = await getSkillUsage()
  return records[0] ?? null
}

/** Returns true if the skill is used often enough that distilling it is
 *  probably worth surfacing. */
export async function shouldNudgeDistillation(): Promise<{
  nudge: boolean
  reason?: string
}> {
  const records = await getSkillUsage()
  // Heuristic: if any single skill has been invoked 5+ times in the last
  // 7 days, it's a good candidate for refinement.
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
  for (const r of records) {
    if (r.lastUsed < cutoff) continue
    if (r.invocations >= 5) {
      return {
        nudge: true,
        reason: `"${r.skillName}" has been used ${r.invocations} times — consider /distill-skill to refine it.`,
      }
    }
  }
  return { nudge: false }
}
