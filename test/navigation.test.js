import test from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { buildNavigationPrompt } from "../src/prompts.js"
import { loadNavigationCatalog, validateNavigationBlocks } from "../src/navigation.js"

const frontmatter = (type, title) => `---\ntype: ${type}\ntitle: ${title}\n---\n\n# ${title}\n\nUseful first paragraph.\n\n## More\nText`

test("load content pages for the final navigation pass", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "wiki-navigation-test-"))
  try {
    await mkdir(path.join(root, "wiki/concepts"), { recursive: true })
    await writeFile(path.join(root, "wiki/concepts/git.md"), frontmatter("concept", "Git"))
    await writeFile(path.join(root, "wiki/index.md"), "# Index")
    const catalog = await loadNavigationCatalog(root)
    assert.deepEqual(catalog, [{
      path: "wiki/concepts/git.md",
      type: "concept",
      title: "Git",
      sources: "[]",
      summary: "Useful first paragraph.",
    }])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("navigation prompt asks for a short overview and complete index", () => {
  const prompt = buildNavigationPrompt({
    purpose: "Keep it useful",
    schema: "Rules",
    index: "Old index",
    overview: "Old overview",
    reviews: "# Reviews",
    catalog: [{ path: "wiki/concepts/git.md", type: "concept", title: "Git", sources: "[]", summary: "Version control" }],
  })
  assert.match(prompt, /最多 80 行/)
  assert.match(prompt, /每一页都必须链接一次/)
  assert.match(prompt, /wiki\/concepts\/git\.md/)
})

test("navigation validation rejects missing, repeated, long, and extra output", () => {
  const catalog = [{ path: "wiki/concepts/git.md" }]
  const valid = [
    { path: "wiki/index.md", content: "[[concepts/git|Git]]" },
    { path: "wiki/overview.md", content: "[[concepts/git|Git]]" },
  ]
  assert.doesNotThrow(() => validateNavigationBlocks(valid, catalog))
  assert.throws(() => validateNavigationBlocks([
    { path: "wiki/index.md", content: "No link" },
    valid[1],
  ], catalog), /missing pages/)
  assert.throws(() => validateNavigationBlocks([
    { path: "wiki/index.md", content: "[[concepts/git]] [[concepts/git]]" },
    valid[1],
  ], catalog), /more than once/)
  assert.throws(() => validateNavigationBlocks([
    valid[0],
    { path: "wiki/overview.md", content: Array(81).fill("line").join("\n") },
  ], catalog), /too long/)
  assert.throws(() => validateNavigationBlocks([...valid, { path: "wiki/concepts/new.md", content: "New" }], catalog), /extra pages/)
})
