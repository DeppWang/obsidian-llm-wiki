import test from "node:test"
import assert from "node:assert/strict"
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { migrateWikiFileNames, planWikiFileNames, rewritePagePaths } from "../src/wiki-filenames.js"

test("rewrite links and related names while keeping code and source names", () => {
  const renames = new Map([["wiki/concepts/git-flow.md", "wiki/concepts/Git 分支操作.md"]])
  const known = new Set(["wiki/concepts/git-flow.md", "wiki/sources/note.md"])
  const text = 'related: [git-flow]\nsources: ["git-flow.md"]\n[[concepts/git-flow#步骤|操作]] [[git-flow]]\n[操作](../concepts/git-flow.md#步骤)\n- pages: wiki/concepts/git-flow.md\n[原始](file:///Users/depp/Obsidian/git-flow.md)\n```\n[[git-flow]]\n```'
  const rewritten = rewritePagePaths(text, "wiki/sources/note.md", renames, known)
  assert.match(rewritten, /related: \[ "Git 分支操作"\]/)
  assert.match(rewritten, /sources: \["git-flow.md"\]/)
  assert.ok(rewritten.includes("[[concepts/Git 分支操作#步骤|操作]] [[Git 分支操作]]"))
  assert.ok(rewritten.includes(`](../concepts/${encodeURI("Git 分支操作.md")}#步骤)`))
  assert.ok(rewritten.includes("- pages: wiki/concepts/Git 分支操作.md"))
  assert.ok(rewritten.includes("file:///Users/depp/Obsidian/git-flow.md"))
  assert.ok(rewritten.includes("```\n[[git-flow]]\n```"))
  assert.equal(rewritePagePaths("| [[concepts/git-flow\\|操作]] |", "wiki/sources/note.md", renames, known), "| [[concepts/Git 分支操作\\|操作]] |")
})

test("preview and apply names, update the cache, and keep a backup", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "wiki-rename-test-"))
  let backupDir
  try {
    await mkdir(path.join(dir, "wiki/concepts"), { recursive: true })
    await mkdir(path.join(dir, ".llm-wiki"))
    const original = '---\ntitle: "Git 分支操作"\nsources: ["git.md"]\n---\n# Git 分支操作\n'
    await writeFile(path.join(dir, "wiki/concepts/git-flow.md"), original)
    await writeFile(path.join(dir, "wiki/index.md"), "# 目录\n[[concepts/git-flow|操作]]\n")
    await writeFile(path.join(dir, ".llm-wiki/ingest-cache.json"), JSON.stringify({ files: { "git.md": { writtenPaths: ["wiki/concepts/git-flow.md"], sourcePath: "/Obsidian/git.md" } } }))
    const preview = await migrateWikiFileNames(dir, { dryRun: true })
    assert.equal(preview.renames.size, 1)
    await access(path.join(dir, "wiki/concepts/git-flow.md"))
    const result = await migrateWikiFileNames(dir)
    backupDir = result.backupDir
    assert.equal(await readFile(path.join(dir, "wiki/concepts/Git 分支操作.md"), "utf8"), original)
    assert.equal(await readFile(path.join(dir, "wiki/index.md"), "utf8"), "# 目录\n[[concepts/Git 分支操作|操作]]\n")
    await assert.rejects(access(path.join(dir, "wiki/concepts/git-flow.md")), { code: "ENOENT" })
    const cache = JSON.parse(await readFile(path.join(dir, ".llm-wiki/ingest-cache.json"), "utf8"))
    assert.deepEqual(cache.files["git.md"].writtenPaths, ["wiki/concepts/Git 分支操作.md"])
    assert.equal(cache.files["git.md"].sourcePath, "/Obsidian/git.md")
    assert.equal(await readFile(path.join(backupDir, "wiki/concepts/git-flow.md"), "utf8"), original)
    assert.equal((await migrateWikiFileNames(dir)).renames.size, 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
    if (backupDir) await rm(backupDir, { recursive: true, force: true })
  }
})

test("stop on a name clash without changing files", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "wiki-rename-clash-"))
  try {
    await mkdir(path.join(dir, "wiki/concepts"), { recursive: true })
    await writeFile(path.join(dir, "wiki/concepts/old.md"), "---\ntitle: 同名\n---\nOld")
    await writeFile(path.join(dir, "wiki/concepts/同名.md"), "Existing")
    await assert.rejects(planWikiFileNames(dir), /already used/)
    assert.equal(await readFile(path.join(dir, "wiki/concepts/同名.md"), "utf8"), "Existing")
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
