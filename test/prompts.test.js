import test from "node:test"
import assert from "node:assert/strict"
import { buildGenerationPrompt } from "../src/prompts.js"

test("source pages use wording that stays true after later ingest", () => {
  const prompt = buildGenerationPrompt({
    sourceFileName: "Git note.md",
    relatedPages: [],
  })
  assert.match(prompt, /只说明这一个源文档自身缺少什么/)
  assert.match(prompt, /不要写‘当前 Wiki 缺少’/)
  assert.match(prompt, /笔记支持不了的句子全部放进「补充背景」/)
  assert.match(prompt, /默认不超过 150 字/)
  assert.match(prompt, /external_sources/)
})
