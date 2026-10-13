import path from "node:path"
import { cp, mkdir, mkdtemp, readFile, readdir, unlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { findBrokenWikiLinks } from "./wiki-links.js"

const STRUCTURAL_NAMES = new Set(["index.md", "overview.md", "log.md", "reviews.md"])

export async function run(argv = process.argv.slice(2)) {
  const projectPath = path.resolve(argv.find((arg) => !arg.startsWith("--")) || "/Users/depp/Obsidian-Wiki")
  const result = await migrateWikiFileNames(projectPath, { dryRun: !argv.includes("--apply") })
  for (const [before, after] of result.renames) console.log(`${before} -> ${after}`)
  console.log(`Renamed files: ${result.renames.size}${result.backupDir ? `. Backup: ${result.backupDir}` : ". Preview only. Use --apply to rename."}`)
}

export function titleFileName(title) {
  const name = title.normalize("NFC").replace(/[<>:"/\\|?*\x00-\x1f]/g, " ").replace(/\s+/g, " ").trim().replace(/[. ]+$/, "")
  if (!name || name === "." || name === "..") throw new Error("Empty wiki title")
  return `${name}.md`
}

export function rewritePagePaths(markdown, pagePath, renames, knownPaths) {
  const targets = new Map()
  for (const known of knownPaths) {
    const stem = path.posix.basename(known, ".md")
    targets.set(stem, targets.has(stem) ? null : known)
  }
  const resolve = (target) => {
    const hasExtension = target.endsWith(".md")
    const clean = target.replace(/\.md$/, "") + ".md"
    const absolute = clean.startsWith("wiki/") ? clean : `wiki/${clean}`
    let original = knownPaths.has(absolute) ? absolute : path.posix.normalize(path.posix.join(path.posix.dirname(pagePath), clean))
    let bare = false
    if (!knownPaths.has(original) && !target.includes("/")) {
      original = targets.get(target.replace(/\.md$/, ""))
      bare = true
    }
    const renamed = renames.get(original)
    if (!renamed) return target
    let next = bare ? path.posix.basename(renamed) : target.startsWith("wiki/") ? renamed
      : knownPaths.has(absolute) ? renamed.slice(5) : path.posix.relative(path.posix.dirname(pagePath), renamed)
    if (target.startsWith("./") && !next.startsWith(".")) next = `./${next}`
    return hasExtension ? next : next.slice(0, -3)
  }
  let fence = null
  return markdown.split("\n").map((line) => {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/)
    if (marker) {
      if (!fence) fence = marker[1]
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null
      return line
    }
    if (fence) return line
    if (/^related:\s*\[/.test(line)) {
      return line.replace(/^(related:\s*\[)(.*)(\]\s*)$/, (_match, start, entries, end) =>
        `${start}${entries.split(",").map((entry) => {
          const value = entry.trim().replace(/^["']|["']$/g, "")
          const original = targets.get(value)
          return renames.has(original) ? ` ${JSON.stringify(path.posix.basename(renames.get(original), ".md"))}` : entry
        }).join(",")}${end}`)
    }
    if (/^(?:sources|external_sources):/.test(line)) return line
    return line.replace(/\[\[([^\]|#]+)([^\]]*)\]\]/g, (_match, target, suffix) => {
      const escape = target.endsWith("\\") && suffix.startsWith("|") ? "\\" : ""
      return `[[${resolve(escape ? target.slice(0, -1) : target)}${escape}${suffix}]]`
    })
      .replace(/\]\(([^\s)]+)([^)]*)\)/g, (link, target, suffix) => {
        let decoded
        try { decoded = decodeURIComponent(target) } catch { return link }
        if (/^[a-z][a-z\d+.-]*:/i.test(decoded) || decoded.startsWith("/")) return link
        const [base, ...fragment] = decoded.split("#")
        const next = resolve(base)
        return next === base ? link : `](${encodeURI(next)}${fragment.length ? `#${fragment.join("#")}` : ""}${suffix})`
      }).replace(/wiki\/[\p{L}\p{N}_/ .:-]+\.md/gu, (target) => renames.get(target) || target)
  }).join("\n")
}

export async function planWikiFileNames(projectPath) {
  const pages = []
  async function visit(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name)
      if (entry.isDirectory()) await visit(absolute)
      else if (entry.name.endsWith(".md")) {
        const content = await readFile(absolute, "utf8")
        pages.push({ path: path.relative(projectPath, absolute).split(path.sep).join("/"), content })
      }
    }
  }
  await visit(path.join(projectPath, "wiki"))
  const knownPaths = new Set(pages.map((page) => page.path))
  const renames = new Map()
  const reserved = new Set(knownPaths)
  for (const page of pages) {
    if (path.posix.dirname(page.path) === "wiki" && STRUCTURAL_NAMES.has(path.posix.basename(page.path))) continue
    const header = page.content.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1]
    const title = header?.match(/^title:\s*(.+?)\s*$/m)?.[1]?.replace(/^["']|["']$/g, "")
      || page.content.match(/^# (.+)$/m)?.[1]
    if (!title || !/\p{Script=Han}/u.test(title)) continue
    const next = path.posix.join(path.posix.dirname(page.path), titleFileName(title))
    if (next === page.path) continue
    if (reserved.has(next)) throw new Error(`Wiki file name is already used: ${next}`)
    reserved.add(next)
    renames.set(page.path, next)
  }
  return { pages, knownPaths, renames }
}

export async function migrateWikiFileNames(projectPath, { dryRun = false } = {}) {
  const plan = await planWikiFileNames(projectPath)
  if (dryRun || !plan.renames.size) return { renames: plan.renames }
  const nextPaths = new Set([...plan.knownPaths].map((pagePath) => plan.renames.get(pagePath) || pagePath))
  const changes = plan.pages.map((page) => ({
    ...page,
    next: plan.renames.get(page.path) || page.path,
    updated: rewritePagePaths(page.content, page.path, plan.renames, plan.knownPaths),
  }))
  for (const page of changes) {
    const before = findBrokenWikiLinks(page.path, page.content, plan.knownPaths)
    const after = findBrokenWikiLinks(page.next, page.updated, nextPaths)
    if (after.some((target) => !before.includes(target))) throw new Error(`Rename would break links in ${page.path}: ${after.join(", ")}`)
  }
  const backupDir = await mkdtemp(path.join(tmpdir(), "wiki-filenames-backup-"))
  await cp(path.join(projectPath, "wiki"), path.join(backupDir, "wiki"), { recursive: true })
  const cachePath = path.join(projectPath, ".llm-wiki/ingest-cache.json")
  let cache
  try { cache = await readFile(cachePath, "utf8") } catch (error) { if (error.code !== "ENOENT") throw error }
  let nextCache
  if (cache) {
    const rewrite = (value) => {
      if (typeof value === "string") return plan.renames.get(value) || value
      if (Array.isArray(value)) return value.map(rewrite)
      if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rewrite(item)]))
      return value
    }
    nextCache = `${JSON.stringify(rewrite(JSON.parse(cache)), null, 2)}\n`
    await writeFile(path.join(backupDir, "ingest-cache.json"), cache)
  }
  for (const page of plan.pages) {
    if (await readFile(path.join(projectPath, page.path), "utf8") !== page.content) {
      throw new Error(`Wiki changed during rename: ${page.path}. Backup: ${backupDir}`)
    }
  }
  for (const page of changes) {
    if (page.next === page.path && page.updated === page.content) continue
    await mkdir(path.dirname(path.join(projectPath, page.next)), { recursive: true })
    await writeFile(path.join(projectPath, page.next), page.updated, page.next === page.path ? {} : { flag: "wx" })
  }
  if (nextCache) await writeFile(cachePath, nextCache)
  for (const original of plan.renames.keys()) await unlink(path.join(projectPath, original))
  return { renames: plan.renames, backupDir }
}
