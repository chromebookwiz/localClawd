import React from 'react'
import { Text } from '../../ink.js'
import type { Output } from './GenerateImageTool.js'

export function userFacingName(): string {
  return 'GenerateImage'
}

export function getToolUseSummary(input: Partial<{ prompt: string }>): string {
  return input.prompt ? `"${input.prompt.slice(0, 60)}${input.prompt.length > 60 ? '…' : ''}"` : ''
}

export function renderToolUseMessage(
  input: Partial<{ prompt: string }>,
): React.ReactNode {
  return input.prompt ?? null
}

export function renderToolUseErrorMessage(error: Error): React.ReactNode {
  return <Text color="red">{`GenerateImage error: ${error.message}`}</Text>
}

export function renderToolResultMessage(output: Output): React.ReactNode {
  return (
    <Text dimColor>
      {output.path
        ? `Saved: ${output.path}`
        : output.error ?? 'Generation failed'}
    </Text>
  )
}
