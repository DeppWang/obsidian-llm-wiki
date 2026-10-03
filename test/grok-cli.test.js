import test from "node:test"
import assert from "node:assert/strict"
import { buildGrokArgs, loadLlmConfigFromEnv, parseGrokResult, summarizeGrokError } from "../src/llm-client.js"
import { localCliName, localFallbackSource } from "../src/web-fallback.js"

test("grok text mode cannot edit files or search the web", () => {
  const args = buildGrokArgs({
    model: "grok-4.7",
    grokMaxTurns: 1,
    grokFallbackMaxTurns: 8,
  }, "/tmp/work", "/tmp/work/prompt.md")

  assert.equal(args[args.indexOf("--cwd") + 1], "/tmp/work")
  assert.equal(args[args.indexOf("--prompt-file") + 1], "/tmp/work/prompt.md")
  assert.equal(args[args.indexOf("--sandbox") + 1], "read-only")
  assert.equal(args[args.indexOf("--max-turns") + 1], "1")
  assert.equal(args[args.indexOf("--tools") + 1], "")
  assert.equal(args[args.indexOf("--effort") + 1], "low")
  assert.equal(args[args.indexOf("-m") + 1], "grok-4.7")
  assert.equal(args.includes("--disable-web-search"), true)
  assert.equal(args.includes("web_search,web_fetch"), false)
})

test("grok web fallback can search, but still cannot edit files", () => {
  const args = buildGrokArgs({
    model: "grok-4.6",
    grokMaxTurns: 1,
    grokFallbackMaxTurns: 8,
  }, "/tmp/work", "/tmp/work/prompt.md", { webFallback: true })

  assert.equal(args[args.indexOf("--tools") + 1], "web_search,web_fetch")
  assert.equal(args[args.indexOf("--max-turns") + 1], "8")
  assert.equal(args[args.indexOf("--sandbox") + 1], "read-only")
  assert.equal(args[args.indexOf("--effort") + 1], "low")
  assert.equal(args.includes("--disable-web-search"), false)
})

test("read the answer text from grok json", () => {
  assert.equal(parseGrokResult('{"text":"hello","stopReason":"end_turn"}\n'), "hello")
  assert.equal(parseGrokResult('log line\n{"text":"from log","stopReason":"end_turn"}\n'), "from log")
  assert.throws(() => parseGrokResult('{"type":"error","message":"model is at capacity"}'), /model is at capacity/)
  assert.throws(() => parseGrokResult('{"text":"  "}'), /empty final message/)
  assert.throws(() => parseGrokResult("not json"), /invalid JSON/)
})

test("show the grok error message without the prompt", () => {
  const stdout = JSON.stringify({ type: "error", message: "Too many requests" })
  assert.equal(summarizeGrokError("Private note\nfailed to start", stdout), "Too many requests")
  assert.equal(summarizeGrokError("hook: completed\nconnection failed"), "connection failed")
})

test("grok mode does not reuse a codex model name", () => {
  const previous = {
    LLM_WIKI_PROVIDER: process.env.LLM_WIKI_PROVIDER,
    LLM_WIKI_MODEL: process.env.LLM_WIKI_MODEL,
    GROK_MODEL: process.env.GROK_MODEL,
    GROK_EFFORT: process.env.GROK_EFFORT,
  }
  process.env.LLM_WIKI_PROVIDER = "grok"
  process.env.LLM_WIKI_MODEL = "gpt-5.6-luna"
  delete process.env.GROK_MODEL
  delete process.env.GROK_EFFORT

  try {
    assert.equal(loadLlmConfigFromEnv().model, "grok-4.7")
    assert.equal(loadLlmConfigFromEnv().provider, "grok")
    assert.equal(loadLlmConfigFromEnv().grokEffort, "low")
    process.env.LLM_WIKI_MODEL = "grok-4.6"
    assert.equal(loadLlmConfigFromEnv().model, "grok-4.6")
    process.env.GROK_MODEL = "grok-4.5"
    assert.equal(loadLlmConfigFromEnv().model, "grok-4.5")
    assert.equal(localCliName(loadLlmConfigFromEnv()), "Grok")
    assert.equal(localFallbackSource(loadLlmConfigFromEnv()), "grok-fallback")
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})
