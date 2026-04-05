import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const repoRoot = process.cwd()
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'localclawd-npm-verify-'))

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  })

  if (result.status !== 0) {
    throw new Error(
      [
        `Command failed: ${command} ${args.join(' ')}`,
        result.stdout.trim(),
        result.stderr.trim(),
      ]
        .filter(Boolean)
        .join('\n'),
    )
  }

  return result.stdout.trim()
}

try {
  const packOutput = run('npm', ['pack'], repoRoot)
  const tarballName = packOutput.split(/\r?\n/).pop()
  if (!tarballName) {
    throw new Error('npm pack did not produce a tarball name')
  }

  const tarballPath = path.join(repoRoot, tarballName)
  const installRoot = path.join(tempRoot, 'project')
  fs.mkdirSync(installRoot, { recursive: true })

  run('npm', ['init', '-y'], installRoot)
  run('npm', ['install', tarballPath], installRoot)

  const binary = process.platform === 'win32'
    ? path.join(installRoot, 'node_modules', '.bin', 'localclawd.cmd')
    : path.join(installRoot, 'node_modules', '.bin', 'localclawd')

  const versionOutput = run(binary, ['--version'], installRoot)
  console.log(`Installed binary check: ${versionOutput}`)

  fs.rmSync(tarballPath, { force: true })
  fs.rmSync(tempRoot, { recursive: true, force: true })
} catch (error) {
  fs.rmSync(tempRoot, { recursive: true, force: true })
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}