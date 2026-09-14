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
