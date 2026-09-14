import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { spawn } from "node:child_process"

const JSON_CONTENT_TYPE = "application/json"
const CODEX_KILL_GRACE_MS = 5000

export async function chat(config, messages, overrides = {}) {
  if (config.provider === "codex") return chatWithCodexCli(config, messages, overrides)

  const provider = buildProvider(config, overrides)
  const response = await fetch(provider.url, {
    method: "POST",
    headers: provider.headers,
    body: JSON.stringify(provider.body(messages)),
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => "")
    throw new Error(`LLM request failed: HTTP ${response.status} ${response.statusText}${detail ? ` - ${detail}` : ""}`)
  }

  if (!response.body) throw new Error("LLM response body is empty")

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let output = ""

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""

    for (const line of lines) {
      const token = provider.parse(line.trim())
      if (token) {
        output += token
      }
    }
  }

  if (buffer.trim()) {
    const token = provider.parse(buffer.trim())
    if (token) {
      output += token
    }
  }

  if (!output.trim()) throw new Error("LLM returned an empty response")
  return output
}

export function loadLlmConfigFromEnv() {
  const provider = process.env.LLM_WIKI_PROVIDER || "codex"
  const model = process.env.LLM_WIKI_MODEL || process.env.OPENAI_MODEL || defaultModel(provider)
  return {
    provider,
    model,
    apiKey:
      process.env.LLM_WIKI_API_KEY ||
      process.env.OPENAI_API_KEY ||
      process.env.ANTHROPIC_API_KEY ||
      "",
    endpoint: process.env.LLM_WIKI_ENDPOINT || "",
    ollamaUrl: process.env.LLM_WIKI_OLLAMA_URL || "http://localhost:11434",
    codexBin: process.env.CODEX_CLI || "codex",
    codexProfile: process.env.CODEX_PROFILE || "",
    codexOss: process.env.CODEX_OSS === "1" || process.env.CODEX_OSS === "true",
    codexLocalProvider: process.env.CODEX_LOCAL_PROVIDER || "",
    codexTimeoutMs: Number.parseInt(process.env.CODEX_TIMEOUT_MS || "600000", 10),
    codexRetries: Number.parseInt(process.env.CODEX_RETRIES || "2", 10),
  }
}

function defaultModel(provider) {
  if (provider === "codex") return "gpt-5.6-luna"
  if (provider === "anthropic") return "claude-3-5-sonnet-latest"
  if (provider === "ollama") return "llama3.1"
  return "gpt-4.1"
}

async function chatWithCodexCli(config, messages, _overrides) {
  const prompt = renderCodexPrompt(messages)
  const retryCount = Number.isFinite(config.codexRetries) && config.codexRetries > 0
    ? config.codexRetries
    : 0
  let lastError = null

  for (let attempt = 0; attempt <= retryCount; attempt++) {
    const workDir = await mkdtemp(path.join(tmpdir(), "obsidian-llm-wiki-codex-"))
    const outputFile = path.join(workDir, "last-message.md")
    const promptFile = path.join(workDir, "prompt.md")
    const stderrFile = path.join(workDir, "stderr.log")

    try {
      await writeFile(promptFile, prompt, "utf8")
      await runCodex(config.codexBin, buildCodexArgs(config, outputFile), prompt, config.codexTimeoutMs, stderrFile)
      const output = await readFile(outputFile, "utf8")
      if (!output.trim()) throw new Error("Codex CLI returned an empty final message")
      await rm(workDir, { recursive: true, force: true }).catch(() => {})
      return output
    } catch (err) {
      lastError = err
      if (attempt < retryCount && isRetryableCodexError(err)) {
        console.warn(`Warning: Codex CLI returned no usable output. Retrying ${attempt + 1}/${retryCount}...`)
        await rm(workDir, { recursive: true, force: true }).catch(() => {})
        continue
      }

      throw new Error(`${err.message}\nCodex debug files kept at: ${workDir}`)
    }
  }

  throw lastError
}

function buildCodexArgs(config, outputFile) {
  const args = [
    "--sandbox",
    "read-only",
    "-a",
    "never",
    "exec",
    "--skip-git-repo-check",
    "--ephemeral",
    "--color",
    "never",
    "-o",
    outputFile,
  ]

  if (config.model) args.push("-m", config.model)
  if (config.codexProfile) args.push("-p", config.codexProfile)
  if (config.codexOss) args.push("--oss")
  if (config.codexLocalProvider) args.push("--local-provider", config.codexLocalProvider)

  args.push("-")
  return args
}

function isRetryableCodexError(err) {
  return err?.message?.includes("empty final message") || err?.message?.includes("timed out")
}

function renderCodexPrompt(messages) {
  return [
    "You are running as the LLM backend for an automated markdown wiki ingest tool.",
    "Follow the prompts below exactly. Do not edit files or run shell commands.",
    "Return only the requested textual response.",
    "",
    ...messages.map((message) => [
      `## ${message.role.toUpperCase()} MESSAGE`,
      "",
      message.content,
      "",
    ].join("\n")),
  ].join("\n")
}

