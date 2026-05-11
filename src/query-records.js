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

export async function saveChatRecord(session, options = {}) {
  const queryDir = options.queryDir || DEFAULT_QUERY_DIR
  const timestamp = session.startedAt || new Date().toISOString()
  const title = session.title || session.turns?.[0]?.question || "chat"
  const baseName = session.baseName || `${safeTimestamp(timestamp)}-${slugify(title)}`
  const markdownPath = path.join(queryDir, `${baseName}.md`)
  const jsonPath = path.join(queryDir, `${baseName}.json`)

  await mkdir(queryDir, { recursive: true })
  await writeFile(markdownPath, renderChatMarkdown({ ...session, baseName }), "utf8")
  await writeFile(jsonPath, `${JSON.stringify({ ...session, baseName }, null, 2)}\n`, "utf8")

  return { markdownPath, jsonPath, baseName }
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

function renderChatMarkdown(session) {
  const turns = Array.isArray(session.turns) ? session.turns : []
  return [
    "---",
    "type: chat-record",
    `started: ${session.startedAt}`,
    `updated: ${session.updatedAt}`,
    `turns: ${turns.length}`,
    "---",
    "",
    "# Chat",
    "",
    ...turns.flatMap((turn, index) => [
      `## Turn ${index + 1}`,
      "",
      "### User",
      "",
      turn.question,
      "",
      "### Assistant",
      "",
      turn.answer || "",
      "",
      "### Metadata",
      "",
      `- answer_source: ${turn.answerSource}`,
      `- fallback_used: ${turn.fallbackUsed}`,
      `- wiki_results: ${turn.wiki?.results?.length || 0}`,
      "",
    ]),
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
