import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'

const repoRoot = process.cwd()
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'localclawd-npm-verify-'))
const installRoot = path.join(tempRoot, 'install-root')
const workspaceRoot = path.join(tempRoot, 'workspace')
const homeRoot = path.join(tempRoot, 'home')
const STARTUP_TIMEOUT_MS = 30000
const STARTUP_POLL_INTERVAL_MS = 200
const STARTUP_MARKERS = [
  '[STARTUP] Commands and agents loaded',
  '[STARTUP] Ink root created',
]

function getNpmInvocation() {
  if (process.platform !== 'win32') {
    return {
      command: 'npm',
      argsPrefix: [],
    }
  }

  return {
    command: process.execPath,
    argsPrefix: [
      path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    ],
  }
}

function getTempFilePath(fileName) {
  return path.join(tempRoot, fileName)
}

function run(command, args, cwd, extraOptions = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    shell: false,
    ...extraOptions,
  })

  if (result.status !== 0) {
    throw new Error(
      [
        `Command failed: ${command} ${args.join(' ')}`,
        result.stdout?.trim() ?? '',
        result.stderr?.trim() ?? '',
      ]
        .filter(Boolean)
        .join('\n'),
    )
  }

  return result.stdout?.trim() ?? ''
}

function runNpm(args, cwd, extraOptions = {}) {
  const npmInvocation = getNpmInvocation()
  return run(
    npmInvocation.command,
    [...npmInvocation.argsPrefix, ...args],
    cwd,
    extraOptions,
  )
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function cleanupTempArtifacts(extraPath) {
  if (extraPath) {
    fs.rmSync(extraPath, { force: true })
  }
  fs.rmSync(tempRoot, { recursive: true, force: true })
}

function readIfExists(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : ''
}

function tailLogContents(contents, maxLines = 80) {
  const lines = contents
    .split(/\r?\n/)
    .map(line => line.trimEnd())
    .filter(Boolean)

  return lines.slice(-maxLines).join('\n')
}

function killChildProcess(child) {
  if (!child.pid || child.killed) {
    return
  }

  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
      stdio: 'ignore',
      shell: false,
    })
    return
  }

  child.kill('SIGTERM')
}

function buildVerifierEnv(debugLogPath) {
  const baseEnv = {
    ...process.env,
    HOME: homeRoot,
    USERPROFILE: homeRoot,
    NO_COLOR: '1',
  }

  return {
    ...baseEnv,
    LOCALAPPDATA: path.join(homeRoot, 'AppData', 'Local'),
    APPDATA: path.join(homeRoot, 'AppData', 'Roaming'),
    CLAUDE_CONFIG_DIR: homeRoot,
    LOCALCLAWD_VERIFY_DEBUG_LOG: debugLogPath,
  }
}

function ensureVerifierDirectories() {
  fs.mkdirSync(installRoot, { recursive: true })
  fs.mkdirSync(workspaceRoot, { recursive: true })
  fs.mkdirSync(path.join(homeRoot, 'AppData', 'Local'), { recursive: true })
  fs.mkdirSync(path.join(homeRoot, 'AppData', 'Roaming'), { recursive: true })
}

function seedVerifierHomeConfig() {
  const configPath = path.join(homeRoot, '.claude.json')
  const seededConfig = {
    theme: 'dark',
    hasCompletedOnboarding: true,
    localBackendProvider: 'vllm',
    localBackendBaseUrl: 'http://127.0.0.1:8000/v1',
    localBackendModel: 'qwen2.5-coder-32b-instruct',
  }

  fs.writeFileSync(configPath, `${JSON.stringify(seededConfig, null, 2)}\n`)
}

async function verifyInteractiveStartup(command, args) {
  if (!(process.stdin.isTTY && process.stdout.isTTY && process.stderr.isTTY)) {
    console.log('Interactive startup check skipped: current terminal is not a TTY')
    return
  }

  const debugLogPath = path.join(tempRoot, 'interactive-startup.log')
  const child = spawn(command, [...args, '--debug', '--debug-file', debugLogPath], {
    cwd: workspaceRoot,
    env: buildVerifierEnv(debugLogPath),
    shell: false,
    stdio: 'inherit',
  })

  const start = Date.now()
  let exitCode = null
  let exitSignal = null

  child.on('exit', (code, signal) => {
    exitCode = code
    exitSignal = signal
  })

  try {
    while (Date.now() - start < STARTUP_TIMEOUT_MS) {
      const logContents = readIfExists(debugLogPath)
      if (STARTUP_MARKERS.every(marker => logContents.includes(marker))) {
        console.log('Installed interactive startup check: passed')
        return
      }

      if (exitCode !== null || exitSignal !== null) {
        throw new Error(
          [
            `Installed interactive startup exited before reaching the dashboard (code=${exitCode}, signal=${exitSignal})`,
            `workspace=${workspaceRoot}`,
            `home=${homeRoot}`,
            `debugLog=${debugLogPath}`,
            tailLogContents(logContents),
          ]
            .filter(Boolean)
            .join('\n'),
        )
      }

      await sleep(STARTUP_POLL_INTERVAL_MS)
    }

    const logContents = readIfExists(debugLogPath)
    throw new Error(
      [
        `Installed interactive startup did not reach the dashboard within ${STARTUP_TIMEOUT_MS}ms`,
        `workspace=${workspaceRoot}`,
        `home=${homeRoot}`,
        `debugLog=${debugLogPath}`,
        tailLogContents(logContents),
      ]
        .filter(Boolean)
        .join('\n'),
    )
  } finally {
    killChildProcess(child)
  }
}

let tarballPath = null

try {
  const packOutput = runNpm(['pack'], repoRoot)
  const tarballName = packOutput.split(/\r?\n/).pop()
  if (!tarballName) {
    throw new Error('npm pack did not produce a tarball name')
  }

  tarballPath = path.join(repoRoot, tarballName)
  ensureVerifierDirectories()
  seedVerifierHomeConfig()

  runNpm(['init', '-y'], installRoot)
  runNpm(['install', tarballPath], installRoot)

  const installedEntrypoint = path.join(
    installRoot,
    'node_modules',
    'localclawd',
    'bin',
    'localclawd.cjs',
  )
  const command = process.execPath
  const commandArgs = [installedEntrypoint]

  const versionOutput = run(command, [...commandArgs, '--version'], workspaceRoot, {
    shell: false,
  })
  console.log(`Installed binary check: ${versionOutput}`)

  await verifyInteractiveStartup(command, commandArgs)

  cleanupTempArtifacts(tarballPath)
} catch (error) {
  cleanupTempArtifacts(tarballPath)
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}