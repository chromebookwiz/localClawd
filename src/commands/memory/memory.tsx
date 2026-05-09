import { mkdir, writeFile } from 'fs/promises'
import { dirname } from 'path'
import * as React from 'react'
import type { CommandResultDisplay } from '../../commands.js'
import { Dialog } from '../../components/design-system/Dialog.js'
import { MemoryFileSelector } from '../../components/memory/MemoryFileSelector.js'
import { getRelativeMemoryPath } from '../../components/memory/MemoryUpdateNotification.js'
import { Box, Link, Text } from '../../ink.js'
import {
  clearProjectMemory,
  getProjectMemoryStatus,
  searchProjectMemory,
  setProjectMemoryEnabled,
} from '../../memdir/turnMemory.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import { clearMemoryFileCaches, getMemoryFiles } from '../../utils/instructionsmd.js'
import { getErrnoCode } from '../../utils/errors.js'
import { logError } from '../../utils/log.js'
import { editFileInEditor } from '../../utils/promptEditor.js'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

async function runMemoryControlCommand(args: string): Promise<string> {
  const [command = 'status', ...rest] = args.trim().split(/\s+/)
  if (command === 'on' || command === 'enable') {
    await setProjectMemoryEnabled(true)
    return 'Project memory is on. Future turns will be saved in .localclawd/memory/.'
  }
  if (command === 'off' || command === 'disable') {
    await setProjectMemoryEnabled(false)
    return 'Project memory is off. Existing memory files were left in place.'
  }
  if (command === 'clear') {
    await clearProjectMemory()
    return 'Project memory was cleared.'
  }
  if (command === 'search' || command === 'find') {
    const query = rest.join(' ').trim()
    if (!query) return 'Usage: /memory search <keywords>'
    const results = await searchProjectMemory(query)
    return results.length > 0
      ? ['Relevant project memories:', ...results.map(result => `- ${result}`)].join('\n')
      : 'No matching project memories found.'
  }
  if (command === 'status') {
    const status = await getProjectMemoryStatus()
    return [
      `Project memory: ${status.enabled ? 'on' : 'off'}`,
      `Path: ${status.memoryDir}`,
      `Files: ${status.fileCount}`,
      `Size: ${formatBytes(status.bytes)}`,
    ].join('\n')
  }
  return 'Usage: /memory [status|on|off|clear|search <keywords>]'
}

function MemoryCommand({
  onDone,
}: {
  onDone: (
    result?: string,
    options?: { display?: CommandResultDisplay },
  ) => void
}): React.ReactNode {
  const handleSelectMemoryFile = async (memoryPath: string) => {
    try {
      await mkdir(dirname(memoryPath), { recursive: true })
      try {
        await writeFile(memoryPath, '', {
          encoding: 'utf8',
          flag: 'wx',
        })
      } catch (e: unknown) {
        if (getErrnoCode(e) !== 'EEXIST') {
          throw e
        }
      }
      await editFileInEditor(memoryPath)

      let editorSource = 'default'
      let editorValue = ''
      if (process.env.VISUAL) {
        editorSource = '$VISUAL'
        editorValue = process.env.VISUAL
      } else if (process.env.EDITOR) {
        editorSource = '$EDITOR'
        editorValue = process.env.EDITOR
      }
      const editorInfo =
        editorSource !== 'default'
          ? `Using ${editorSource}="${editorValue}".`
          : ''
      const editorHint = editorInfo
        ? `> ${editorInfo} To change editor, set $EDITOR or $VISUAL environment variable.`
        : `> To use a different editor, set the $EDITOR or $VISUAL environment variable.`
      onDone(
        `Opened memory file at ${getRelativeMemoryPath(memoryPath)}\n\n${editorHint}`,
        { display: 'system' },
      )
    } catch (error) {
      logError(error)
      onDone(`Error opening memory file: ${error}`)
    }
  }
  const handleCancel = () => {
    onDone('Cancelled memory editing', { display: 'system' })
  }
  return (
    <Dialog title="Memory" onCancel={handleCancel} color="remember">
      <Box flexDirection="column">
        <React.Suspense fallback={null}>
          <MemoryFileSelector
            onSelect={handleSelectMemoryFile}
            onCancel={handleCancel}
          />
        </React.Suspense>

        <Box marginTop={1}>
          <Text dimColor>
            Learn more: <Link url="https://github.com/chromebookwiz/localclawd" />
          </Text>
        </Box>
      </Box>
    </Dialog>
  )
}

export const call: LocalJSXCommandCall = async (onDone, _context, args) => {
  if (args.trim().length > 0) {
    try {
      onDone(await runMemoryControlCommand(args), { display: 'system' })
    } catch (error) {
      logError(error)
      onDone(`Error updating memory: ${error}`, { display: 'system' })
    }
    return null
  }

  clearMemoryFileCaches()
  await getMemoryFiles()
  return <MemoryCommand onDone={onDone} />
}
