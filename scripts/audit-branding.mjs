import fs from 'node:fs'
import path from 'node:path'

const repoRoot = process.cwd()

const skipDirs = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  'out',
])

const textExtensions = new Set([
  '.cjs',
  '.css',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.md',
  '.mjs',
  '.ps1',
  '.sh',
  '.ts',
  '.tsx',
  '.txt',
  '.yaml',
  '.yml',
])

const allowlistedClaudeCodePaths = [
  /^src\/commands\/init\.ts$/,
  /^src\/commands\/insights\.ts$/,
  /^src\/components\/DesktopUpsell\//,
  /^src\/components\/Feedback/,
  /^src\/components\/ManagedSettingsSecurityDialog\//,
  /^src\/components\/Passes\//,
  /^src\/components\/Teleport/,
  /^src\/components\/TrustDialog\//,
  /^src\/components\/mcp\//,
  /^src\/components\/permissions\//,
  /^src\/components\/tasks\//,
  /^src\/constants\/oauth\.ts$/,
  /^src\/constants\/product\.ts$/,
  /^src\/entrypoints\/agentSdkTypes\.ts$/,
  /^src\/entrypoints\/sandboxTypes\.ts$/,
  /^src\/tools\//,
]

const rules = [
  {
    name: 'legacy localClawd casing',
    regex: /\blocalClawd\b/g,
    isAllowed: () => false,
  },
  {
    name: 'legacy .localClawd path casing',
    regex: /\.localClawd\b/g,
    isAllowed: () => false,
  },
  {
    name: 'legacy release asset casing',
    regex: /localClawd-(?:win32|linux|darwin)/g,
    isAllowed: () => false,
  },
  {
    name: 'upstream Claude Code branding',
    regex: /\bClaude Code\b/g,
    isAllowed: relativePath =>
      allowlistedClaudeCodePaths.some(pattern => pattern.test(relativePath)),
  },
]

function isTextFile(filePath) {
  if (textExtensions.has(path.extname(filePath).toLowerCase())) {
    return true
  }

  const buffer = fs.readFileSync(filePath)
  const sampleSize = Math.min(buffer.length, 4096)
  for (let index = 0; index < sampleSize; index += 1) {
    if (buffer[index] === 0) {
      return false
    }
  }
  return true
}

function walk(dirPath, files = []) {
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!skipDirs.has(entry.name)) {
        walk(path.join(dirPath, entry.name), files)
      }
      continue
    }

    const filePath = path.join(dirPath, entry.name)
    if (isTextFile(filePath)) {
      files.push(filePath)
    }
  }
  return files
}

function getLineAndColumn(source, index) {
  const prefix = source.slice(0, index)
  const line = prefix.split('\n').length
  const lastLineBreak = prefix.lastIndexOf('\n')
  const column = index - lastLineBreak
  return { line, column }
}

function getLineText(source, lineNumber) {
  return source.split('\n')[lineNumber - 1]?.trim() ?? ''
}

const unexpected = []
const allowlisted = []

for (const absolutePath of walk(repoRoot)) {
  const relativePath = path.relative(repoRoot, absolutePath).replace(/\\/g, '/')
  if (
    relativePath === 'scripts/audit-branding.mjs' ||
    relativePath === 'tools/rebrand-localclawd.ps1'
  ) {
    continue
  }
  const source = fs.readFileSync(absolutePath, 'utf8')

  for (const rule of rules) {
    for (const match of source.matchAll(rule.regex)) {
      const index = match.index ?? 0
      const { line, column } = getLineAndColumn(source, index)
      const record = {
        rule: rule.name,
        path: relativePath,
        line,
        column,
        text: getLineText(source, line),
      }

      if (rule.isAllowed(relativePath, record.text)) {
        allowlisted.push(record)
      } else {
        unexpected.push(record)
      }
    }
  }
}

const hardFailures = unexpected.filter(finding => finding.rule !== 'upstream Claude Code branding')
const upstreamFindings = unexpected.filter(
  finding => finding.rule === 'upstream Claude Code branding',
)

if (hardFailures.length > 0) {
  console.error('Branding audit failed. Unexpected matches:')
  for (const finding of hardFailures) {
    console.error(
      `${finding.path}:${finding.line}:${finding.column} [${finding.rule}] ${finding.text}`,
    )
  }
  if (upstreamFindings.length > 0) {
    console.error(`Informational upstream Claude Code matches: ${upstreamFindings.length}`)
  }
  if (allowlisted.length > 0) {
    console.error(`Allowlisted Claude Code matches: ${allowlisted.length}`)
  }
  process.exit(1)
}

console.log('Branding audit passed.')
if (upstreamFindings.length > 0) {
  console.log(`Informational upstream Claude Code matches: ${upstreamFindings.length}`)
}
console.log(`Allowlisted Claude Code matches: ${allowlisted.length}`)
