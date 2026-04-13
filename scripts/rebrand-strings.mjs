/**
 * rebrand-strings.mjs
 * Replaces all user-facing "openclawd" and "Claude" (as product name) strings
 * with "localclawd". Also removes features that don't apply (GitHub App install).
 */

import fs from 'node:fs'
import path from 'node:path'

const repoRoot = process.cwd()

const skipDirs = new Set([
  '.git', 'node_modules', 'dist', 'build', 'coverage',
  'types/generated',  // auto-generated proto types
])

const textExtensions = new Set([
  '.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.md', '.sh', '.ps1', '.yaml', '.yml',
])

// Files/dirs to DELETE entirely (Anthropic-specific features that don't apply)
const DELETE_PATHS = [
  'src/commands/install-github-app',
  'src/commands/install.tsx',          // desktop installer (Anthropic-specific)
]

// String replacements in user-facing text — order matters (longer first)
const REPLACEMENTS = [
  // Fix the openclawd → localclawd we introduced
  [/openclawd's/g,  "localclawd's"],
  [/Openclawd's/g,  "Localclawd's"],
  [/openclawd/g,    'localclawd'],
  [/Openclawd/g,    'Localclawd'],

  // User-facing "Claude" as product name in string literals
  // Pattern: inside backtick/quote strings that are clearly UI text
  // We target specific known phrases rather than blindly replacing all Claude
  [/`Claude wants to /g,           '`localclawd wants to '],
  [/`Claude is /g,                 '`localclawd is '],
  [/'Claude is /g,                 "'localclawd is "],
  [/Claude is waiting/g,           'localclawd is waiting'],
  [/Claude is done/g,              'localclawd is done'],
  [/Claude is using/g,             'localclawd is using'],
  [/Claude is now/g,               'localclawd is now'],
  [/Claude will think/g,           'localclawd will think'],
  [/Claude will respond/g,         'localclawd will respond'],
  [/Claude will:/g,                'localclawd will:'],
  [/Claude will not/g,             'localclawd will not'],
  [/In plan mode, Claude/g,        'In plan mode, localclawd'],
  [/Claude needs your/g,           'localclawd needs your'],
  [/Claude wants to/g,             'localclawd wants to'],
  [/Claude wants to enter/g,       'localclawd wants to enter'],
  [/Claude wants to exit/g,        'localclawd wants to exit'],
  [/while Claude works/g,          'while localclawd works'],
  [/while Claude is working/g,     'while localclawd is working'],
  [/Claude completes coding/g,     'localclawd completes coding'],
  [/Claude explains its/g,         'localclawd explains its'],
  [/Claude pauses and asks/g,      'localclawd pauses and asks'],
  [/Claude in Chrome/g,            'localclawd in Chrome'],
  [/\[Claude in Chrome\]/g,        '[localclawd in Chrome]'],
  [/# Claude in Chrome/g,          '# localclawd in Chrome'],
  [/Claude PR Assistant/g,         'localclawd PR Assistant'],
  [/Claude PR assistance/g,        'localclawd PR assistance'],
  [/Claude GitHub App/g,           'localclawd GitHub App'],
  [/"Copy Claude's last response/g, '"Copy localclawd\'s last response'],
  [/Claude's last response/g,      "localclawd's last response"],
  [/Claude's current work/g,       "localclawd's current work"],
  [/Ask Claude/g,                  'Ask localclawd'],
  [/Generate with Claude/g,        'Generate with localclawd'],
  [/Checking Claude installation/g,'Checking localclawd installation'],
  [/Claude PR assistance/g,        'localclawd PR assistance'],
]

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    const relPath = path.relative(repoRoot, fullPath).replace(/\\/g, '/')

    if (entry.isDirectory()) {
      if (!skipDirs.has(entry.name) && !skipDirs.has(relPath)) {
        walk(fullPath, files)
      }
    } else if (textExtensions.has(path.extname(entry.name).toLowerCase())) {
      files.push(fullPath)
    }
  }
  return files
}

let replaced = 0
let filesChanged = 0

// Skip this script itself and the audit script
const SKIP_FILES = new Set([
  'scripts/rebrand-strings.mjs',
  'scripts/audit-branding.mjs',
  'tools/rebrand-localclawd.ps1',
])

for (const filePath of walk(repoRoot)) {
  const rel = path.relative(repoRoot, filePath).replace(/\\/g, '/')
  if (SKIP_FILES.has(rel)) continue

  let src = fs.readFileSync(filePath, 'utf8')
  let changed = false

  for (const [pattern, replacement] of REPLACEMENTS) {
    const next = src.replace(pattern, replacement)
    if (next !== src) {
      src = next
      changed = true
      replaced++
    }
  }

  if (changed) {
    fs.writeFileSync(filePath, src)
    filesChanged++
    console.log(`  updated: ${rel}`)
  }
}

console.log(`\nReplaced strings in ${filesChanged} files (${replaced} substitutions).`)

// Delete Anthropic-specific feature directories/files
console.log('\nRemoving Anthropic-specific features...')
for (const relPath of DELETE_PATHS) {
  const full = path.join(repoRoot, relPath)
  if (fs.existsSync(full)) {
    fs.rmSync(full, { recursive: true, force: true })
    console.log(`  deleted: ${relPath}`)
  } else {
    console.log(`  (already gone): ${relPath}`)
  }
}

console.log('\nDone. Run `bun run build` to verify, then check for broken imports.')
