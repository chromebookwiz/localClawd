import * as React from 'react'
import { Box, Text } from '../../ink.js'
import type { LocalJSXCommandCall } from '../../types/command.js'

type ImagesMode = 'setup' | 'review' | 'help'

function parseArgs(args: string): { mode: ImagesMode; brief: string } {
  const trimmed = args.trim()
  if (!trimmed) {
    return { mode: 'setup', brief: '' }
  }

  const [head, ...rest] = trimmed.split(/\s+/)
  const mode = head?.toLowerCase()

  if (mode === 'review') {
    return { mode: 'review', brief: rest.join(' ').trim() }
  }
  if (mode === 'help') {
    return { mode: 'help', brief: rest.join(' ').trim() }
  }
  if (mode === 'setup') {
    return { mode: 'setup', brief: rest.join(' ').trim() }
  }

  return { mode: 'setup', brief: trimmed }
}

function buildForwardedCommand(mode: ImagesMode, brief: string): string | null {
  if (mode === 'help') {
    return null
  }

  if (mode === 'review') {
    const suffix = brief
      ? ` Review these generated images and improve the prompt workflow for: ${brief}`
      : ' Review the latest generated images, write a review note, and suggest a tighter prompt revision.'
    return `/image-pipeline${suffix}`
  }

  const suffix = brief
    ? ` Set up a project-local image generation and review pipeline for this game project using ComfyUI first. Make connecting it easy, scaffold helpers and prompts, and tailor the defaults to this brief: ${brief}`
    : ' Set up a project-local image generation and review pipeline for this game project using ComfyUI first. Make connecting it easy, scaffold the helper scripts, prompt JSON templates, workflow placeholders, and any project-local defaults needed under .localclawd/image-pipeline/.'
  return `/image-pipeline${suffix}`
}

function ImagesCard({
  title,
  lines,
  onReady,
}: {
  title: string
  lines: string[]
  onReady: () => void
}): React.ReactNode {
  React.useEffect(() => {
    const id = setTimeout(onReady, 0)
    return () => clearTimeout(id)
  }, [onReady])

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color="cyan">
        {title}
      </Text>
      {lines.map((line, index) => (
        <Text key={index} dimColor={index > 0}>
          {line}
        </Text>
      ))}
    </Box>
  )
}

export const call: LocalJSXCommandCall = async (onDone, _context, args) => {
  const { mode, brief } = parseArgs(args ?? '')
  const forwarded = buildForwardedCommand(mode, brief)

  if (mode === 'help') {
    return (
      <ImagesCard
        title="◆ /images"
        lines={[
          'Use /images to bootstrap the local image pipeline quickly.',
          'Runs /image-pipeline with a ComfyUI-first setup prompt by default.',
          'Examples: /images, /images setup pixel-art UI icons, /images review stone floor texture batch',
        ]}
        onReady={() => onDone(undefined)}
      />
    )
  }

  return (
    <ImagesCard
      title={mode === 'review' ? '◆ Image Review' : '◆ Image Pipeline Setup'}
      lines={
        mode === 'review'
          ? [
              'Forwarding into the image pipeline review workflow.',
              'Generated images will be reviewed visually when image reads are available.',
            ]
          : [
              'Forwarding into the project-local image pipeline setup workflow.',
              'This will scaffold a ComfyUI-friendly setup under .localclawd/image-pipeline/.',
            ]
      }
      onReady={() =>
        onDone(undefined, {
          nextInput: forwarded ?? undefined,
          submitNextInput: forwarded ? true : undefined,
        })
      }
    />
  )
}