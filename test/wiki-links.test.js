import test from "node:test"
import assert from "node:assert/strict"
import { extractWikiLinks, findBrokenWikiLinks } from "../src/wiki-links.js"

test("extract links outside code and comments", () => {
  const markdown = "[[concepts/real|Real]]\n`[[inline]]`\n```bash\nif [[ -n x ]]; then\n  echo ok\nfi\n```\n<!-- [[hidden]] -->"
  assert.deepEqual(extractWikiLinks(markdown), ["concepts/real"])
})

test("find bad direct links and allow one unique bare link", () => {
  const known = new Set(["sources/药羚 Git 工作流程规范.md", "concepts/git.md"])
  assert.deepEqual(findBrokenWikiLinks("concepts/a.md", "[[药羚 Git 工作流程规范]] [[sources/药羙 Git 工作流程规范]] [[concepts/git]]", known), ["sources/药羙 Git 工作流程规范"])
})
