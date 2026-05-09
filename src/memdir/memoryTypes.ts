/**
 * Memory type taxonomy.
 *
 * Localclawd uses a single project memory type. Older memory files with
 * other type names are still readable as untyped memories, but all new
 * automatic and prompted memory writes should use `project`.
 */

export const MEMORY_TYPES = ['project'] as const

export type MemoryType = (typeof MEMORY_TYPES)[number]

/**
 * Parse a raw frontmatter value into a MemoryType.
 * Invalid or missing values return undefined so legacy files degrade safely.
 */
export function parseMemoryType(raw: unknown): MemoryType | undefined {
  return raw === 'project' ? 'project' : undefined
}

export const TYPES_SECTION_COMBINED: readonly string[] = [
  '## Memory type',
  '',
  'There is one memory type: `project`.',
  '',
  '<types>',
  '<type>',
  '    <name>project</name>',
  "    <description>Durable context about the user's preferences, project decisions, constraints, workflows, external references, and non-obvious facts that should help future Localclawd turns in this project.</description>",
  '    <when_to_save>Save when the user explicitly asks you to remember something, corrects your approach, confirms an important preference, explains project context that is not obvious from the files, or points to an external system that future work should know about.</when_to_save>',
  '    <how_to_use>Use project memories as lightweight orientation. Treat them as historical context, not authority over the current code. Verify file, function, flag, or dependency claims before acting on them.</how_to_use>',
  '    <body_structure>Lead with the fact, preference, or decision. Add **Why:** and **How to apply:** lines when they clarify when the memory matters.</body_structure>',
  '</type>',
  '</types>',
  '',
]

export const TYPES_SECTION_INDIVIDUAL = TYPES_SECTION_COMBINED

export const WHAT_NOT_TO_SAVE_SECTION: readonly string[] = [
  '## What NOT to save in memory',
  '',
  '- Code patterns, conventions, architecture, file paths, or project structure that can be derived by reading the current project state.',
  '- Git history, recent changes, or who-changed-what. `git log` and `git blame` are authoritative.',
  '- Debugging solutions or fix recipes when the fix is already in the code or commit message.',
  '- Anything already documented in LOCALCLAWD.md files.',
  '- Ephemeral task details, temporary state, or current-turn scratch work.',
  '',
  'These exclusions apply even when the user explicitly asks you to save. If they ask you to save a PR list or activity summary, ask what was surprising or non-obvious about it; that is the part worth keeping.',
]

export const MEMORY_DRIFT_CAVEAT =
  '- Memory records can become stale over time. Use memory as context for what was true at a given point in time. Before answering the user or building assumptions based solely on memory records, verify that the memory is still correct and up to date by reading the current files or resources. If a recalled memory conflicts with current information, trust what you observe now and update or remove the stale memory.'

export const WHEN_TO_ACCESS_SECTION: readonly string[] = [
  '## When to access memories',
  '- When memories seem relevant, or the user references prior-conversation work.',
  '- You MUST access memory when the user explicitly asks you to check, recall, or remember.',
  '- If the user says to ignore or not use memory: proceed as if MEMORY.md were empty. Do not apply remembered facts, cite, compare against, or mention memory content.',
  MEMORY_DRIFT_CAVEAT,
]

export const TRUSTING_RECALL_SECTION: readonly string[] = [
  '## Before recommending from memory',
  '',
  'A memory that names a specific function, file, or flag is a claim that it existed when the memory was written. It may have been renamed, removed, or never merged. Before recommending it:',
  '',
  '- If the memory names a file path: check the file exists.',
  '- If the memory names a function or flag: grep for it.',
  '- If the user is about to act on your recommendation, verify first.',
  '',
  '"The memory says X exists" is not the same as "X exists now."',
  '',
  'A memory that summarizes repo state is frozen in time. If the user asks about recent or current state, prefer `git log` or reading the code over recalling the snapshot.',
]

export const MEMORY_FRONTMATTER_EXAMPLE: readonly string[] = [
  '```markdown',
  '---',
  'name: {{memory name}}',
  'description: {{one-line description used for future recall}}',
  'type: project',
  'tags: {{optional comma-separated topic tags, e.g. "database, migrations, postgres"}}',
  '---',
  '',
  '{{memory content: fact/preference/decision, then optional **Why:** and **How to apply:** lines}}',
  '```',
]
