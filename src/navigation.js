import path from "node:path"
import { readdir, readFile } from "node:fs/promises"
import { extractWikiLinks } from "./wiki-links.js"

const STRUCTURAL_PATHS = new Set([
  "wiki/index.md",
  "wiki/overview.md",
  "wiki/log.md",
  "wiki/reviews.md",
])

export async function loadNavigationCatalog(outputDir) {
  const pages = []

  async function visit(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name)
      if (entry.isDirectory()) await visit(absolute)
      else if (entry.name.endsWith(".md")) {
        const pagePath = path.relative(outputDir, absolute).split(path.sep).join("/")
        if (STRUCTURAL_PATHS.has(pagePath)) continue
        const content = await readFile(absolute, "utf8")
        pages.push({
          path: pagePath,
          type: frontmatterValue(content, "type") || path.posix.dirname(pagePath).replace("wiki/", ""),
          title: frontmatterValue(content, "title") || path.basename(pagePath, ".md"),
          summary: firstParagraph(content),
        })
      }
    }
  }

  await visit(path.join(outputDir, "wiki"))
  return pages.sort((a, b) => a.path.localeCompare(b.path, "zh-Hans-CN"))
}

export function validateNavigationBlocks(blocks, catalog) {
  const expectedPaths = new Set(["wiki/index.md", "wiki/overview.md"])
  const returnedPaths = new Set(blocks.map((block) => block.path))
  const extra = [...returnedPaths].filter((pagePath) => !expectedPaths.has(pagePath))
  if (extra.length) throw new Error(`Navigation pass returned extra pages: ${extra.join(", ")}`)

  const index = blocks.find((block) => block.path === "wiki/index.md")
  const overview = blocks.find((block) => block.path === "wiki/overview.md")
  if (!index || !overview) return

  const counts = new Map()
  for (const target of extractWikiLinks(index.content)) {
    const normalized = normalizeTarget(target)
    counts.set(normalized, (counts.get(normalized) || 0) + 1)
  }
  const missing = catalog.map((page) => stripWikiAndMd(page.path)).filter((pagePath) => !counts.has(pagePath))
  const repeated = [...counts].filter(([, count]) => count > 1).map(([pagePath]) => pagePath)
  if (missing.length) throw new Error(`Index is missing pages: ${missing.join(", ")}`)
  if (repeated.length) throw new Error(`Index lists pages more than once: ${repeated.join(", ")}`)

  const overviewLines = overview.content.split("\n").length
  if (overviewLines > 80) throw new Error(`Overview is too long: ${overviewLines} lines, maximum is 80`)
  const overviewTargets = extractWikiLinks(overview.content).map(normalizeTarget)
  const duplicateOverviewTargets = overviewTargets.filter((target, index) => overviewTargets.indexOf(target) !== index)
  if (duplicateOverviewTargets.length) {
    throw new Error(`Overview repeats links: ${[...new Set(duplicateOverviewTargets)].join(", ")}`)
  }
}

function frontmatterValue(content, key) {
  return content.match(new RegExp(`^${key}:\\s*["']?(.+?)["']?\\s*$`, "m"))?.[1]?.trim()
}

function firstParagraph(content) {
  const body = content.replace(/^---[\s\S]*?---\s*/, "").replace(/^# .+\n+/, "")
  return body.split(/\n\s*\n/).find((part) => part.trim() && !part.trim().startsWith("<!--"))?.replace(/\s+/g, " ").trim().slice(0, 220) || ""
}

function normalizeTarget(target) {
  return stripWikiAndMd(target.replace(/^\.\//, ""))
}

function stripWikiAndMd(value) {
  return value.replace(/^wiki\//, "").replace(/\.md$/, "")
}
