import path from "node:path"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { parseFileBlocks } from "./file-blocks.js"
import { preserveSourcePath } from "./source-path.js"

export async function generateWikiOutput({ messages, sourcePath, requiredPaths, outputDir, dryRun = false, generate, validate }) {
  const required = requiredPaths || [sourcePath]
  let request = messages
  let debugDir
  for (let attempt = 0; attempt < 3; attempt++) {
    const generated = await generate(request)
    const output = sourcePath ? preserveSourcePath(generated, sourcePath) : generated
    const parsed = parseFileBlocks(output)
    let issue = parsed.warnings.join("; ")
    const missing = required.filter((requiredPath) => !parsed.blocks.some((block) => block.path === requiredPath))
    if (missing.length) {
      issue += `${issue ? "; " : ""}Missing required pages: ${missing.join(", ")}`
    }
    if (!issue) {
      try {
        await validate(parsed.blocks)
      } catch (error) {
        issue = error.message
      }
    }
    if (!issue) return output
    const found = parsed.blocks.map((block) => block.path).join(", ") || "none"
    const detail = `${issue}\nReturned paths: ${found}`
    if (!dryRun) {
      if (!debugDir) {
        const root = path.join(outputDir, ".llm-wiki", "failed-output")
        await mkdir(root, { recursive: true })
        debugDir = await mkdtemp(path.join(root, "generation-"))
      }
      await writeFile(path.join(debugDir, `attempt-${attempt + 1}.md`), output, "utf8")
      await writeFile(path.join(debugDir, `attempt-${attempt + 1}.txt`), detail, "utf8")
    }
    if (attempt === 2) throw new Error(`${detail}${debugDir ? `\nFailed output saved at: ${debugDir}` : ""}`)
    console.warn(`Warning: ${detail}\nRepairing wiki output (${attempt + 1}/2).${debugDir ? `\nFailed output saved at: ${debugDir}` : ""}`)
    request = [
      ...messages,
      { role: "assistant", content: output },
      { role: "user", content: `The output failed validation:\n${detail}\nReturn the full corrected set of FILE/REVIEW blocks, not a patch. Include these exact paths: ${required.join(", ")}\nKeep spaces and spelling in these paths. Fix links if a path changed. Keep valid content. Do not overwrite old pages whose text was not provided; record those updates in REVIEW blocks instead.` },
    ]
  }
}
