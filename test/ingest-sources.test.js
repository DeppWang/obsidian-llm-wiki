import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
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
