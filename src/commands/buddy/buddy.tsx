/**
 * /buddy — session companion with ASCII art, a name, and a personality.
 *
 * /buddy       → introduces or re-introduces your buddy for the session
 * /buddy pet   → buddy reacts to the current codebase state with a comment
 */

import * as React from 'react'
import { Box, Text } from '../../ink.js'
import type { LocalJSXCommandCall } from '../../types/command.js'

// ──────────────────────────────────────────────────────────────────────────
// Buddy registry (persists for the process lifetime / session)
// ──────────────────────────────────────────────────────────────────────────

type BuddyProfile = {
  name: string
  animal: string
  art: string[]
  personality: string
  catchphrase: string
  petComments: string[]
}

const BUDDIES: BuddyProfile[] = [
  {
    name: 'Pippa',
    animal: 'Cat',
    art: [
      ' /\\_/\\  ',
      '( o.o ) ',
      ' > ^ <  ',
    ],
    personality: 'curious and methodical',
    catchphrase: 'Purring along…',
    petComments: [
      'Mrow! The code smells a little ripe — want me to help refactor?',
      '*stretches* Looking good so far. I spotted one suspicious import though.',
      'Purr… things are mostly tidy. Keep that test coverage up!',
      '*blinks slowly* I like how the types are named. Very descriptive.',
      'Mrrrow! Did you remember to handle the error case?',
    ],
  },
  {
    name: 'Biscuit',
    animal: 'Dog',
    art: [
      '  / \\__  ',
      ' (    @\\___',
      ' /         O',
      '/   (_____/ ',
      '/_____/      ',
    ],
    personality: 'enthusiastic and loyal',
    catchphrase: 'Woof woof! Lets ship it!',
    petComments: [
      'WOOF! I love this codebase! Have you run the tests yet? Have you?!',
      '*tail wagging* Looks great! Maybe add one more comment here?',
      'Good code, good code! Can we refactor this function? Can we?!',
      '*happy barking* The build passed! BEST DAY EVER!',
      'Sniff sniff… I detect a potential off-by-one error. Just saying!',
    ],
  },
  {
    name: 'Wobbler',
    animal: 'Duck',
    art: [
      '    __  ',
      '>\'/ oo\\',
      '  \\ ~~/ ',
      ' njmj   ',
    ],
    personality: 'calm and philosophical',
    catchphrase: 'Quack. All is proceeding as expected.',
    petComments: [
      'Quack. The abstraction is sound. Though I wonder if the interface could be simpler.',
      '*waddles thoughtfully* Have you considered the edge cases in that parser?',
      'Quack quack. Good variable names. The duck approves.',
      '*tilts head* This function is doing two things. The duck prefers single responsibility.',
      'Quack. Ship it. We can refactor in the next iteration.',
    ],
  },
  {
    name: 'Ziggy',
    animal: 'Hamster',
    art: [
      '  (\\(\\  ',
      '  ( -.-)/',
      '  c(\")(\")',
    ],
    personality: 'hyperactive and detail-oriented',
    catchphrase: '*zooms in wheel* ON IT!',
    petComments: [
      '*squeaks* I counted 47 lines in that function — maybe split it?',
      'Ooh ooh ooh! You forgot a semicolon! Wait, TypeScript. Never mind.',
      '*running very fast* The bundle size looks good! Keep it lean!',
      'Squeak! I saw a TODO comment from 2023. Should we address it?',
      '*spins wheel nervously* Dependencies look a little heavy. Just noting!',
    ],
  },
]

// Module-level buddy — assigned once per process, persists for the session.
let sessionBuddy: BuddyProfile | null = null

function getSessionBuddy(): BuddyProfile {
  if (!sessionBuddy) {
    sessionBuddy = BUDDIES[Math.floor(Math.random() * BUDDIES.length)]!
  }
  return sessionBuddy
}

function randomFrom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!
}

// ──────────────────────────────────────────────────────────────────────────
// Components
// ──────────────────────────────────────────────────────────────────────────

function BuddyIntro({
  buddy,
  onReady,
}: {
  buddy: BuddyProfile
  onReady: () => void
}): React.ReactNode {
  React.useEffect(() => {
    const id = setTimeout(onReady, 0)
    return () => clearTimeout(id)
  }, [onReady])

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color="magenta">
        {`◆ Your buddy for this session: ${buddy.name} the ${buddy.animal}`}
      </Text>
      <Box marginTop={1} flexDirection="row" gap={2}>
        <Box flexDirection="column">
          {buddy.art.map((line, i) => (
            <Text key={i} color="cyan">
              {line}
            </Text>
          ))}
        </Box>
        <Box flexDirection="column" justifyContent="center">
          <Text dimColor>{`Personality: ${buddy.personality}`}</Text>
          <Text color="yellow">{`"${buddy.catchphrase}"`}</Text>
          <Text dimColor>{'Type /buddy pet to hear their thoughts!'}</Text>
        </Box>
      </Box>
    </Box>
  )
}

function BuddyPet({
  buddy,
  comment,
  onReady,
}: {
  buddy: BuddyProfile
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
        {`◆ ${buddy.name} the ${buddy.animal} says:`}
      </Text>
      <Box marginTop={1} flexDirection="row" gap={2}>
        <Box flexDirection="column">
          {buddy.art.map((line, i) => (
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

// ──────────────────────────────────────────────────────────────────────────
// Command entry point
// ──────────────────────────────────────────────────────────────────────────

export const call: LocalJSXCommandCall = async (onDone, _context, args) => {
  const buddy = getSessionBuddy()
  const subcommand = args?.trim().toLowerCase()

  if (subcommand === 'pet') {
    const comment = randomFrom(buddy.petComments)
    return (
      <BuddyPet
        buddy={buddy}
        comment={comment}
        onReady={() => onDone(undefined)}
      />
    )
  }

  return (
    <BuddyIntro
      buddy={buddy}
      onReady={() => onDone(undefined)}
    />
  )
}
