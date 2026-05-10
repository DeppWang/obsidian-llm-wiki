#!/usr/bin/env node

import { run } from "../src/cli.js"

run().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : String(err))
  process.exitCode = 1
})
