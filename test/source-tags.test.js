import test from "node:test"
import assert from "node:assert/strict"
import { addWikiSkipTag, hasSourceTag, isWikiSkipSource } from "../src/source-tags.js"

test("match full tags in text and Obsidian properties", () => {
  for (const text of ["#git #工具", "Text #Git", "---\ntags: [git, tools]\n---\n", "---\ntags:\n  - Git\n  - tools\n---\n", "---\ntags: '#git'\n---\n"]) {
    assert.equal(hasSourceTag(text, "#git"), true, text)
  }
  for (const text of ["git", "#github", "#git-branch", "#git/work", "https://site/#git", "`#git`", "```sh\n#git checkout main\n```", "~~~\n#git\n~~~", "    #git", "<!-- #git -->", "%% #git %%", "---\ntitle: '#git'\n---\n", "---\ntags: [tools] #git\n---\n"]) {
    assert.equal(hasSourceTag(text, "git"), false, text)
  }
})

test("add a skip tag while keeping frontmatter, body, and line endings", () => {
  for (const text of ["", "# Note\nBody", "---\ntitle: Note\n---\nBody", "---\ntitle: Note\n---", "\uFEFF---\r\ntags: [git]\r\n---\r\nBody", "```\n#Wiki-Skip\n```", "    Code"]) {
    const tagged = addWikiSkipTag(text)
    assert.equal(isWikiSkipSource(tagged), true)
    assert.equal(addWikiSkipTag(tagged), tagged)
    assert.equal(tagged.replace(/#Wiki-Skip\r?\n\r?\n/, "").replace(/---\n$/, "---"), text)
  }
  for (const text of ["#Wiki-Skip\nBody", "---\ntags: [wiki-skip]\n---\nBody"]) {
    assert.equal(addWikiSkipTag(text), text)
  }
})
