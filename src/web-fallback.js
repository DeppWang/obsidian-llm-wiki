import { chat } from "./llm-client.js"

export function localCliName(llmConfig) {
  return llmConfig?.provider === "grok" ? "Grok" : "Codex"
}

export function localFallbackSource(llmConfig) {
  return llmConfig?.provider === "grok" ? "grok-fallback" : "codex-fallback"
}

export function isLocalFallbackSource(source) {
  return source === "grok-fallback" || source === "codex-fallback"
}

export async function answerWithCodexFallback(question, llmConfig) {
  const provider = llmConfig?.provider === "grok" ? "grok" : "codex"
  const answer = await chat(
    { ...llmConfig, provider },
    [
      {
        role: "system",
        content: [
          "你是当前 Obsidian Wiki 的联网 fallback 问答助手。",
          "当前 Wiki 检索结果不足，所以需要基于你能访问的最新外部信息回答。",
          "优先使用可靠来源。回答中应说明这是 Wiki 之外的 fallback 结果。",
          "如果无法联网或无法确认最新信息，明确说明限制，不要伪造来源。",
        ].join("\n"),
      },
      {
        role: "user",
        content: `问题：${question}`,
      },
    ],
    { temperature: 0.1, max_tokens: 4096, webFallback: true },
  )

  return { answer, sources: [] }
}
