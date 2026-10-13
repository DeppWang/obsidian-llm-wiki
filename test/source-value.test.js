import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { assessSourceValue, markSourceSkipped } from "../src/source-value.js"

test("write the skip tag once and leave changed sources alone", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "wiki-skip-tag-"))
  const file = path.join(dir, "work.md")
  try {
    await writeFile(file, "Work items")
    await markSourceSkipped(file, "Work items")
    const tagged = await readFile(file, "utf8")
    assert.equal(tagged, "#Wiki-Skip\n\nWork items")
    await markSourceSkipped(file, tagged)
    assert.equal(await readFile(file, "utf8"), tagged)
    await writeFile(file, "New lesson")
    await assert.rejects(markSourceSkipped(file, "Work items"), /Source changed/)
    assert.equal(await readFile(file, "utf8"), "New lesson")
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("a work list can be skipped before wiki analysis", async () => {
  const result = await assessSourceValue({
    fileName: "Hennessy 后端工作项.md",
    markdown: "| 工作项 | 工作范围 |\n| --- | --- |\n| 手机授权 | 对接手机号授权 |",
    generate: async (messages) => {
      assert.match(messages[0].content, /Technical names alone are not enough/)
      assert.match(messages[1].content, /对接手机号授权/)
      return '{"worthReading": false, "reason": "Only project work items"}'
    },
  })
  assert.deepEqual(result, { worthReading: false, reason: "Only project work items" })
})

test("accept a keep decision inside a JSON code fence", async () => {
  const result = await assessSourceValue({
    fileName: "Git.md", markdown: "Use git status to check changes.",
    generate: async () => '```json\n{"worthReading":true,"reason":"Useful command"}\n```',
  })
  assert.equal(result.worthReading, true)
})

test("bad replies and model errors do not become skip decisions", async () => {
  for (const reply of ["Skip", "null", '{"worthReading":"false","reason":"Work"}', '{"worthReading":false,"reason":""}']) {
    await assert.rejects(assessSourceValue({
      fileName: "note.md", markdown: "Note", generate: async () => reply,
    }), /Invalid source value reply/)
  }
  await assert.rejects(assessSourceValue({
    fileName: "note.md", markdown: "Note", generate: async () => { throw new Error("Model failed") },
  }), /Model failed/)
})
