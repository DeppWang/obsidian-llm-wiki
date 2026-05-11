import readline from "node:readline/promises"
import { stdin as input, stdout as output } from "node:process"
import { chat, loadLlmConfigFromEnv } from "./llm-client.js"
import { saveChatRecord } from "./query-records.js"
import { answerWithCodexFallback } from "./web-fallback.js"
import { hasUsefulWikiResult, searchWiki } from "./wiki-query.js"

const DEFAULT_COLLECTION = "obsidian-wiki"
const DEFAULT_LIMIT = 8
const DEFAULT_MIN_SCORE = 0.5
const DEFAULT_HISTORY_LIMIT = 8

export async function run(argv = process.argv.slice(2)) {
  const options = parseArgs(argv)
  const llmConfig = loadLlmConfigFromEnv()
  const history = []
  const session = {
    type: "chat-record",
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    title: "",
    turns: [],
  }
  let sessionPaths = null
  const rl = readline.createInterface({ input, output })

  console.log("llm-wiki chat")
  console.log("Type /exit to quit, /clear to reset history, /help for commands.")

  try {
    rl.setPrompt("\nyou> ")
    rl.prompt()
    for await (const rawQuestion of rl) {
      const question = rawQuestion.trim()
      if (!question) {
        rl.prompt()
        continue
      }
      if (question === "/exit" || question === "/quit") break
      if (question === "/help") {
        printShellHelp()
        rl.prompt()
        continue
      }
      if (question === "/clear") {
        history.length = 0
        console.log("history cleared")
        rl.prompt()
        continue
      }

      const result = await answerQuestion(question, history, llmConfig, options)
      console.log(`\nassistant> ${result.answer}`)

      history.push({ role: "user", content: question })
      history.push({ role: "assistant", content: result.answer })
      while (history.length > options.historyLimit) history.shift()

      if (!options.dryRun) {
        if (!session.title) session.title = question
        session.updatedAt = new Date().toISOString()
        session.turns.push(result.record)
        sessionPaths = await saveChatRecord(session, {
          queryDir: options.queryDir,
        })
        session.baseName = sessionPaths.baseName
        console.log(`\nrecord> ${sessionPaths.markdownPath}`)
      }
      rl.prompt()
    }
  } finally {
    rl.close()
  }
}

async function answerQuestion(question, history, llmConfig, options) {
  let wikiResults = []
  let wikiError = null

  try {
    console.log("searching wiki...")
    wikiResults = await searchWiki(question, {
      collection: options.collection,
      index: options.index,
      limit: options.limit,
      minScore: options.qmdMinScore,
      qmdBin: options.qmdBin,
      timeoutMs: options.qmdTimeoutMs,
    })
    console.log(`wiki results: ${wikiResults.length}`)
  } catch (err) {
    wikiError = err instanceof Error ? err.message : String(err)
    console.warn(`wiki search failed: ${wikiError}`)
  }

  let answerSource = "wiki"
  let answer = ""
  let fallback = null

  if (!options.forceFallback && hasUsefulWikiResult(wikiResults, options.minScore)) {
    console.log("answering from wiki...")
    answer = await answerFromWiki(question, wikiResults, history, llmConfig)
    if (!options.noFallback && isWikiInsufficientAnswer(answer)) {
      answerSource = "codex-fallback"
      try {
        console.log("wiki answer says information is insufficient; using local Codex CLI fallback...")
        fallback = await answerWithCodexFallback(question, llmConfig)
        answer = fallback.answer
      } catch (err) {
        const fallbackError = err instanceof Error ? err.message : String(err)
        answerSource = "none"
        fallback = { error: fallbackError }
        answer = [
          "当前 Wiki 中没有找到足够可信的答案。",
          wikiError ? `Wiki 检索错误：${wikiError}` : "",
          `Codex fallback 查询失败：${fallbackError}`,
        ].filter(Boolean).join("\n")
      }
    }
  } else if (!options.noFallback) {
    answerSource = "codex-fallback"
    try {
      console.log("wiki insufficient; using local Codex CLI fallback...")
      fallback = await answerWithCodexFallback(question, llmConfig)
      answer = fallback.answer
    } catch (err) {
      const fallbackError = err instanceof Error ? err.message : String(err)
      answerSource = "none"
      fallback = { error: fallbackError }
      answer = [
        "当前 Wiki 中没有找到足够可信的答案。",
        wikiError ? `Wiki 检索错误：${wikiError}` : "",
        `Codex fallback 查询失败：${fallbackError}`,
      ].filter(Boolean).join("\n")
    }
  } else {
    answerSource = "none"
    answer = [
      "当前 Wiki 中没有找到足够可信的答案。",
      wikiError ? `Wiki 检索错误：${wikiError}` : "",
      "已禁用 Codex fallback，因此没有继续查询。",
    ].filter(Boolean).join("\n")
  }

  const record = {
    type: "query-record",
    createdAt: new Date().toISOString(),
    question,
    answer,
    answerSource,
    fallbackUsed: answerSource === "codex-fallback",
    wiki: {
      collection: options.collection,
      minScore: options.minScore,
      results: wikiResults,
      error: wikiError,
    },
    fallback,
  }

  return { answer, record }
}

