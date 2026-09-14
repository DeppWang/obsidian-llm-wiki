import path from "node:path"
import { homedir } from "node:os"
import { readdir, readFile } from "node:fs/promises"
import { pathToFileURL } from "node:url"
import { hasSourceTag, normalizeTag } from "./source-tags.js"

const STRUCTURAL_FILES = new Set(["index.md", "overview.md", "log.md", "reviews.md"])

export async function run(argv = process.argv.slice(2)) {
  const options = parseArgs(argv)
  const sourceDir = expandPath(options.sourceDir || "/Users/depp/Obsidian")
  const wikiDir = expandPath(options.wikiDir)
  const expectedSources = await loadExpectedSources(sourceDir, options.tag)
  const pages = await loadPages(wikiDir)
  const issues = auditWiki({ sourceDir, expectedSources, pages })

  console.log(`Source files: ${expectedSources.length}`)
  console.log(`Wiki pages: ${pages.length}`)
  console.log(`Issues: ${issues.length}`)
  for (const issue of issues) console.log(`[${issue.level}] ${issue.message}`)
  if (issues.some((issue) => issue.level === "error")) process.exitCode = 1
}

export function auditWiki({ sourceDir, expectedSources, pages }) {
  const issues = []
  const byPath = new Map(pages.map((page) => [page.path, page]))
  const contentPages = pages.filter((page) => !STRUCTURAL_FILES.has(page.path))
  const incoming = new Map(contentPages.map((page) => [stripMd(page.path), 0]))
  const titles = new Map()

  for (const sourceName of expectedSources) {
    const relative = `sources/${sourceName}`
    const page = byPath.get(relative)
    if (!page) {
      issues.push({ level: "error", message: `Missing source page: ${relative}` })
      continue
    }
    const original = path.join(sourceDir, sourceName)
    if (!page.content.includes("<!-- original-source -->") || !page.content.includes(original)) {
      issues.push({ level: "error", message: `Missing original note link: ${relative}` })
    }
  }

  for (const page of contentPages) {
    if (!page.content.startsWith("---\n") || !/^title:\s*.+$/m.test(page.content)) {
      issues.push({ level: "error", message: `Missing frontmatter or title: ${page.path}` })
    }
    if (page.content.replace(/^---[\s\S]*?---/, "").trim().length < 120) {
      issues.push({ level: "warning", message: `Very short page: ${page.path}` })
    }
    const title = page.content.match(/^title:\s*["']?(.+?)["']?\s*$/m)?.[1]?.toLowerCase()
    if (title) {
      const old = titles.get(title)
      if (old) issues.push({ level: "warning", message: `Duplicate title: ${old}, ${page.path}` })
      else titles.set(title, page.path)
    }
    for (const target of wikiLinks(page.content)) {
      const resolved = resolveLink(page.path, target, byPath)
      if (!resolved) issues.push({ level: "error", message: `Broken link in ${page.path}: [[${target}]]` })
      else incoming.set(stripMd(resolved), (incoming.get(stripMd(resolved)) || 0) + 1)
    }
  }

  for (const [target, count] of incoming) {
    if (count === 0 && !target.startsWith("sources/")) {
      issues.push({ level: "warning", message: `Orphan page: ${target}.md` })
    }
  }
  return issues
}

function wikiLinks(content) {
  return [...content.replace(/\\\|/g, "|").matchAll(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g)]
    .map((match) => match[1].trim())
}

function resolveLink(from, target, pages) {
  const clean = target.replace(/^wiki\//, "").replace(/\.md$/, "")
  const direct = `${clean}.md`
  if (pages.has(direct)) return direct
  if (!clean.includes("/")) {
    const matches = [...pages.keys()].filter((key) => path.posix.basename(key, ".md") === clean)
    if (matches.length === 1) return matches[0]
  }
  const relative = path.posix.normalize(path.posix.join(path.posix.dirname(from), `${clean}.md`))
  return pages.has(relative) ? relative : null
}

function stripMd(value) {
  return value.replace(/\.md$/, "")
}

async function loadExpectedSources(sourceDir, tag) {
  const names = (await readdir(sourceDir)).filter((name) => name.endsWith(".md")).sort()
  if (!tag) return names
  const matched = []
  for (const name of names) {
    if (hasSourceTag(await readFile(path.join(sourceDir, name), "utf8"), tag)) matched.push(name)
  }
  return matched
}

async function loadPages(wikiDir) {
  const pages = []
  async function visit(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name)
      if (entry.isDirectory()) await visit(absolute)
      else if (entry.name.endsWith(".md")) {
        pages.push({ path: path.relative(wikiDir, absolute).split(path.sep).join("/"), content: await readFile(absolute, "utf8") })
      }
    }
  }
  await visit(wikiDir)
  return pages
}

function parseArgs(argv) {
  const options = {}
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--source-dir") options.sourceDir = argv[++i]
    else if (argv[i] === "--tag") options.tag = normalizeTag(argv[++i])
    else if (!options.wikiDir) options.wikiDir = argv[i]
    else throw new Error(`Unknown argument: ${argv[i]}`)
  }
  if (!options.wikiDir) throw new Error("Usage: npm run audit -- <wiki-dir> [--tag git]")
  return options
}

function expandPath(value) {
  return path.resolve(value === "~" ? homedir() : value.startsWith("~/") ? path.join(homedir(), value.slice(2)) : value)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
