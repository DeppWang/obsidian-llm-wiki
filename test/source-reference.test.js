import test from "node:test"
import assert from "node:assert/strict"
import { addSourceReference } from "../src/source-reference.js"

test("add an encoded original link after frontmatter without changing body", () => {
  const output = "---FILE: wiki/sources/Git note.md---\n---\ntype: source\n---\n# Git\nBody\n---END FILE---"
  const result = addSourceReference(output, "wiki/sources/Git note.md", "/notes/Git note.md")
  assert.match(result, /type: source\n---\n\n<!-- original-source -->/)
  assert.ok(result.includes("file:///notes/Git%20note.md"))
  assert.ok(result.includes("# Git\nBody\n---END FILE---"))
})

test("replace a model-made source block with one standard block", () => {
  const old = "<!-- original-source -->\n> Old link\n<!-- /original-source -->"
  const output = `---FILE: wiki/sources/a.md---\n---\ntype: source\n---\n${old}\n# A\n---END FILE---`
  const result = addSourceReference(output, "wiki/sources/a.md", "/notes/a.md")
  assert.equal(result.match(/<!-- original-source -->/g)?.length, 1)
  assert.doesNotMatch(result, /Old link/)
  assert.match(result, /file:\/\/\/notes\/a.md/)
})
