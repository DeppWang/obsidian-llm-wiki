import path from "node:path"
import { readdir, readFile } from "node:fs/promises"
import { findBrokenWikiLinks } from "./wiki-links.js"

export async function loadRelatedPages(outputDir, text, previousPaths = [], maxChars = 60000) {
  const pages = []
  const wikiDir = path.join(outputDir, "wiki")
  async function visit(dir) {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch (error) {
      if (error.code === "ENOENT") return
      throw error
    }
    for (const entry of entries) {
      const file = path.join(dir, entry.name)
      if (entry.isDirectory()) await visit(file)
      else if (entry.isFile() && entry.name.endsWith(".md")) {
        const relative = path.relative(outputDir, file).split(path.sep).join("/")
        if (["wiki/index.md", "wiki/overview.md", "wiki/log.md", "wiki/reviews.md"].includes(relative)) continue
        const content = await readFile(file, "utf8")
        const slug = entry.name.slice(0, -3)
        const title = content.match(/^title:\s*["']?(.+?)["']?\s*$/m)?.[1]
        const score = (previousPaths.includes(relative) ? 4 : 0)
          + (text.toLowerCase().includes(slug.toLowerCase()) ? 2 : 0)
          + (title && text.includes(title) ? 1 : 0)
        if (score) pages.push({ path: relative, content, score })
      }
    }
  }
  await visit(wikiDir)
  pages.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
  const selected = []
  let used = 0
  for (const page of pages) {
    if (used + page.content.length > maxChars) continue
    selected.push(page)
    used += page.content.length
  }
  return selected
}

export async function validatePageUpdates(outputDir, blocks, relatedPages) {
  const readable = new Set(["wiki/index.md", "wiki/overview.md", "wiki/log.md", ...relatedPages.map((page) => page.path)])
  for (const block of blocks) {
    if (readable.has(block.path)) continue
    try {
      await readFile(path.join(outputDir, block.path), "utf8")
    } catch (error) {
      if (error.code === "ENOENT") continue
      throw error
    }
    throw new Error(`Cannot update a page without its old text: ${block.path}`)
  }
}

export async function validateWikiLinks(outputDir, blocks, plannedSourcePaths = []) {
  const knownPaths = new Set(plannedSourcePaths.map((value) => value.replace(/^wiki\//, "")))
  async function visit(dir) {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch (error) {
      if (error.code === "ENOENT") return
      throw error
    }
    for (const entry of entries) {
      const absolute = path.join(dir, entry.name)
      if (entry.isDirectory()) await visit(absolute)
      else if (entry.name.endsWith(".md")) knownPaths.add(path.relative(path.join(outputDir, "wiki"), absolute).split(path.sep).join("/"))
    }
  }
  await visit(path.join(outputDir, "wiki"))
  for (const block of blocks) knownPaths.add(block.path.replace(/^wiki\//, ""))
  const failures = []
  for (const block of blocks) {
    const pagePath = block.path.replace(/^wiki\//, "")
    for (const target of findBrokenWikiLinks(pagePath, block.content, knownPaths)) {
      failures.push(`${block.path}: [[${target}]]`)
    }
  }
  if (failures.length) throw new Error(`Broken wiki links:\n${failures.join("\n")}`)
}
