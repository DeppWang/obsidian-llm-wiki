export const WIKI_SKIP_TAG = "wiki-skip"

export function normalizeTag(tag) {
  return tag.trim().replace(/^#/, "").toLowerCase()
}

export function isWikiSkipSource(markdown) {
  return hasSourceTag(markdown, WIKI_SKIP_TAG)
}

export function addWikiSkipTag(markdown) {
  if (isWikiSkipSource(markdown)) return markdown
  const bom = markdown.startsWith("\uFEFF") ? "\uFEFF" : ""
  const body = markdown.slice(bom.length)
  const newline = body.includes("\r\n") ? "\r\n" : "\n"
  const frontmatter = body.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/)
  if (frontmatter) {
    const header = frontmatter[0]
    const gap = header.endsWith("\n") ? "" : newline
    return `${bom}${header}${gap}#Wiki-Skip${newline}${newline}${body.slice(header.length)}`
  }
  return `${bom}#Wiki-Skip${newline}${newline}${body}`
}

export function hasSourceTag(markdown, tag) {
  const wanted = normalizeTag(tag)
  if (!wanted) return false
  let body = markdown.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n")
  const frontmatter = body.match(/^---\n([\s\S]*?)\n---(?:\n|$)/)
  if (frontmatter) {
    let inTags = false
    for (const line of frontmatter[1].split("\n")) {
      const field = line.match(/^tags:\s*(.*)$/)
      let value = ""
      if (field) {
        inTags = true
        value = field[1]
      } else if (inTags && /^\s*-\s+/.test(line)) {
        value = line.replace(/^\s*-\s+/, "")
      } else if (/^\S/.test(line)) {
        inTags = false
      }
      // Obsidian tags use a scalar, an inline list, or a block list.
      const values = value.match(/"[^"\n]*"|'[^'\n]*'|[^\s,\[\]]+/g) || []
      for (const item of values) {
        if (item.startsWith("#")) break
        if (normalizeTag(item.replace(/^["']|["']$/g, "")) === wanted) return true
      }
    }
    body = body.slice(frontmatter[0].length)
  }
  body = body.replace(/<!--[\s\S]*?-->/g, "").replace(/%%[\s\S]*?%%/g, "")
  let fence = null
  for (const line of body.split("\n")) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/)
    if (marker) {
      if (!fence) fence = marker[1]
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = null
      continue
    }
    if (fence || /^(?: {4}|\t)/.test(line)) continue
    const text = line.replace(/(`+)[\s\S]*?\1/g, "")
    for (const match of text.matchAll(/(?:^|\s)#([\p{L}\p{N}_\/-]+)/gu)) {
      if (normalizeTag(match[1]) === wanted) return true
    }
  }
  return false
}
