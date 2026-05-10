import path from "node:path"
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { chat, loadLlmConfigFromEnv } from "./llm-client.js"
import { buildAnalysisPrompt, buildGenerationPrompt } from "./prompts.js"
import { writeFileBlocks, writeReviewBlocks } from "./file-blocks.js"

const DEFAULT_SOURCE_DIR = "/Users/depp/Obsidian"
const DEFAULT_OUTPUT_DIR = "/Users/depp/Obsidian-Wiki-New"
const DEFAULT_IDEA_FILE = "/Users/depp/Obsidian/LLM Wiki.md"
const MAX_SOURCE_CHARS = 50000

export async function run() {
  const options = parseArgs(process.argv.slice(2))
  const sourceDir = options.sourceDir || DEFAULT_SOURCE_DIR
  const outputDir = options.outputDir || DEFAULT_OUTPUT_DIR
  const ideaFile = options.ideaFile || DEFAULT_IDEA_FILE
  const llmConfig = loadLlmConfigFromEnv()

  await ensureWikiScaffold(outputDir)

  const purpose = await readOptional(ideaFile)
  const files = await listSourceFiles(sourceDir, options)

  console.log(`Source dir: ${sourceDir}`)
  console.log(`Output dir: ${outputDir}`)
  console.log(`Provider: ${llmConfig.provider}, model: ${llmConfig.model}`)
  console.log(`Documents to ingest: ${files.length}`)
  if (options.dryRun) console.log("Dry run: files will not be written")

  let done = 0
  for (const filePath of files) {
    done++
    const fileName = path.basename(filePath)
    console.log(`\n[${done}/${files.length}] ${fileName}`)

    const sourceContent = await readFile(filePath, "utf8")
    const truncatedContent =
      sourceContent.length > MAX_SOURCE_CHARS
        ? `${sourceContent.slice(0, MAX_SOURCE_CHARS)}\n\n[...truncated...]`
        : sourceContent

    const index = await readOptional(path.join(outputDir, "wiki/index.md"))
    const overview = await readOptional(path.join(outputDir, "wiki/overview.md"))
    const schema = buildLocalSchema()

    console.log("Step 1/2: analyzing source")
    const analysis = await chat(
      llmConfig,
      [
        { role: "system", content: buildAnalysisPrompt({ purpose, index, sourceContent: truncatedContent }) },
        {
          role: "user",
          content: [
            "Analyze this source document:",
            "",
            `File: ${fileName}`,
            "",
            "---",
            "",
            truncatedContent,
          ].join("\n"),
        },
      ],
      { temperature: 0.1, max_tokens: 4096 },
    )

    console.log("Step 2/2: generating wiki files")
    const generation = await chat(
      llmConfig,
      [
        {
          role: "system",
          content: buildGenerationPrompt({
            purpose,
            index,
            overview,
            schema,
            sourceFileName: fileName,
            sourceContent: truncatedContent,
          }),
        },
        {
          role: "user",
          content: [
            `Source document to process: **${fileName}**`,
            "",
            "The Stage 1 analysis below is context only. Do not echo it.",
            "Your output must be FILE/REVIEW blocks and must begin with `---FILE:`.",
            "",
            "## Stage 1 Analysis",
            "",
            analysis,
            "",
            "## Original Source Content",
            "",
            truncatedContent,
            "",
            "---",
            "",
            `Now emit the FILE blocks for wiki files derived from **${fileName}**.`,
          ].join("\n"),
        },
      ],
      { temperature: 0.1, max_tokens: 8192 },
    )

    const { writtenPaths, warnings } = await writeFileBlocks(outputDir, generation, { dryRun: options.dryRun })
    const reviews = await writeReviewBlocks(outputDir, generation, fileName, { dryRun: options.dryRun })
    for (const warning of warnings) console.warn(`Warning: ${warning}`)
    console.log(`Written blocks: ${writtenPaths.length}`)
    for (const written of writtenPaths) console.log(`- ${written}`)
    if (reviews.length > 0) console.log(`Review items: ${reviews.length} -> wiki/reviews.md`)
  }
}

