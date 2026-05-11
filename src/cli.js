import path from "node:path"
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { createHash } from "node:crypto"
import { chat, loadLlmConfigFromEnv } from "./llm-client.js"
import { buildAnalysisPrompt, buildGenerationPrompt } from "./prompts.js"
import { writeFileBlocks, writeReviewBlocks } from "./file-blocks.js"

const DEFAULT_SOURCE_DIR = "/Users/depp/Obsidian"
const DEFAULT_OUTPUT_DIR = "/Users/depp/Obsidian-Wiki"
const DEFAULT_IDEA_FILE = "/Users/depp/Obsidian/LLM Wiki.md"
const MAX_SOURCE_CHARS = 50000
const CACHE_DIR = ".llm-wiki"
const CACHE_FILE = "ingest-cache.json"

export async function run() {
  const options = parseArgs(process.argv.slice(2))
  const sourceDir = options.sourceDir || DEFAULT_SOURCE_DIR
  const outputDir = options.outputDir || DEFAULT_OUTPUT_DIR
  const ideaFile = options.ideaFile || DEFAULT_IDEA_FILE
  const llmConfig = loadLlmConfigFromEnv()

  await ensureWikiScaffold(outputDir)

  const purpose = await readOptional(ideaFile)
  const files = await listSourceFiles(sourceDir, options)
  const manifest = await loadManifest(outputDir)
  const startedAt = Date.now()

  console.log(`Source dir: ${sourceDir}`)
  console.log(`Output dir: ${outputDir}`)
  console.log(`Provider: ${llmConfig.provider}, model: ${llmConfig.model}`)
  console.log(`Total files: ${files.length}`)
  if (options.dryRun) console.log("Dry run: files will not be written")

  let done = 0
  let skipped = 0
  let ingested = 0
  for (const filePath of files) {
    done++
    const fileName = path.basename(filePath)
    logProgress({
      fileName,
      current: done,
      total: files.length,
      status: "start",
      startedAt,
    })

    const sourceContent = await readFile(filePath, "utf8")
    const sourceHash = sha256(sourceContent)
    const existingRecord = getManifestRecord(manifest, fileName)
    if (!options.force && existingRecord?.sha256 === sourceHash) {
      skipped++
      logProgress({
        fileName,
        current: done,
        total: files.length,
        status: "skipped",
        startedAt,
      })
      continue
    }

    const truncatedContent =
      sourceContent.length > MAX_SOURCE_CHARS
        ? `${sourceContent.slice(0, MAX_SOURCE_CHARS)}\n\n[...truncated...]`
        : sourceContent

    const index = await readOptional(path.join(outputDir, "wiki/index.md"))
    const overview = await readOptional(path.join(outputDir, "wiki/overview.md"))
    const schema = buildLocalSchema()

    logProgress({
      fileName,
      current: done,
      total: files.length,
      status: "analysis",
      startedAt,
    })
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

    logProgress({
      fileName,
      current: done,
      total: files.length,
      status: "generation",
      startedAt,
    })
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
    ingested++
    logProgress({
      fileName,
      current: done,
      total: files.length,
      status: "done",
      startedAt,
      detail: `written=${writtenPaths.length}, reviews=${reviews.length}`,
    })

    if (!options.dryRun) {
      updateManifestRecord(manifest, fileName, {
        sourcePath: filePath,
        sha256: sourceHash,
        contentLength: sourceContent.length,
        ingestedAt: new Date().toISOString(),
        writtenPaths,
        reviewCount: reviews.length,
      })
      await saveManifest(outputDir, manifest)
    }
  }

  console.log(`Finished: total=${files.length}, ingested=${ingested}, skipped=${skipped}, elapsed=${formatDuration(Date.now() - startedAt)}`)
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
    else if (arg === "--force") options.force = true
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
  --force              Re-ingest even when the source hash is unchanged.
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
  await mkdir(path.join(outputDir, CACHE_DIR), { recursive: true })
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
    "源文件来自 /Users/depp/Obsidian/*.md，输出到 /Users/depp/Obsidian-Wiki/wiki。",
    "每次只处理一个源文档；LLM 先分析，再生成 FILE blocks。",
    "目录类型必须反映页面语义：sources 是资料摘要，entities 是具体 entry，concepts 是抽象概念。",
    "entry 页面必须有具体正文、frontmatter、交叉引用和 sources 字段。",
  ].join("\n")
}

async function loadManifest(outputDir) {
  const manifest = { version: 1, files: {}, entries: {} }
  const current = await readJson(getManifestPath(outputDir))
  if (current) mergeManifest(manifest, current)

  return manifest
}

async function readJson(filePath) {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8"))
    return parsed && typeof parsed === "object" ? parsed : null
  } catch {
    return null
  }
}

function mergeManifest(manifest, parsed) {
  if (parsed.files && typeof parsed.files === "object") {
    manifest.files = { ...manifest.files, ...parsed.files }
  }
  if (parsed.entries && typeof parsed.entries === "object") {
    manifest.entries = { ...manifest.entries, ...parsed.entries }
  }
}

function getManifestRecord(manifest, fileName) {
  const fileRecord = manifest.files[fileName]
  if (fileRecord?.sha256) return fileRecord

  const entry = manifest.entries[fileName]
  if (!entry?.hash) return null
  return {
    sourcePath: entry.sourcePath,
    sha256: entry.hash,
    contentLength: entry.contentLength,
    ingestedAt: entry.ingestedAt || (entry.timestamp ? new Date(entry.timestamp).toISOString() : undefined),
    writtenPaths: entry.filesWritten,
    reviewCount: entry.reviewCount,
  }
}

function updateManifestRecord(manifest, fileName, record) {
  manifest.files[fileName] = record
  manifest.entries[fileName] = {
    hash: record.sha256,
    timestamp: Date.parse(record.ingestedAt),
    filesWritten: record.writtenPaths,
    sourcePath: record.sourcePath,
    contentLength: record.contentLength,
    reviewCount: record.reviewCount,
  }
}

async function saveManifest(outputDir, manifest) {
  const manifestPath = getManifestPath(outputDir)
  await mkdir(path.dirname(manifestPath), { recursive: true })
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8")
}

function getManifestPath(outputDir) {
  return path.join(outputDir, CACHE_DIR, CACHE_FILE)
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex")
}

function logProgress({ fileName, current, total, status, startedAt, detail = "" }) {
  const remaining = Math.max(total - current, 0)
  const elapsed = formatDuration(Date.now() - startedAt)
  const suffix = detail ? `, ${detail}` : ""
  console.log(`[${current}/${total}] ${status}: ${fileName} | remaining=${remaining}, elapsed=${elapsed}${suffix}`)
}

function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}
