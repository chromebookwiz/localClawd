import type { Command } from '../../commands.js'

const ctx: Command = {
  type: 'local-jsx',
  name: 'ctx',
  aliases: ['context-window', 'cw', 'contextsize', 'ctxsize'],
  description:
    'Show and configure context window size. ' +
    'Usage: /ctx              — show current context window and usage\n' +
    '       /ctx 200k         — set context window (shorthand for /ctx set)\n' +
    '       /ctx set 200k     — set context window (supports 200k, 1m, or plain number)\n' +
    '       /ctx reset        — clear saved size, re-detect from provider\n' +
    '       /ctx compact off  — disable auto-compact\n' +
    '       /ctx compact on   — enable auto-compact',
  load: () => import('./ctx.js'),
}

export default ctx
