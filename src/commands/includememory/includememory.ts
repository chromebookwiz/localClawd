import { join } from 'path'
import type { LocalCommandCall } from '../../types/command.js'
import { getOriginalCwd } from '../../bootstrap/state.js'
import {
  getGlobalGitignorePath,
  removeGitignoreRulesFromFile,
} from '../../utils/git/gitignore.js'

const MEMORY_GITIGNORE_PATTERNS = [
  'LOCALCLAWD.local.md',
  './LOCALCLAWD.local.md',
  '/LOCALCLAWD.local.md',
  '**/LOCALCLAWD.local.md',
] as const

export const call: LocalCommandCall = async () => {
  const gitignorePaths = [
    join(getOriginalCwd(), '.gitignore'),
    getGlobalGitignorePath(),
  ]

  const results = await Promise.all(
    gitignorePaths.map(path =>
      removeGitignoreRulesFromFile(path, MEMORY_GITIGNORE_PATTERNS),
    ),
  )
  const removed = results.filter(result => result.removed)

  const lines =
    removed.length > 0
      ? [
          'Local memory is no longer gitignored.',
          ...removed.map(result => `Updated ${result.path}`),
        ]
      : [
          'Local memory was not gitignored.',
          'LOCALCLAWD.local.md can already be added to git if it exists.',
        ]

  return { type: 'text', value: lines.join('\n') }
}
