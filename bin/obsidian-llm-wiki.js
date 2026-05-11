#!/usr/bin/env node

import { run as runIngest } from "../src/cli.js"
import { run as runQuery } from "../src/query-cli.js"

const [command, ...rest] = process.argv.slice(2)
const runner = command === "query" ? runQuery : runIngest
const args = command === "query" || command === "ingest" ? rest : process.argv.slice(2)

runner(args).catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : String(err))
  process.exitCode = 1
})
