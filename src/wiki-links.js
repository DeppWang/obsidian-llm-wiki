import path from "node:path"

export function extractWikiLinks(markdown) {
  const links = []
  let fence = null
  let inComment = false
  for (const rawLine of markdown.replace(/\\\|/g, "|").split("\n")) {
    const marker = rawLine.match(/^\s{0,3}(`{3,}|~{3,})/)
    if (marker) {
      if (!fence) fence = marker[1]
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null
      continue
    }
    if (fence) continue
    let line = rawLine
    if (inComment) {
      const end = line.indexOf("-->")
      if (end < 0) continue
      line = line.slice(end + 3)
      inComment = false
    }
    while (line.includes("<!--")) {
      const start = line.indexOf("<!--")
      const end = line.indexOf("-->", start + 4)
      if (end < 0) {
        line = line.slice(0, start)
        inComment = true
        break
      }
      line = line.slice(0, start) + line.slice(end + 3)
    }
    line = line.replace(/(`+)[^`]*?\1/g, "")
    for (const match of line.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g)) {
      links.push(match[1].trim())
    }
  }
  return links
}

export function findBrokenWikiLinks(pagePath, markdown, knownPaths) {
  const known = new Set([...knownPaths].map(normalizePath))
  const stems = new Map()
  for (const knownPath of known) {
    const stem = path.posix.basename(knownPath, ".md")
    stems.set(stem, (stems.get(stem) || 0) + 1)
  }
  return extractWikiLinks(markdown).filter((target) => {
    const clean = normalizePath(target)
    if (known.has(clean)) return false
    if (!clean.includes("/") && stems.get(path.posix.basename(clean, ".md")) === 1) return false
    const relative = normalizePath(path.posix.join(path.posix.dirname(pagePath), clean))
    return !known.has(relative)
  })
}

function normalizePath(value) {
  return `${value.replace(/^wiki\//, "").replace(/\.md$/, "")}.md`
}
