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

export function renderToolUseErrorMessage(error: unknown): React.ReactNode {
  const msg = error instanceof Error ? (error.message ?? 'unknown error') : (error != null ? String(error) : 'unknown error')
  return <Text color="red">{`GenerateImage error: ${msg}`}</Text>
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
