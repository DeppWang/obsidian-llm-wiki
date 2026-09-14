import assert from "node:assert/strict"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import { acquireIngestLock } from "../src/ingest-lock.js"

test("ingest lock blocks a second process and can be released", () => {
  const root = mkdtempSync(path.join(tmpdir(), "ingest-lock-test-"))
  const lockDir = path.join(root, "lock")

  try {
    const release = acquireIngestLock(lockDir)
    assert.equal(existsSync(lockDir), true)
    assert.throws(() => acquireIngestLock(lockDir), /already running/)

    release()
    assert.equal(existsSync(lockDir), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
