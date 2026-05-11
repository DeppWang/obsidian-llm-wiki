import path from "node:path"
import { chat, loadLlmConfigFromEnv } from "./llm-client.js"
import { saveQueryRecord } from "./query-records.js"
import { answerWithCodexFallback } from "./web-fallback.js"
import { hasUsefulWikiResult, searchWiki } from "./wiki-query.js"

const DEFAULT_OUTPUT_DIR = "/Users/depp/Obsidian-Wiki"
const DEFAULT_QUERY_DIR = "/Users/depp/Obsidian-Wiki/raw/query"
const DEFAULT_COLLECTION = "obsidian-wiki"
const DEFAULT_LIMIT = 8
const DEFAULT_MIN_SCORE = 0.5

export async function run(argv = process.argv.slice(2)) {
  const options = parseArgs(argv)
  const question = options.question
  if (!question) {
    printHelp()
    throw new Error("query requires a question")
  }

  const llmConfig = loadLlmConfigFromEnv()
  const outputDir = options.outputDir || DEFAULT_OUTPUT_DIR
  const queryDir = options.queryDir || path.join(outputDir, "raw/query")
  const collection = options.collection || DEFAULT_COLLECTION
  const minScore = Number.isFinite(options.minScore) ? options.minScore : DEFAULT_MIN_SCORE
  const limit = Number.isFinite(options.limit) ? options.limit : DEFAULT_LIMIT
  const createdAt = new Date().toISOString()

  console.log(`Question: ${question}`)
  console.log(`QMD collection: ${collection}`)
  console.log(`Query record dir: ${queryDir || DEFAULT_QUERY_DIR}`)

  let wikiResults = []
  let wikiError = null
  try {
    console.log("Searching Wiki with qmd...")
    wikiResults = await searchWiki(question, {
      collection,
      index: options.index,
      limit,
      minScore: options.qmdMinScore,
      qmdBin: options.qmdBin,
      timeoutMs: options.qmdTimeoutMs,
    })
    console.log(`Wiki results: ${wikiResults.length}`)
  } catch (err) {
    wikiError = err instanceof Error ? err.message : String(err)
    console.warn(`Warning: Wiki search failed: ${wikiError}`)
  }

  const useWiki = !options.forceFallback && hasUsefulWikiResult(wikiResults, minScore)
  let answerSource = "wiki"
  let answer = ""
  let fallback = null

  if (useWiki) {
    console.log("Generating answer from Wiki results...")
    answer = await answerFromWiki(question, wikiResults, llmConfig)
  } else if (!options.noFallback) {
    answerSource = "codex-fallback"
    try {
      console.log("Wiki results were insufficient; using local Codex CLI fallback...")
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
    createdAt,
    question,
    answer,
    answerSource,
    fallbackUsed: answerSource === "codex-fallback",
    wiki: {
      collection,
      minScore,
      results: wikiResults,
      error: wikiError,
    },
    fallback,
  }

  const paths = options.dryRun
    ? { markdownPath: null, jsonPath: null }
    : await saveQueryRecord(record, { queryDir: queryDir || DEFAULT_QUERY_DIR })

  console.log("")
  console.log(answer)
  if (paths.markdownPath) {
    console.log("")
    console.log(`Saved query record: ${paths.markdownPath}`)
    console.log(`Saved raw JSON: ${paths.jsonPath}`)
  }
}

async function answerFromWiki(question, wikiResults, llmConfig) {
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
          "你是当前 Obsidian Wiki 的问答助手。",
          "只基于给定 Wiki 检索结果回答，不要补充未出现在检索结果中的外部事实。",
          "如果检索结果不足以回答，明确说明 Wiki 中没有足够信息。",
          "回答末尾列出使用到的 Wiki 文件路径。",
        ].join("\n"),
      },
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
  const options = { questionParts: [] }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--output-dir") options.outputDir = requiredValue(argv, ++i, arg)
    else if (arg === "--query-dir") options.queryDir = requiredValue(argv, ++i, arg)
    else if (arg === "--collection" || arg === "-c") options.collection = requiredValue(argv, ++i, arg)
    else if (arg === "--index") options.index = requiredValue(argv, ++i, arg)
    else if (arg === "--limit" || arg === "-n") options.limit = Number.parseInt(requiredValue(argv, ++i, arg), 10)
    else if (arg === "--min-score") options.minScore = Number.parseFloat(requiredValue(argv, ++i, arg))
    else if (arg === "--qmd-min-score") options.qmdMinScore = Number.parseFloat(requiredValue(argv, ++i, arg))
    else if (arg === "--qmd-timeout-ms") options.qmdTimeoutMs = Number.parseInt(requiredValue(argv, ++i, arg), 10)
    else if (arg === "--qmd-bin") options.qmdBin = requiredValue(argv, ++i, arg)
    else if (arg === "--force-web" || arg === "--force-fallback") options.forceFallback = true
    else if (arg === "--no-web" || arg === "--no-fallback") options.noFallback = true
    else if (arg === "--dry-run") options.dryRun = true
    else if (arg === "--help" || arg === "-h") {
      printHelp()
      process.exit(0)
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown argument: ${arg}`)
    } else {
      options.questionParts.push(arg)
    }
  }

  options.question = options.questionParts.join(" ").trim()
  delete options.questionParts
  return options
}

function requiredValue(argv, index, flag) {
  const value = argv[index]
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`)
  return value
}

function printHelp() {
  console.log(`Usage: obsidian-llm-wiki query [options] <question>

Options:
  --output-dir <dir>       Wiki project output directory. Default: ${DEFAULT_OUTPUT_DIR}
  --query-dir <dir>        Query record directory. Default: <output-dir>/raw/query
  -c, --collection <name>  QMD collection name. Default: ${DEFAULT_COLLECTION}
  --index <name>           QMD named index.
  -n, --limit <n>          Number of QMD results. Default: ${DEFAULT_LIMIT}
  --min-score <n>          Score threshold for using Wiki answer. Default: ${DEFAULT_MIN_SCORE}
  --qmd-min-score <n>      Minimum score passed directly to QMD.
  --qmd-timeout-ms <n>     QMD query timeout in milliseconds. Default: 60000
  --qmd-bin <path>         QMD executable. Default: qmd
  --force-fallback         Skip Wiki answer and use local Codex CLI fallback.
  --no-fallback            Do not use local Codex CLI fallback.
  --dry-run                Print answer without saving query record.

Aliases:
  --force-web              Same as --force-fallback.
  --no-web                 Same as --no-fallback.
`)
}