function isWikiInsufficientAnswer(answer) {
  const normalized = answer.toLowerCase()
  return [
    "没有足够信息",
    "没有足够的资料",
    "没有找到足够",
    "不能从这个 wiki",
    "不能只靠这份 wiki",
    "wiki 中没有",
    "wiki 里没有",
    "insufficient information",
    "not enough information",
  ].some((phrase) => normalized.includes(phrase.toLowerCase()))
}

async function answerFromWiki(question, wikiResults, history, llmConfig) {
  const compactResults = wikiResults.map((result, index) => ({
    rank: index + 1,
    path: result.path,
    title: result.title,
    score: result.score,
    snippet: result.snippet,
    context: result.context,
  }))

  return chat(
    llmConfig,
    [
      {
        role: "system",
        content: [
          "你是当前 Obsidian Wiki 的终端聊天助手。",
          "只基于给定 Wiki 检索结果回答，不要补充未出现在检索结果中的外部事实。",
          "可以参考当前会话历史理解上下文。",
          "如果检索结果不足以回答，明确说明 Wiki 中没有足够信息。",
          "回答末尾列出使用到的 Wiki 文件路径。",
        ].join("\n"),
      },
      ...history,
      {
        role: "user",
        content: [
          `问题：${question}`,
          "",
          "Wiki 检索结果 JSON：",
          JSON.stringify(compactResults, null, 2),
        ].join("\n"),
      },
    ],
    { temperature: 0.1, max_tokens: 4096 },
  )
}

function parseArgs(argv) {
  const options = {
    collection: DEFAULT_COLLECTION,
    limit: DEFAULT_LIMIT,
    minScore: DEFAULT_MIN_SCORE,
    historyLimit: DEFAULT_HISTORY_LIMIT,
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--query-dir") options.queryDir = requiredValue(argv, ++i, arg)
    else if (arg === "--collection" || arg === "-c") options.collection = requiredValue(argv, ++i, arg)
    else if (arg === "--index") options.index = requiredValue(argv, ++i, arg)
    else if (arg === "--limit" || arg === "-n") options.limit = Number.parseInt(requiredValue(argv, ++i, arg), 10)
    else if (arg === "--min-score") options.minScore = Number.parseFloat(requiredValue(argv, ++i, arg))
    else if (arg === "--qmd-min-score") options.qmdMinScore = Number.parseFloat(requiredValue(argv, ++i, arg))
    else if (arg === "--qmd-timeout-ms") options.qmdTimeoutMs = Number.parseInt(requiredValue(argv, ++i, arg), 10)
    else if (arg === "--qmd-bin") options.qmdBin = requiredValue(argv, ++i, arg)
    else if (arg === "--history-limit") options.historyLimit = Number.parseInt(requiredValue(argv, ++i, arg), 10)
    else if (arg === "--force-fallback") options.forceFallback = true
    else if (arg === "--no-fallback") options.noFallback = true
    else if (arg === "--dry-run") options.dryRun = true
    else if (arg === "--help" || arg === "-h") {
      printHelp()
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return options
}

function requiredValue(argv, index, flag) {
  const value = argv[index]
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`)
  return value
}

function printHelp() {
  console.log(`Usage: obsidian-llm-wiki chat [options]

Options:
  --query-dir <dir>        Query record directory. Default: /Users/depp/Obsidian-Wiki/raw/query
  -c, --collection <name>  QMD collection name. Default: ${DEFAULT_COLLECTION}
  --index <name>           QMD named index.
  -n, --limit <n>          Number of QMD results. Default: ${DEFAULT_LIMIT}
  --min-score <n>          Score threshold for using Wiki answer. Default: ${DEFAULT_MIN_SCORE}
  --qmd-min-score <n>      Minimum score passed directly to QMD.
  --qmd-timeout-ms <n>     QMD query timeout in milliseconds. Default: 60000
  --qmd-bin <path>         QMD executable. Default: qmd
  --history-limit <n>      Number of recent chat messages kept in memory. Default: ${DEFAULT_HISTORY_LIMIT}
  --force-fallback         Skip Wiki answer and use local Codex CLI fallback.
  --no-fallback            Do not use local Codex CLI fallback.
  --dry-run                Print answers without saving query records.
`)
}

function printShellHelp() {
  console.log([
    "Commands:",
    "  /help   Show commands",
    "  /clear  Clear in-memory chat history",
    "  /exit   Quit",
  ].join("\n"))
}
