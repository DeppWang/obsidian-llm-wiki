import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import test from "node:test"
import { terminateProcessTree } from "../src/llm-client.js"

test("terminateProcessTree stops a detached process group", async () => {
  if (process.platform === "win32") return

  const child = spawn("sh", ["-c", "sleep 30 & wait"], {
    detached: true,
    stdio: "ignore",
  })

  await new Promise((resolve) => setTimeout(resolve, 50))
  await terminateProcessTree(child, 200)

  assert.notEqual(child.signalCode, null)
})
