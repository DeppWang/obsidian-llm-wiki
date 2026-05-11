# obsidian-llm-wiki

将 `/Users/depp/Obsidian/*.md` 逐篇交给 LLM，生成 `/Users/depp/Obsidian-Wiki/wiki`。

这个工具实现：

- ingest：源文档 -> wiki 文件。
- query：优先基于当前 wiki 问答；如果 wiki 没有足够答案，则联网查询，并保存问答记录。
- chat：类似 Codex 的终端交互式聊天 shell，复用 query 的 Wiki 检索和 fallback，并将一次会话保存为一个记录文件。

不会实现 lint、图片处理或 UI。

## 使用

默认使用本机 `codex` CLI，不直接调用外部 API：

```bash
npm run ingest
```

查询当前 Wiki：

```bash
npm run query -- "你的问题"
```

启动交互式聊天 shell：

```bash
npm run chat
```

查询流程：

1. 使用 `qmd query` 检索 `/Users/depp/Obsidian-Wiki/wiki` 对应的本地 QMD collection。
2. 如果最高相关度达到阈值，基于 Wiki 检索结果生成答案。
3. 如果 Wiki 没有足够信息，使用本机 Codex CLI 做 fallback 查询。
4. 将 markdown 记录和原始 JSON 写入 `/Users/depp/Obsidian-Wiki/raw/query`。

常用参数：

```bash
npm run ingest -- --limit 3
npm run ingest -- --source-dir /Users/depp/Obsidian --output-dir /Users/depp/Obsidian-Wiki
npm run ingest -- --only "kafka.md"
npm run ingest -- --dry-run --limit 1
npm run ingest -- --only "kafka.md" --force
```

查询常用参数：

```bash
npm run query -- --collection obsidian-wiki "你的问题"
npm run query -- --min-score 0.6 "你的问题"
npm run query -- --force-fallback "你的问题"
npm run query -- --no-fallback "你的问题"
npm run query -- --query-dir /Users/depp/Obsidian-Wiki/raw/query "你的问题"
```

聊天 shell 常用参数：

```bash
npm run chat -- --no-fallback
npm run chat -- --history-limit 12
npm run chat -- --min-score 0.6
```

聊天 shell 内置命令：

```text
/help
/clear
/exit
```

chat 模式会在同一次 shell 会话中持续更新同一个 markdown/json 记录；退出后再次启动会创建新的会话记录。

## QMD 设置

`query` 命令依赖本机 `qmd` CLI。首次使用前执行：

```bash
npm install -g @tobilu/qmd
brew install sqlite
qmd collection add /Users/depp/Obsidian-Wiki/wiki --name obsidian-wiki
qmd context add qmd://obsidian-wiki "Generated Obsidian markdown wiki"
qmd embed
```

Wiki 更新后，建议更新 QMD 索引：

```bash
qmd update
qmd embed
```

如果中文检索效果不理想，可使用 QMD 推荐的多语言 embedding 模型后重新 embed：

```bash
export QMD_EMBED_MODEL="hf:Qwen/Qwen3-Embedding-0.6B-GGUF/Qwen3-Embedding-0.6B-Q8_0.gguf"
qmd embed -f
```

可选 Codex CLI 环境变量：

- `CODEX_CLI`: codex 可执行文件路径，默认 `codex`
- `CODEX_PROFILE`: 使用 `~/.codex/config.toml` 中的 profile
- `LLM_WIKI_MODEL`: 传给 `codex exec -m`，默认 `gpt-5.4-mini`
- `CODEX_OSS=1`: 传给 `codex exec --oss`
- `CODEX_LOCAL_PROVIDER=ollama|lmstudio`: 传给 `codex exec --local-provider`
- `CODEX_TIMEOUT_MS`: Codex CLI 超时时间，默认 `600000`
- `QMD_BIN`: qmd 可执行文件路径，默认 `qmd`
- `QMD_TIMEOUT_MS`: qmd query 超时时间，默认 `60000`

工具会用如下方式调用 Codex：

```bash
codex --sandbox read-only -a never exec --skip-git-repo-check --ephemeral -o <tmp-file> -
```

保留的 provider（不推荐，本需求不使用）：

- `LLM_WIKI_PROVIDER=openai`
- `LLM_WIKI_PROVIDER=custom`
- `LLM_WIKI_PROVIDER=ollama`
- `LLM_WIKI_PROVIDER=anthropic`

默认输入：

- 思想说明：`/Users/depp/Obsidian/LLM Wiki.md`
- 源文件：`/Users/depp/Obsidian/*.md`
- 输出目录：`/Users/depp/Obsidian-Wiki`
- 查询记录：`/Users/depp/Obsidian-Wiki/raw/query`

## 重复运行

工具会维护状态文件：

```text
/Users/depp/Obsidian-Wiki/.llm-wiki/ingest-cache.json
```

每个源文件会记录 hash、生成时间、写入的 wiki paths 和 review 数量。默认情况下，如果源文件 hash 没变，会跳过该文件，避免重复追加 `log.md` 和 `reviews.md`。

需要强制重跑时使用：

```bash
npm run ingest -- --only "kafka.md" --force
```
