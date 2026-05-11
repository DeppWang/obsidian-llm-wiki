import { runProcess } from "./process.js"

const DEFAULT_QMD_BIN = "qmd"

export async function searchWiki(question, options = {}) {
  const qmdBin = options.qmdBin || process.env.QMD_BIN || DEFAULT_QMD_BIN
  const args = [
    "query",
    question,
    "--json",
    "-n",
    String(options.limit || 8),
  ]

  if (options.collection) args.push("-c", options.collection)
  if (Number.isFinite(options.minScore)) args.push("--min-score", String(options.minScore))
  if (options.index) args.push("--index", options.index)

  const { stdout } = await runProcess(qmdBin, args, {
    timeoutMs: options.timeoutMs || Number.parseInt(process.env.QMD_TIMEOUT_MS || "60000", 10),
  })
  return normalizeQmdResults(JSON.parse(stdout))
}

export function hasUsefulWikiResult(results, minScore) {
  return results.some((result) => result.score >= minScore)
}

function normalizeQmdResults(payload) {
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(payload.results)
      ? payload.results
      : Array.isArray(payload.matches)
        ? payload.matches
        : []

  return rows.map((row) => {
    const path = row.path || row.file || row.filepath || row.filename || row.document?.path || ""
    return {
      docid: row.docid || row.id || row.hash || row.document?.docid || "",
      title: row.title || row.document?.title || "",
      path,
      score: numericScore(row.score ?? row.rerankScore ?? row.finalScore),
      snippet: row.snippet || row.content || row.text || row.preview || "",
      context: row.context || row.pathContext || "",
      raw: row,
    }
  })
}

function numericScore(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}
