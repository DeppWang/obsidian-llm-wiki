import { pathToFileURL } from "node:url"

export function addSourceReference(output, sourcePath, originalPath) {
  const url = pathToFileURL(originalPath).href
  const notice = `<!-- original-source -->\n> 本页是整理版，不是原文。[打开原始笔记](${url})\n> 原始路径：${JSON.stringify(originalPath)}\n<!-- /original-source -->`
  const lines = output.split("\n")
  const start = lines.findIndex((line) => {
    const match = line.match(/^---\s*FILE:\s*(.+?)\s*---\s*$/i)
    return match?.[1] === sourcePath
  })
  if (start < 0) throw new Error(`Missing source page: ${sourcePath}`)
  let insert = start + 1
  if (lines[insert]?.trim() === "---") {
    const end = lines.findIndex((line, index) => index > insert && line.trim() === "---")
    if (end < 0) throw new Error(`Missing frontmatter end: ${sourcePath}`)
    insert = end + 1
  }
  lines.splice(insert, 0, "", notice, "")
  return lines.join("\n")
}
