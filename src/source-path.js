import path from "node:path"
import { parseFileBlocks } from "./file-blocks.js"

export function preserveSourcePath(output, sourcePath) {
  const { blocks, warnings } = parseFileBlocks(output)
  if (warnings.length || blocks.some((block) => block.path === sourcePath)) return output
  const sourceName = path.posix.basename(sourcePath, ".md")
  const nameKey = (name) => name.normalize("NFC").toLowerCase().replace(/[\s_-]+/g, "")
  const candidates = blocks.filter((block) =>
    path.posix.dirname(block.path) === path.posix.dirname(sourcePath)
    && nameKey(path.posix.basename(block.path, ".md")) === nameKey(sourceName))
  if (candidates.length !== 1) return output
  const oldPath = candidates[0].path
  const oldName = path.posix.basename(oldPath, ".md")
  const targets = new Map([
    [oldPath, sourcePath],
    [oldPath.slice(5), sourcePath.slice(5)],
    [oldPath.slice(0, -3), sourcePath.slice(0, -3)],
    [oldPath.slice(5, -3), sourcePath.slice(5, -3)],
  ])
  // Bare links are safe only when no other returned page uses that name.
  if (!blocks.some((block) => block.path !== oldPath && path.posix.basename(block.path, ".md") === oldName)) {
    targets.set(oldName, sourceName)
    targets.set(`${oldName}.md`, `${sourceName}.md`)
  }
  let fence = null
  return output.split("\n").map((line) => {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/)
    if (marker) {
      if (!fence) fence = marker[1]
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null
      return line
    }
    if (fence) return line
    const opener = line.match(/^---\s*FILE:\s*(.+?)\s*---\s*$/i)
    if (opener?.[1].replace(/\\/g, "/") === oldPath) return `---FILE: ${sourcePath}---`
    return line.replace(/\[\[([^\]|#]+)([^\]]*)\]\]/g, (link, target, suffix) =>
      targets.has(target) ? `[[${targets.get(target)}${suffix}]]` : link)
      .replace(/\]\(([^\s)]+)([^)]*)\)/g, (link, target, suffix) => {
        let decoded
        try { decoded = decodeURIComponent(target) } catch { return link }
        const hash = decoded.indexOf("#")
        const base = hash < 0 ? decoded : decoded.slice(0, hash)
        const next = targets.get(base)
        return next ? `](${encodeURI(next)}${hash < 0 ? "" : decoded.slice(hash)}${suffix})` : link
      })
  }).join("\n")
}
