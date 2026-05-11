import path from "node:path"
import { mkdir, writeFile } from "node:fs/promises"

const DEFAULT_QUERY_DIR = "/Users/depp/Obsidian-Wiki/raw/query"

export async function saveQueryRecord(record, options = {}) {
  const queryDir = options.queryDir || DEFAULT_QUERY_DIR
  const timestamp = record.createdAt || new Date().toISOString()
  const baseName = `${safeTimestamp(timestamp)}-${slugify(record.question || "query")}`
  const markdownPath = path.join(queryDir, `${baseName}.md`)
  const jsonPath = path.join(queryDir, `${baseName}.json`)

  await mkdir(queryDir, { recursive: true })
  await writeFile(markdownPath, renderMarkdownRecord(record), "utf8")
  await writeFile(jsonPath, `${JSON.stringify(record, null, 2)}\n`, "utf8")

  return { markdownPath, jsonPath }
}

function renderMarkdownRecord(record) {
  return [
    "---",
    "type: query-record",
    `created: ${record.createdAt}`,
    `question: ${JSON.stringify(record.question)}`,
    `answer_source: ${record.answerSource}`,
    `fallback_used: ${record.fallbackUsed}`,
    `wiki_collection: ${record.wiki?.collection || ""}`,
    "---",
    "",
    "# Question",
    "",
    record.question,
    "",
    "# Answer",
    "",
    record.answer || "",
    "",
    "# Wiki Results",
    "",
    renderWikiResults(record.wiki?.results || []),
    "",
    "# Fallback Sources",
    "",
    renderFallbackSources(record.fallback?.sources || []),
    "",
  ].join("\n")
}

function renderWikiResults(results) {
  if (!results.length) return "None"
  return results
    .map((result) => [
      `- path: ${result.path || ""}`,
      `  score: ${result.score}`,
      result.title ? `  title: ${result.title}` : "",
      result.docid ? `  docid: ${result.docid}` : "",
    ].filter(Boolean).join("\n"))
    .join("\n")
}

function renderFallbackSources(sources) {
  if (!sources.length) return "None"
  return sources.map((source) => `- ${source.title ? `${source.title}: ` : ""}${source.url}`).join("\n")
}

function safeTimestamp(timestamp) {
  return timestamp.replace(/[:.]/g, "-")
}

function slugify(text) {
  const slug = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)

  return slug || "query"
}
