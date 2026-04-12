import { spawnSync } from 'node:child_process'

const steps = [
  ['bun', ['run', 'build']],
  ['node', ['scripts/audit-branding.mjs']],
  ['node', ['scripts/verify-npm-install.mjs']],
]

for (const [command, args] of steps) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    stdio: 'inherit',
  })

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}