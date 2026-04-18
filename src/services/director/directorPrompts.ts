/**
 * Director Prompts — system and continuation prompts for director mode.
 */

/**
 * Build the initial director prompt for a new task.
 */
export function buildDirectorTaskPrompt(
  task: string,
  projectContext: string,
  round: number,
  maxRounds: number,
  medium?: 'telegram' | 'desktop',
): string {
  const roundInfo = isFinite(maxRounds)
    ? `Round ${round} of ${maxRounds}`
    : `Round ${round} (unlimited)`

  const mediumNote = medium === 'telegram'
    ? '\n- The user is connected via Telegram — progress updates and the final report are sent there automatically'
    : '\n- The user is connected via CLI — progress updates are sent as desktop notifications'

  return `\
[DIRECTOR MODE — Supervised Autonomous Operation — ${roundInfo}]

You are operating under director supervision. The director:
- Assigned you a specific task
- Will review your work after each step
- May re-prompt if work is incomplete
- Has persistent memory of this project and past tasks${mediumNote}

${projectContext}

━━━ TASK ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${task}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

━━━ CAPABILITIES ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
You have access to ALL tools:
  Read, Write, Edit, MultiEdit   — file operations
  Bash                           — run commands, builds, tests, git
  Glob, Grep                     — search codebase
  WebFetch, WebSearch            — internet access
  Agent                          — spawn subagents for parallel work

━━━ RULES ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. DO NOT ask for confirmation — proceed immediately
2. After completing a milestone, state: "Completed: <what was done>"
3. After significant changes, run tests/builds to verify
4. Use git commits after each logical unit of work
5. If blocked, emit: NEEDS INPUT: <question>
6. When ALL work is done, emit: TASK COMPLETE: <summary>

Work autonomously. The director will review after this round.`
}

/**
 * Build a continuation prompt when the director reviews and finds
 * the task is not yet complete.
 */
export function buildDirectorReviewPrompt(
  round: number,
  maxRounds: number,
  reviewNotes: string,
  telegramMsg: string | null,
): string {
  const roundInfo = isFinite(maxRounds)
    ? `Round ${round} of ${maxRounds}`
    : `Round ${round} (unlimited)`

  const telegramSection = telegramMsg
    ? `\n━━━ MESSAGE FROM USER ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n${telegramMsg}\n━━━ Respond to this message, then continue your work. ━━━━━━━━━━━━━━\n`
    : ''

  return `\
[DIRECTOR REVIEW — ${roundInfo}]

The director reviewed your last response:
${reviewNotes}
${telegramSection}
━━━ INSTRUCTIONS ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. Continue working — do not re-explain what was already done
2. Use the Agent tool to spawn subagents for independent parallel work
3. Run builds/tests after significant changes to verify correctness
4. Assess whether the task is complete:
   - If YES → emit: TASK COMPLETE: <summary of all work done>
   - If NO  → proceed with the next action immediately`
}

/**
 * Build a status summary for /director with no args.
 */
export function buildDirectorStatusText(
  projects: Array<{ id: string; description: string; lastActive: number; accessCount: number }>,
  recentTasks: Array<{ prompt: string; outcome: string; timestamp: number; projectId: string }>,
): string {
  const lines: string[] = []

  if (projects.length === 0) {
    lines.push('No projects registered yet.')
    lines.push('Use /director <task> to start working — the current directory will be registered automatically.')
    return lines.join('\n')
  }

  lines.push('Registered projects:')
  for (const p of projects.slice(0, 10)) {
    const ago = Math.round((Date.now() - p.lastActive) / (1000 * 60 * 60 * 24))
    lines.push(`  ${p.id} — ${p.description} (${p.accessCount} sessions, ${ago}d ago)`)
  }

  if (recentTasks.length > 0) {
    lines.push('')
    lines.push('Recent tasks:')
    for (const t of recentTasks.slice(-5)) {
      const date = new Date(t.timestamp).toISOString().slice(0, 10)
      lines.push(`  [${t.outcome}] ${date}: ${t.prompt.slice(0, 80)}`)
    }
  }

  return lines.join('\n')
}
