import test from "node:test"
import assert from "node:assert/strict"
import { auditWiki } from "../src/audit-cli.js"

test("audit finds missing sources, broken links, and orphan pages", () => {
  const pages = [
    { path: "sources/a.md", content: "---\ntitle: A\n---\n<!-- original-source -->\n/notes/a.md\n[[concepts/ok]]\n[[concepts/missing]]" },
    { path: "concepts/ok.md", content: "---\ntitle: OK\n---\n" + "Useful text. ".repeat(12) },
    { path: "concepts/orphan.md", content: "---\ntitle: Orphan\n---\n" + "Useful text. ".repeat(12) },
  ]
  const issues = auditWiki({ sourceDir: "/notes", expectedSources: ["a.md", "b.md"], pages })
  assert.ok(issues.some((item) => item.message.includes("Missing source page")))
  assert.ok(issues.some((item) => item.message.includes("Broken link")))
  assert.ok(issues.some((item) => item.message.includes("Orphan page")))
})
