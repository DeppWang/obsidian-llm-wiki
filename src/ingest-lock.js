import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const DEFAULT_LOCK_DIR = path.join(tmpdir(), "obsidian-llm-wiki-node-ingest.lock")

export function acquireIngestLock(lockDir = DEFAULT_LOCK_DIR) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      mkdirSync(lockDir)
      writeFileSync(
        path.join(lockDir, "owner.json"),
        JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
        "utf8",
      )
      return createRelease(lockDir, process.pid)
    } catch (err) {
      if (err?.code !== "EEXIST") throw err

      const owner = readOwner(lockDir)
      if (owner?.pid && isProcessRunning(owner.pid)) {
        throw new Error(`Another ingest is already running (PID ${owner.pid})`)
      }

      rmSync(lockDir, { recursive: true, force: true })
    }
  }

  throw new Error("Could not acquire the ingest lock")
}

export async function runWithIngestLock(task, lockDir = DEFAULT_LOCK_DIR) {
  const release = acquireIngestLock(lockDir)
  const onExit = () => release()
  const signalHandlers = new Map()

  process.once("exit", onExit)
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    const handler = () => {
      release()
      process.removeListener("exit", onExit)
      process.removeListener(signal, handler)
      process.kill(process.pid, signal)
    }
    signalHandlers.set(signal, handler)
    process.once(signal, handler)
  }

  try {
    return await task()
  } finally {
    process.removeListener("exit", onExit)
    for (const [signal, handler] of signalHandlers) process.removeListener(signal, handler)
    release()
  }
}

function createRelease(lockDir, ownerPid) {
  let released = false
  return () => {
    if (released) return
    released = true
    const owner = readOwner(lockDir)
    if (!owner || owner.pid === ownerPid) rmSync(lockDir, { recursive: true, force: true })
  }
}

function readOwner(lockDir) {
  try {
    return JSON.parse(readFileSync(path.join(lockDir, "owner.json"), "utf8"))
  } catch {
    return null
  }
}

function isProcessRunning(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return err?.code === "EPERM"
  }
}
