import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const macroDefaults = {
  VERSION: process.env.LOCALCLAWD_SOURCE_VERSION ?? '0.0.0-source',
  BUILD_TIME: process.env.LOCALCLAWD_SOURCE_BUILD_TIME ?? '',
  PACKAGE_URL: process.env.LOCALCLAWD_PACKAGE_URL ?? 'localclawd',
  NATIVE_PACKAGE_URL:
    process.env.LOCALCLAWD_NATIVE_PACKAGE_URL ?? 'localclawd-native',
  ISSUES_EXPLAINER:
    process.env.LOCALCLAWD_ISSUES_EXPLAINER ??
    'open an issue in the localclawd repository',
  FEEDBACK_CHANNEL:
    process.env.LOCALCLAWD_FEEDBACK_CHANNEL ?? 'the localclawd issue tracker',
  VERSION_CHANGELOG: process.env.LOCALCLAWD_VERSION_CHANGELOG ?? '',
}

type MacroShape = typeof macroDefaults

const globalWithMacro = globalThis as typeof globalThis & {
  MACRO?: MacroShape
}

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const nodePathDelimiter = process.platform === 'win32' ? ';' : ':'

if (!process.env.NODE_PATH) {
  process.env.NODE_PATH = sourceRoot
} else if (!process.env.NODE_PATH.split(nodePathDelimiter).includes(sourceRoot)) {
  process.env.NODE_PATH = `${sourceRoot}${nodePathDelimiter}${process.env.NODE_PATH}`
}

process.env.USER_TYPE ??= 'external'

globalWithMacro.MACRO ??= macroDefaults

const args = process.argv.slice(2)

if (args[0] === 'install') {
  console.log('localclawd is already installed from this source checkout.')
  console.log(
    process.platform === 'win32'
      ? 'To rebuild the launcher, rerun tools\\install-localclawd.ps1 from the repository root.'
      : 'To rebuild the launcher, rerun ./tools/install-localclawd.sh from the repository root.',
  )
  console.log(
    'The native `localclawd install` command is intended for packaged builds, not source-checkout launchers.',
  )
  process.exit(0)
}

if (args[0] === 'update') {
  console.log(
    process.platform === 'win32'
      ? 'Rerun the Windows bootstrap command to refresh this source checkout.'
      : 'Rerun the Unix bootstrap command to refresh this source checkout.',
  )
  process.exit(0)
}

if (
  args.length === 0 ||
  args[0] === '--help' ||
  args[0] === '-h' ||
  args[0] === 'help'
) {
  console.log('localclawd source launcher')
  console.log('')
  console.log('Available source-checkout commands:')
  console.log('  localclawd             Show this help summary')
  console.log('  localclawd --version   Show the source launcher version')
  console.log('  localclawd install     Rebuild the source-checkout launcher')
  console.log('  localclawd update      Explain how to refresh this checkout')
  console.log('')
  console.log(
    'This launcher runs directly from a source checkout and does not behave like a packaged release build.',
  )
  process.exit(0)
}

await import('./cli.tsx')