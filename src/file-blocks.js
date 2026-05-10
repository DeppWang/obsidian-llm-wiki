import path from "node:path"
import { mkdir, readFile, writeFile } from "node:fs/promises"

const OPENER_LINE = /^---\s*FILE:\s*(.+?)\s*---\s*$/i
const CLOSER_LINE = /^---\s*END\s+FILE\s*---\s*$/i
const FENCE_LINE = /^\s{0,3}(```+|~~~+)/

export function isSafeIngestPath(p) {
  if (typeof p !== "string" || p.trim().length === 0) return false
  if (/[\x00-\x1f]/.test(p)) return false
  if (p.startsWith("/") || p.startsWith("\\")) return false
  if (/^[a-zA-Z]:/.test(p)) return false
  const normalized = p.replace(/\\/g, "/")
  if (normalized.split("/").some((seg) => seg === "..")) return false
  return normalized.startsWith("wiki/") && normalized.endsWith(".md")
}

export function parseFileBlocks(text) {
  const normalized = text.replace(/\r\n/g, "\n")
  const lines = normalized.split("\n")
  const blocks = []
  const warnings = []

  let i = 0
  while (i < lines.length) {
    const openerMatch = OPENER_LINE.exec(lines[i])
    if (!openerMatch) {
      i++
      continue
    }

    const filePath = openerMatch[1].trim()
    i++

    const contentLines = []
    let fenceMarker = null
    let fenceLen = 0
    let closed = false

    while (i < lines.length) {
      const line = lines[i]
      const fenceMatch = FENCE_LINE.exec(line)

      if (fenceMatch) {
        const run = fenceMatch[1]
        const char = run[0]
        const len = run.length
        if (fenceMarker === null) {
          fenceMarker = char
          fenceLen = len
        } else if (char === fenceMarker && len >= fenceLen) {
          fenceMarker = null
          fenceLen = 0
        }
        contentLines.push(line)
        i++
        continue
      }

      if (fenceMarker === null && CLOSER_LINE.test(line)) {
        closed = true
        i++
        break
      }

      contentLines.push(line)
      i++
    }

    if (!closed) {
      warnings.push(`FILE block "${filePath || "(empty)"}" was not closed before end of stream.`)
      continue
    }
    if (!filePath) {
      warnings.push("FILE block with empty path skipped.")
      continue
    }
    if (!isSafeIngestPath(filePath)) {
      warnings.push(`FILE block with unsafe path "${filePath}" rejected.`)
      continue
    }

    blocks.push({ path: filePath.replace(/\\/g, "/"), content: sanitizeContent(contentLines.join("\n")) })
  }

  return { blocks, warnings }
}

export async function writeFileBlocks(projectPath, generation, { dryRun = false } = {}) {
  const { blocks, warnings } = parseFileBlocks(generation)
  const writtenPaths = []

  for (const block of blocks) {
    const target = path.join(projectPath, block.path)
    const normalizedTarget = path.normalize(target)
    const wikiRoot = path.join(projectPath, "wiki")

    if (!normalizedTarget.startsWith(wikiRoot + path.sep)) {
      warnings.push(`Resolved path escaped wiki root: ${block.path}`)
      continue
    }

    if (dryRun) {
      writtenPaths.push(block.path)
      continue
    }

    await mkdir(path.dirname(normalizedTarget), { recursive: true })

    if (block.path === "wiki/log.md") {
      const existing = await readOptional(normalizedTarget)
      const appended = existing ? `${existing.trimEnd()}\n\n${block.content.trim()}\n` : `${block.content.trim()}\n`
      await writeFile(normalizedTarget, appended, "utf8")
    } else {
      await writeFile(normalizedTarget, `${block.content.trim()}\n`, "utf8")
    }
    writtenPaths.push(block.path)
  }

  return { writtenPaths, warnings }
}

export async function writeReviewBlocks(projectPath, generation, sourceFileName, { dryRun = false } = {}) {
  const reviews = parseReviewBlocks(generation, sourceFileName)
  if (reviews.length === 0) return []

  const reviewPath = path.join(projectPath, "wiki/reviews.md")
  const rendered = reviews.map(renderReview).join("\n\n")

  if (!dryRun) {
    await mkdir(path.dirname(reviewPath), { recursive: true })
    const existing = await readOptional(reviewPath)
    const next = existing ? `${existing.trimEnd()}\n\n${rendered}\n` : `# Reviews\n\n${rendered}\n`
    await writeFile(reviewPath, next, "utf8")
  }

  return reviews
}

async function readOptional(filePath) {
  try {
    return await readFile(filePath, "utf8")
  } catch {
    return ""
  }
}

function sanitizeContent(raw) {
  let content = raw.trim()
  const fence = content.match(/^```(?:yaml|markdown|md)?\s*\n([\s\S]*?)\n```$/i)
  if (fence) content = fence[1].trim()
  content = content.replace(/^frontmatter:\s*\n---/i, "---")
  return content
}

function parseReviewBlocks(text, sourceFileName) {
  const regex = /---REVIEW:\s*(\w[\w-]*)\s*\|\s*(.+?)\s*---\n([\s\S]*?)---END REVIEW---/g
  const reviews = []

  for (const match of text.matchAll(regex)) {
    const type = match[1].trim()
    const title = match[2].trim()
    const body = match[3].trim()
    const options = matchLine(body, "OPTIONS")
    const pages = matchLine(body, "PAGES")
    const search = matchLine(body, "SEARCH")
    const description = body
      .replace(/^OPTIONS:.*$/m, "")
      .replace(/^PAGES:.*$/m, "")
      .replace(/^SEARCH:.*$/m, "")
      .trim()

    reviews.push({ type, title, description, options, pages, search, sourceFileName })
  }

  return reviews
}

function matchLine(body, key) {
  const match = body.match(new RegExp(`^${key}:\\s*(.+)$`, "m"))
  return match ? match[1].trim() : ""
}

function renderReview(review) {
  return [
    `## ${review.title}`,
    "",
    `- type: ${review.type}`,
    `- source: ${review.sourceFileName}`,
    review.pages ? `- pages: ${review.pages}` : "",
    review.options ? `- options: ${review.options}` : "",
    review.search ? `- search: ${review.search}` : "",
    "",
    review.description,
  ].filter(Boolean).join("\n")
}
