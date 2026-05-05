import * as React from 'react'
import { Box, Text } from '../../ink.js'
import { ensureCompanion, getCompanion } from '../../buddy/companion.js'
import { RARITY_STARS } from '../../buddy/types.js'
import { renderSprite } from '../../buddy/sprites.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import { getGlobalConfig } from '../../utils/config.js'

function randomFrom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!
}

function formatSpeciesLabel(species: string): string {
  return species.charAt(0).toUpperCase() + species.slice(1)
}

function companionCatchphrase(name: string, species: string): string {
  return randomFrom([
    `${name} the ${species} is ready to keep watch.`,
    `${name} is perched nearby and paying attention.`,
    `${name} settles in and starts inspecting the workspace.`,
  ])
}

function companionPetComment(name: string, species: string): string {
  return randomFrom([
    `${name} the ${species} peers at the code and suspects one more edge case is worth checking.`,
    `${name} gives an approving nod, but only after a full lint pass.`,
    `${name} seems pleased. The posture suggests the current approach is sound.`,
    `${name} taps the terminal and votes for one more quick verification before shipping.`,
  ])
}

function BuddyIntro({
  art,
  name,
  species,
  personality,
  rarity,
  created,
  onReady,
}: {
  art: string[]
  name: string
  species: string
  personality: string
  rarity: string
  created: boolean
  onReady: () => void
}): React.ReactNode {
  React.useEffect(() => {
    const id = setTimeout(onReady, 0)
    return () => clearTimeout(id)
  }, [onReady])

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color="magenta">
        {created
          ? `◆ Your buddy just hatched: ${name} the ${species}`
          : `◆ Your buddy: ${name} the ${species}`}
      </Text>
      <Box marginTop={1} flexDirection="row" gap={2}>
        <Box flexDirection="column">
          {art.map((line, i) => (
            <Text key={i} color="cyan">
              {line}
            </Text>
          ))}
        </Box>
        <Box flexDirection="column" justifyContent="center">
          <Text dimColor>{`Personality: ${personality}`}</Text>
          <Text dimColor>{`Rarity: ${rarity}`}</Text>
          <Text color="yellow">{`"${companionCatchphrase(name, species)}"`}</Text>
          <Text dimColor>{'Type /buddy pet to hear their thoughts!'}</Text>
        </Box>
      </Box>
    </Box>
  )
}

function BuddyPet({
  art,
  name,
  species,
  comment,
  onReady,
}: {
  art: string[]
  name: string
  species: string
  comment: string
  onReady: () => void
}): React.ReactNode {
  React.useEffect(() => {
    const id = setTimeout(onReady, 0)
    return () => clearTimeout(id)
  }, [onReady])

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color="magenta">
        {`◆ ${name} the ${species} says:`}
      </Text>
      <Box marginTop={1} flexDirection="row" gap={2}>
        <Box flexDirection="column">
          {art.map((line, i) => (
            <Text key={i} color="cyan">
              {line}
            </Text>
          ))}
        </Box>
        <Box flexDirection="column" justifyContent="center">
          <Box
            borderStyle="round"
            borderColor="magenta"
            paddingX={1}
          >
            <Text color="white">{comment}</Text>
          </Box>
        </Box>
      </Box>
    </Box>
  )
}

export const call: LocalJSXCommandCall = async (onDone, _context, args) => {
  const hadCompanion = Boolean(getCompanion())
  const wasMuted = getGlobalConfig().companionMuted === true
  const companion = ensureCompanion({ unmute: true })
  const subcommand = args?.trim().toLowerCase()
  const species = formatSpeciesLabel(companion.species)
  const art = renderSprite(companion)
  const rarity = RARITY_STARS[companion.rarity]

  if (subcommand === 'pet') {
    const comment = companionPetComment(companion.name, species)
    return (
      <BuddyPet
        art={art}
        name={companion.name}
        species={species}
        comment={comment}
        onReady={() => onDone(undefined)}
      />
    )
  }

  return (
    <BuddyIntro
      art={art}
      name={companion.name}
      species={species}
      personality={companion.personality}
      rarity={rarity}
      created={!hadCompanion || wasMuted}
      onReady={() => onDone(undefined)}
    />
  )
}
