import test from "node:test"
import assert from "node:assert/strict"
import { preserveSourcePath } from "../src/source-path.js"

const target = "wiki/sources/Git 开发流程.md"
const block = (name, text = "Body") => `---FILE: wiki/sources/${name}.md---\n${text}\n---END FILE---`

test("keep source spelling and fix links without changing body text", () => {
  const output = block("git-开发流程", "git-开发流程\n[[sources/git-开发流程#步骤|来源]]\n[来源](sources/git-开发流程.md)\n```\n[[sources/git-开发流程]]\n```")
  const result = preserveSourcePath(output, target)
  assert.match(result, /FILE: wiki\/sources\/Git 开发流程.md/)
  assert.match(result, /\[\[sources\/Git 开发流程#步骤\|来源\]\]/)
  assert.ok(result.includes("[来源](sources/Git%20%E5%BC%80%E5%8F%91%E6%B5%81%E7%A8%8B.md)"))
  assert.ok(result.includes("\ngit-开发流程\n"))
  assert.ok(result.includes("```\n[[sources/git-开发流程]]\n```"))
})

test("leave exact paths, unrelated pages, and ambiguous names alone", () => {
  for (const output of [block("Git 开发流程"), block("git-workflow"), block("Git-开发流程") + "\n" + block("Git_开发流程")]) {
    assert.equal(preserveSourcePath(output, target), output)
  }
})
