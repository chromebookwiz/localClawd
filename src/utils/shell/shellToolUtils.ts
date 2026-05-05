import { BASH_TOOL_NAME } from '../../tools/BashTool/toolName.js'
import { POWERSHELL_TOOL_NAME } from '../../tools/PowerShellTool/toolName.js'
import { isEnvDefinedFalsy, isEnvTruthy } from '../envUtils.js'
import { getPlatform } from '../platform.js'

export const SHELL_TOOL_NAMES: string[] = [BASH_TOOL_NAME, POWERSHELL_TOOL_NAME]

const WINDOWS_NATIVE_BUILD_RE =
  /(^|\s)(cmake|ctest|ninja|msbuild|devenv|cl(?:\.exe)?|link(?:\.exe)?|dumpbin(?:\.exe)?|rc(?:\.exe)?|mt(?:\.exe)?|signtool(?:\.exe)?)(?=\s|$)/i
const WINDOWS_MINGW_OR_MSYS_RE =
  /(mingw|msys2?|ucrt64|clang64|mingw32-make|g\+\+|gcc|makefiles|pacman|\/mingw|\\mingw)/i
const BASH_ONLY_SYNTAX_RE = /(\&\&|\|\||2>\/dev\/null|>\/dev\/null|\$\(|`)/

/**
 * Runtime gate for PowerShellTool. Windows-only (the permission engine uses
 * Win32-specific path normalizations). Ant defaults on (opt-out via env=0);
 * external defaults off (opt-in via env=1).
 *
 * Used by tools.ts (tool-list visibility), processBashCommand (! routing),
 * and promptShellExecution (skill frontmatter routing) so the gate is
 * consistent across all paths that invoke PowerShellTool.call().
 */
export function isPowerShellToolEnabled(): boolean {
  if (getPlatform() !== 'windows') return false
  return process.env.USER_TYPE === 'ant'
    ? !isEnvDefinedFalsy(process.env.CLAUDE_CODE_USE_POWERSHELL_TOOL)
    : isEnvTruthy(process.env.CLAUDE_CODE_USE_POWERSHELL_TOOL)
}

/**
 * Prefer PowerShell for native Windows build commands when the command does
 * not explicitly target a MinGW/MSYS toolchain or rely on bash-only syntax.
 */
export function shouldPreferPowerShellForCommand(command: string): boolean {
  if (!isPowerShellToolEnabled()) return false
  if (!WINDOWS_NATIVE_BUILD_RE.test(command)) return false
  if (WINDOWS_MINGW_OR_MSYS_RE.test(command)) return false
  if (BASH_ONLY_SYNTAX_RE.test(command)) return false
  return true
}
