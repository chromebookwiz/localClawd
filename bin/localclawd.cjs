#!/usr/bin/env node
'use strict'

// Dynamic import to load the ESM dist from a CJS entry point.
// npm requires a .cjs (or .js in a CJS package) bin script — .mjs is not
// accepted as a valid bin executable by the npm registry validator.
import('../dist/cli.mjs').catch(err => {
  console.error(err)
  process.exit(1)
})
