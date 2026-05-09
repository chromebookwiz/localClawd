import { join } from 'path'
import * as React from 'react'
import { use } from 'react'
import { getOriginalCwd } from '../../bootstrap/state.js'
import { useExitOnCtrlCDWithKeybindings } from '../../hooks/useExitOnCtrlCDWithKeybindings.js'
import { useKeybinding } from '../../keybindings/useKeybinding.js'
import {
  getMemoryFiles,
  type MemoryFileInfo,
} from '../../utils/instructionsmd.js'
import { getDisplayPath } from '../../utils/file.js'
import { projectIsInGitRepo } from '../../utils/memory/versions.js'
import { Select } from '../CustomSelect/index.js'

interface ExtendedMemoryFileInfo extends MemoryFileInfo {
  isNested?: boolean
  exists: boolean
}

let lastSelectedPath: string | undefined

type Props = {
  onSelect: (path: string) => void
  onCancel: () => void
}

export function MemoryFileSelector({
  onSelect,
  onCancel,
}: Props): React.ReactNode {
  const existingMemoryFiles = use(getMemoryFiles())
  const projectMemoryPath = join(getOriginalCwd(), 'LOCALCLAWD.md')
  const hasProjectMemory = existingMemoryFiles.some(
    f => f.path === projectMemoryPath,
  )

  const allMemoryFiles: ExtendedMemoryFileInfo[] = [
    ...existingMemoryFiles
      .filter(
        f =>
          f.type !== 'AutoMem' &&
          f.type !== 'TeamMem' &&
          f.type !== 'User' &&
          f.type !== 'Managed',
      )
      .map(f => ({ ...f, exists: true })),
    ...(hasProjectMemory
      ? []
      : [
          {
            path: projectMemoryPath,
            type: 'Project' as const,
            content: '',
            exists: false,
          },
        ]),
  ]

  const isGit = projectIsInGitRepo(getOriginalCwd())
  const depths = new Map<string, number>()
  const memoryOptions = allMemoryFiles.map(file => {
    const displayPath = getDisplayPath(file.path)
    const existsLabel = file.exists ? '' : ' (new)'
    const depth = file.parent ? (depths.get(file.parent) ?? 0) + 1 : 0
    depths.set(file.path, depth)
    const indent = depth > 0 ? '  '.repeat(depth - 1) : ''

    let label: string
    if (
      file.type === 'Project' &&
      !file.isNested &&
      file.path === projectMemoryPath
    ) {
      label = 'Project memory'
    } else if (depth > 0) {
      label = `${indent}L ${displayPath}${existsLabel}`
    } else {
      label = displayPath
    }

    let description = ''
    if (
      file.type === 'Project' &&
      !file.isNested &&
      file.path === projectMemoryPath
    ) {
      description = `${isGit ? 'Checked in at' : 'Saved in'} ./LOCALCLAWD.md`
    } else if (file.parent) {
      description = '@-imported'
    } else if (file.isNested) {
      description = 'dynamically loaded'
    }

    return {
      label,
      value: file.path,
      description,
    }
  })

  const initialPath =
    lastSelectedPath && memoryOptions.some(opt => opt.value === lastSelectedPath)
      ? lastSelectedPath
      : memoryOptions[0]?.value || ''

  useExitOnCtrlCDWithKeybindings()
  useKeybinding('confirm:no', onCancel, { context: 'Confirmation' })

  return (
    <Select
      defaultFocusValue={initialPath}
      options={memoryOptions}
      onChange={value => {
        lastSelectedPath = value
        onSelect(value)
      }}
      onCancel={onCancel}
    />
  )
}
