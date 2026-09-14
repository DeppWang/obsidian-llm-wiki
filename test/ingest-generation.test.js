import test from "node:test"
import assert from "node:assert/strict"
import { generateWikiOutput } from "../src/ingest-generation.js"

const sourcePath = "wiki/sources/Git 开发流程.md"
const block = (name) => `---FILE: ${name}---\n# Content\n---END FILE---`

test("repair a renamed source path before accepting output", async () => {
  const requests = []
  let validated = 0
  const result = await generateWikiOutput({
    messages: [{ role: "user", content: "Source" }], sourcePath, dryRun: true,
    generate: async (messages) => {
      requests.push(messages)
      return block(requests.length === 1 ? "wiki/sources/Git-开发流程.md" : sourcePath)
    },
    validate: async () => { validated++ },
  })
  assert.equal(result, block(sourcePath))
  assert.equal(requests.length, 1)
  assert.equal(validated, 1)
})

test("stop after two repairs if output is still incomplete", async () => {
  let calls = 0
  await assert.rejects(generateWikiOutput({
    messages: [], sourcePath, dryRun: true,
    generate: async () => { calls++; return "No blocks" },
    validate: async () => assert.fail("Must not validate missing pages"),
  }), /Missing required source page/)
  assert.equal(calls, 3)
})
