#!/usr/bin/env node

import { run as runIngest } from "../src/cli.js"
import { run as runChat } from "../src/chat-shell.js"
import { run as runQuery } from "../src/query-cli.js"
import { runWithIngestLock } from "../src/ingest-lock.js"

const [command, ...rest] = process.argv.slice(2)
const runner = command === "query" ? runQuery : command === "chat" ? runChat : runIngest
const args = command === "query" || command === "chat" || command === "ingest" ? rest : process.argv.slice(2)
const isIngest = runner === runIngest

const task = isIngest ? runWithIngestLock(() => runner(args)) : runner(args)

task.catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : String(err))
  process.exitCode = 1
})