function parseArgs(argv) {
  const options = { dryRun: false }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === "--source-dir") options.sourceDir = requiredValue(argv, ++i, arg)
    else if (arg === "--output-dir") options.outputDir = requiredValue(argv, ++i, arg)
    else if (arg === "--idea-file") options.ideaFile = requiredValue(argv, ++i, arg)
    else if (arg === "--limit") options.limit = Number.parseInt(requiredValue(argv, ++i, arg), 10)
    else if (arg === "--start-after") options.startAfter = requiredValue(argv, ++i, arg)
    else if (arg === "--only") options.only = requiredValue(argv, ++i, arg)
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
  console.log(`Usage: npm run ingest -- [options]

Options:
  --source-dir <dir>   Source markdown directory. Default: ${DEFAULT_SOURCE_DIR}
  --output-dir <dir>   Wiki project output directory. Default: ${DEFAULT_OUTPUT_DIR}
  --idea-file <file>   LLM Wiki idea file. Default: ${DEFAULT_IDEA_FILE}
  --only <name>        Ingest only one markdown file by basename.
  --start-after <name> Skip files until after this basename.
  --limit <n>          Ingest at most n files.
  --dry-run            Call LLM and parse output, but do not write files.
`)
}

async function listSourceFiles(sourceDir, options) {
  const names = await readdir(sourceDir)
  let files = names
    .filter((name) => name.endsWith(".md"))
    .filter((name) => name !== path.basename(DEFAULT_IDEA_FILE))
    .sort((a, b) => a.localeCompare(b, "zh-Hans-CN"))

  if (options.only) files = files.filter((name) => name === options.only)
  if (options.startAfter) {
    const index = files.indexOf(options.startAfter)
    files = index >= 0 ? files.slice(index + 1) : files
  }
  if (Number.isFinite(options.limit)) files = files.slice(0, options.limit)

  return files.map((name) => path.join(sourceDir, name))
}

async function ensureWikiScaffold(outputDir) {
  const wikiDir = path.join(outputDir, "wiki")
  await mkdir(path.join(wikiDir, "sources"), { recursive: true })
  await mkdir(path.join(wikiDir, "entities"), { recursive: true })
  await mkdir(path.join(wikiDir, "concepts"), { recursive: true })
  await mkdir(path.join(wikiDir, "queries"), { recursive: true })
  await mkdir(path.join(wikiDir, "comparisons"), { recursive: true })
  await mkdir(path.join(wikiDir, "synthesis"), { recursive: true })

  await writeIfMissing(path.join(wikiDir, "index.md"), initialIndex())
  await writeIfMissing(path.join(wikiDir, "overview.md"), initialOverview())
  await writeIfMissing(path.join(wikiDir, "log.md"), "# Log\n")
  await writeIfMissing(path.join(wikiDir, "reviews.md"), "# Reviews\n")
}

async function writeIfMissing(filePath, content) {
  if (existsSync(filePath)) return
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, content, "utf8")
}

async function readOptional(filePath) {
  try {
    return await readFile(filePath, "utf8")
  } catch {
    return ""
  }
}

function initialIndex() {
  const today = new Date().toISOString().slice(0, 10)
  return `---
type: overview
title: 维基索引
created: ${today}
updated: ${today}
tags: [index]
related: []
sources: []
---

# 维基索引

## 实体

## 概念

## 来源

## 查询

## 比较

## 综合
`
}

function initialOverview() {
  const today = new Date().toISOString().slice(0, 10)
  return `---
type: overview
title: Wiki Overview
created: ${today}
updated: ${today}
tags: [overview]
related: []
sources: []
---

# Wiki Overview

这个 wiki 尚未 ingest 源文档。
`
}

function buildLocalSchema() {
  return [
    "该 wiki 是 LLM 维护的 Obsidian markdown 知识库。",
    "源文件来自 /Users/depp/Obsidian/*.md，输出到 /Users/depp/Obsidian-Wiki-New/wiki。",
    "每次只处理一个源文档；LLM 先分析，再生成 FILE blocks。",
    "目录类型必须反映页面语义：sources 是资料摘要，entities 是具体 entry，concepts 是抽象概念。",
    "entry 页面必须有具体正文、frontmatter、交叉引用和 sources 字段。",
  ].join("\n")
}
