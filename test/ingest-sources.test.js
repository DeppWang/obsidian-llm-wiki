import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { listSourceFiles } from "../src/cli.js"
import { loadExpectedSources } from "../src/audit-cli.js"

const longBody = "This note has enough body text to stay in the wiki ingest."

test("ingest and audit leave out wiki-skip notes but keep short notes", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "wiki-skip-sources-"))
  try {
    await writeFile(path.join(dir, "keep.md"), `#git\n${longBody}\n`)
    await writeFile(path.join(dir, "skip.md"), `#Wiki-Skip #git\n${longBody}\n`)
    await writeFile(path.join(dir, "code.md"), "```\n#Wiki-Skip\n" + "x".repeat(80) + "\n```\n#git\n" + longBody + "\n")
    await writeFile(path.join(dir, "short.md"), "#git\ntoo short\n")
    for (const name of ["keep.md", "skip.md", "code.md", "short.md"]) {
      await utimes(path.join(dir, name), 1000, 1000)
    }

    const listed = await listSourceFiles(dir, {})
    assert.deepEqual(listed.files.map((file) => path.basename(file)), ["code.md", "keep.md", "short.md"])
    assert.equal(listed.excludedByWikiSkip, 1)

    const tagged = await listSourceFiles(dir, { tag: "git" })
    assert.deepEqual(tagged.files.map((file) => path.basename(file)), ["code.md", "keep.md", "short.md"])

    const only = await listSourceFiles(dir, { only: ["skip.md", "keep.md", "short.md"] })
    assert.deepEqual(only.files.map((file) => path.basename(file)), ["keep.md", "short.md"])
    assert.equal(only.excludedByWikiSkip, 1)

    assert.deepEqual(await loadExpectedSources(dir), ["code.md", "keep.md", "short.md"])
    assert.deepEqual(await loadExpectedSources(dir, "git"), ["code.md", "keep.md", "short.md"])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test("ingest reads recently modified notes first before applying the limit or start-after", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "wiki-source-order-"))
  try {
    for (const [name, time] of [["a.md", 1000], ["b.md", 3000], ["c.md", 2000]]) {
      await writeFile(path.join(dir, name), longBody)
      await utimes(path.join(dir, name), time, time)
    }
    const names = async (options) => (await listSourceFiles(dir, options)).files.map((file) => path.basename(file))
    assert.deepEqual(await names({}), ["b.md", "c.md", "a.md"])
    assert.deepEqual(await names({ limit: 1 }), ["b.md"])
    assert.deepEqual(await names({ startAfter: "b.md", limit: 1 }), ["c.md"])
    assert.deepEqual(await names({ only: ["a.md", "b.md"] }), ["b.md", "a.md"])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
