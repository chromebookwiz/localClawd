import chalk from 'chalk'
import { SHOW_CURSOR, HIDE_CURSOR } from '../ink/termio/dec.js'
import { CURSOR_LEFT, ERASE_LINE } from '../ink/termio/csi.js'
import { writeToStderr } from './process.js'

export type StartupLoadingIndicator = {
  update(message: string): void
  stop(): void
}

const TRIANGLE_FRAMES = [
  ['▲', '▼'],
  ['▶', '◀'],
  ['▼', '▲'],
  ['◀', '▶'],
] as const

function canRenderStartupLoadingIndicator(): boolean {
  return process.stderr.isTTY === true && !process.argv.includes('--debug-to-stderr')
}

export function startStartupLoadingIndicator(
  initialMessage = 'Starting localclawd',
): StartupLoadingIndicator {
  if (!canRenderStartupLoadingIndicator()) {
    return {
      update() {},
      stop() {},
    }
  }

  let frameIndex = 0
  let message = initialMessage
  let stopped = false

  const clear = (): void => {
    writeToStderr(`\r${CURSOR_LEFT}${ERASE_LINE}${SHOW_CURSOR}`)
  }

  const render = (): void => {
    const [primaryTriangle, secondaryTriangle] =
      TRIANGLE_FRAMES[frameIndex % TRIANGLE_FRAMES.length]
    const frame = `${chalk.red(primaryTriangle)}${chalk.dim('◈')}${chalk.blue(secondaryTriangle)}`
    const suffix = chalk.dim(' loading...')
    writeToStderr(`\r${HIDE_CURSOR}${CURSOR_LEFT}${ERASE_LINE}${frame} ${message}${suffix}`)
    frameIndex += 1
  }

  const onExit = (): void => {
    if (!stopped) {
      clear()
    }
  }

  render()
  const interval = setInterval(render, 80)
  process.on('exit', onExit)

  return {
    update(nextMessage: string): void {
      if (stopped) {
        return
      }
      message = nextMessage
      render()
    },
    stop(): void {
      if (stopped) {
        return
      }
      stopped = true
      clearInterval(interval)
      process.off('exit', onExit)
      clear()
    },
  }
}