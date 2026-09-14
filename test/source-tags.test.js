import test from "node:test"
import assert from "node:assert/strict"
import { hasSourceTag } from "../src/source-tags.js"

test("match full tags in text and Obsidian properties", () => {
  for (const text of ["#git #工具", "Text #Git", "---\ntags: [git, tools]\n---\n", "---\ntags:\n  - Git\n  - tools\n---\n", "---\ntags: '#git'\n---\n"]) {
    assert.equal(hasSourceTag(text, "#git"), true, text)
  }
  for (const text of ["git", "#github", "#git-branch", "#git/work", "https://site/#git", "`#git`", "```sh\n#git checkout main\n```", "~~~\n#git\n~~~", "    #git", "<!-- #git -->", "%% #git %%", "---\ntitle: '#git'\n---\n", "---\ntags: [tools] #git\n---\n"]) {
    assert.equal(hasSourceTag(text, "git"), false, text)
  }
})
