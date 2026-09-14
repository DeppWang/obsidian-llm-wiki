import test from "node:test"
import assert from "node:assert/strict"
import { isRetryableCodexError, summarizeCodexError } from "../src/llm-client.js"

test("retry temporary Codex errors, but not auth or unknown failures", () => {
  for (const message of ["ERROR: Selected model is at capacity. Please try a different model.", "Too many requests", "Codex CLI timed out", "empty final message"]) {
    assert.equal(isRetryableCodexError(new Error(message)), true)
  }
  for (const message of ["Invalid API key", "Unknown model", "Permission denied", "exit code 1"]) {
    assert.equal(isRetryableCodexError(new Error(message)), false)
  }
})

test("show the error without echoed source text or repeated lines", () => {
  const error = "ERROR: Selected model is at capacity."
  assert.equal(summarizeCodexError(`Private note\nhook: completed\n${error}\n${error}\n`), error)
  assert.equal(summarizeCodexError("Private note"), "See stderr.log in the debug folder for details.")
})
