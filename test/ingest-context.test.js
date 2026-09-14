import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, mkdir, writeFile, rm, access } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { loadRelatedPages, validatePageUpdates } from "../src/ingest-context.js"
import { run } from "../src/cli.js"

test("load old pages and block updates to unread pages", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "wiki-context-test-"))
  try {
    await mkdir(path.join(dir, "wiki/entities"), { recursive: true })
    await writeFile(path.join(dir, "wiki/entities/kafka.md"), "---\ntitle: Kafka\n---\nOld facts")
    await writeFile(path.join(dir, "wiki/entities/other.md"), "Old facts")
    const pages = await loadRelatedPages(dir, "Kafka")
    assert.deepEqual(pages.map((page) => page.path), ["wiki/entities/kafka.md"])
    assert.match(pages[0].content, /Old facts/)
    assert.deepEqual(await loadRelatedPages(dir, "Kafka", [], 2), [])
    await validatePageUpdates(dir, [{ path: "wiki/entities/kafka.md" }, { path: "wiki/entities/new.md" }], pages)
    await assert.rejects(validatePageUpdates(dir, [{ path: "wiki/entities/other.md" }], pages), /without its old text/)
    const prior = await loadRelatedPages(dir, "", ["wiki/entities/other.md"])
    assert.equal(prior[0].path, "wiki/entities/other.md")
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("dry run loads custom schema in both stages without creating output", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "wiki-ingest-test-"))
  const oldEnv = { ...process.env }
  const oldFetch = globalThis.fetch
  const prompts = []
  try {
    const source = path.join(dir, "source")
    const output = path.join(dir, "output")
    const schema = path.join(dir, "schema.md")
    await mkdir(source)
    await writeFile(path.join(source, "note.md"), "#git\nA short note")
    await writeFile(path.join(source, "aaa.md"), "#github\nSkip this note")
    await writeFile(schema, "TEST WRITING RULE")
    process.env.LLM_WIKI_PROVIDER = "custom"
    process.env.LLM_WIKI_ENDPOINT = "http://test.invalid"
    globalThis.fetch = async (_url, options) => {
      prompts.push(JSON.parse(options.body).messages)
      const content = prompts.length === 1 ? "Keep one source page" : "---FILE: wiki/sources/note.md---\n---\ntype: source\n---\n# Note\n---END FILE---"
      return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n`)
    }
    await run(["git", output, "--source-dir", source, "--schema-file", schema, "--limit", "1", "--dry-run"])
    assert.equal(prompts.length, 2)
    for (const messages of prompts) assert.match(messages[0].content, /TEST WRITING RULE/)
    assert.match(prompts[0][1].content, /A short note/)
    assert.doesNotMatch(prompts[0][1].content, /Skip this note/)
    await assert.rejects(access(output), { code: "ENOENT" })
  } finally {
    globalThis.fetch = oldFetch
    for (const key of Object.keys(process.env)) if (!(key in oldEnv)) delete process.env[key]
    Object.assign(process.env, oldEnv)
    await rm(dir, { recursive: true, force: true })
  }
})
