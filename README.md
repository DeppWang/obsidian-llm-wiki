# obsidian-llm-wiki

将 `/Users/depp/Obsidian/*.md` 逐篇交给 LLM，生成 `/Users/depp/Obsidian-Wiki-New/wiki`。

这个工具只实现 ingest：源文档 -> wiki 文件。不会实现查询、lint、搜索、图片处理或 UI。

## 使用

默认使用本机 `codex` CLI，不直接调用外部 API：

```bash
npm run ingest
```

常用参数：

```bash
npm run ingest -- --limit 3
npm run ingest -- --source-dir /Users/depp/Obsidian --output-dir /Users/depp/Obsidian-Wiki-New
npm run ingest -- --only "kafka.md"
npm run ingest -- --dry-run --limit 1
npm run ingest -- --only "kafka.md" --force
```

可选 Codex CLI 环境变量：

- `CODEX_CLI`: codex 可执行文件路径，默认 `codex`
- `CODEX_PROFILE`: 使用 `~/.codex/config.toml` 中的 profile
- `LLM_WIKI_MODEL`: 传给 `codex exec -m`，默认 `gpt-5.4-mini`
- `CODEX_OSS=1`: 传给 `codex exec --oss`
- `CODEX_LOCAL_PROVIDER=ollama|lmstudio`: 传给 `codex exec --local-provider`

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
- 输出目录：`/Users/depp/Obsidian-Wiki-New`

## 重复运行

工具会维护状态文件：

```text
/Users/depp/Obsidian-Wiki-New/.obsidian-llm-wiki/ingested.json
```

每个源文件会记录 sha256、生成时间、写入的 wiki paths 和 review 数量。默认情况下，如果源文件 hash 没变，会跳过该文件，避免重复追加 `log.md` 和 `reviews.md`。

需要强制重跑时使用：

```bash
npm run ingest -- --only "kafka.md" --force
```