function runCodex(bin, args, stdin, timeoutMs, stderrFile) {
  return new Promise((resolve, reject) => {
    let settled = false
    const child = spawn(bin, args, {
      cwd: process.cwd(),
      stdio: ["pipe", "ignore", "pipe"],
      env: process.env,
      detached: process.platform !== "win32",
    })
    const timer = timeoutMs
      ? setTimeout(async () => {
        if (settled) return
        settled = true
        await terminateProcessTree(child)
        if (stderrFile) await writeFile(stderrFile, stderr, "utf8").catch(() => {})
        reject(new Error(`Codex CLI timed out after ${timeoutMs}ms`))
      }, timeoutMs)
      : null
    let stderr = ""

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString()
      if (stderr.length > 12000) stderr = stderr.slice(-12000)
    })
    child.on("error", (err) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      reject(err)
    })
    child.on("close", async (code, signal) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      if (stderrFile) await writeFile(stderrFile, stderr, "utf8").catch(() => {})
      if (code === 0) {
        resolve()
      } else {
        const reason = signal ? `with signal ${signal}` : `with exit code ${code}`
        reject(new Error(`Codex CLI failed ${reason}${stderr.trim() ? `:\n${stderr.trim()}` : ""}`))
      }
    })

    child.stdin.end(stdin)
  })
}

export async function terminateProcessTree(child, graceMs = CODEX_KILL_GRACE_MS) {
  if (child.exitCode !== null || child.signalCode) return

  const closed = waitForClose(child)
  signalProcessTree(child, "SIGTERM")

  if (await waitUntilClosed(closed, graceMs)) return
  signalProcessTree(child, "SIGKILL")
  await waitUntilClosed(closed, graceMs)
}

function signalProcessTree(child, signal) {
  try {
    if (process.platform === "win32") child.kill(signal)
    else process.kill(-child.pid, signal)
  } catch (err) {
    if (err?.code !== "ESRCH") throw err
  }
}

function waitForClose(child) {
  return new Promise((resolve) => child.once("close", resolve))
}

function waitUntilClosed(closed, timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs)
    closed.then(() => {
      clearTimeout(timer)
      resolve(true)
    })
  })
}

function buildProvider(config, overrides) {
  if (config.provider === "anthropic") return buildAnthropicProvider(config, overrides)
  return buildOpenAiCompatibleProvider(config, overrides)
}

function buildOpenAiCompatibleProvider(config, overrides) {
  const endpoint =
    config.provider === "openai"
      ? "https://api.openai.com/v1/chat/completions"
      : config.provider === "ollama"
        ? `${config.ollamaUrl.replace(/\/+$/, "").replace(/\/v1$/i, "")}/v1/chat/completions`
        : normalizeChatCompletionsEndpoint(config.endpoint)

  const headers = {
    "Content-Type": JSON_CONTENT_TYPE,
    ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
  }

  return {
    url: endpoint,
    headers,
    body: (messages) => ({
      model: config.model,
      messages,
      stream: true,
      temperature: overrides.temperature ?? 0.1,
      max_tokens: overrides.max_tokens ?? 4096,
      ...(isQwenThinkingModel(config.model) ? { chat_template_kwargs: { enable_thinking: false } } : {}),
      ...(isDeepSeek(config) ? { thinking: { type: "disabled" } } : {}),
    }),
    parse: parseOpenAiLine,
  }
}

function buildAnthropicProvider(config, overrides) {
  const endpoint = buildAnthropicUrl(config.endpoint || "https://api.anthropic.com")
  return {
    url: endpoint,
    headers: {
      "Content-Type": JSON_CONTENT_TYPE,
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: (messages) => {
      const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n")
      const conversation = messages
        .filter((m) => m.role !== "system")
        .map((m) => ({ role: m.role, content: m.content }))
      return {
        model: config.model,
        system,
        messages: conversation,
        stream: true,
        temperature: overrides.temperature ?? 0.1,
        max_tokens: overrides.max_tokens ?? 4096,
      }
    },
    parse: parseAnthropicLine,
  }
}

function normalizeChatCompletionsEndpoint(endpoint) {
  if (!endpoint) throw new Error("LLM_WIKI_ENDPOINT is required for custom provider")
  const base = endpoint.replace(/\/+$/, "")
  return /\/chat\/completions$/i.test(base) ? base : `${base}/chat/completions`
}

function buildAnthropicUrl(base) {
  const trimmed = base.replace(/\/+$/, "")
  if (/\/v\d+\/messages$/i.test(trimmed)) return trimmed
  if (/\/v\d+$/i.test(trimmed)) return `${trimmed}/messages`
  return `${trimmed}/v1/messages`
}

function parseOpenAiLine(line) {
  if (!line.startsWith("data: ")) return null
  const data = line.slice(6).trim()
  if (data === "[DONE]") return null
  try {
    const parsed = JSON.parse(data)
    return parsed.choices?.[0]?.delta?.content ?? null
  } catch {
    return null
  }
}

function parseAnthropicLine(line) {
  if (!line.startsWith("data: ")) return null
  try {
    const parsed = JSON.parse(line.slice(6).trim())
    if (parsed.type === "content_block_delta" && parsed.delta?.type === "text_delta") {
      return parsed.delta.text ?? null
    }
  } catch {
    return null
  }
  return null
}

function isQwenThinkingModel(model) {
  return /qwen[-_]?3/i.test(model)
}

function isDeepSeek(config) {
  return /deepseek/i.test(config.model) || /deepseek/i.test(config.endpoint)
}
