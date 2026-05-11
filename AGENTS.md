# Repository Guidelines

## Project Structure & Module Organization

This repository is a private Node.js ESM CLI for building and querying an Obsidian-style LLM wiki.

- `bin/obsidian-llm-wiki.js`: executable entry point and command dispatcher.
- `src/cli.js`: ingest command; reads markdown sources and writes generated wiki files.
- `src/query-cli.js`: query command; searches the local QMD index and falls back to local Codex CLI.
- `src/llm-client.js`: shared LLM/Codex client logic.
- `src/file-blocks.js`, `src/prompts.js`: ingest parsing and prompt construction.
- `src/wiki-query.js`, `src/query-records.js`, `src/web-fallback.js`, `src/process.js`: query support modules.
- No test directory exists yet. Add tests under `test/` or `src/*.test.js` if a test runner is introduced.

Default runtime data lives outside this repo: `/Users/depp/Obsidian`, `/Users/depp/Obsidian-Wiki/wiki`, and `/Users/depp/Obsidian-Wiki/raw/query`.

## Build, Test, and Development Commands

- `npm run ingest`: run the default ingest flow.
- `npm run ingest -- --limit 3`: ingest a small batch for manual verification.
- `npm run ingest -- --only "file.md" --force`: reprocess one source file.
- `npm run query -- "问题"`: answer from the current Wiki, falling back to local Codex CLI.
- `npm run query -- --no-fallback "问题"`: test QMD-only behavior.
- `npm run check`: run Node syntax checks for the CLI and all source files.

Requires Node.js `>=22`. Query mode also expects `qmd` to be installed and indexed.

## Coding Style & Naming Conventions

Use modern ESM JavaScript with explicit imports. Keep modules small and command-specific. Prefer `camelCase` for functions and variables, `UPPER_SNAKE_CASE` for constants, and descriptive file names such as `query-records.js`. Follow the existing two-space indentation style and omit semicolons. Keep comments rare and only for non-obvious behavior.

## Testing Guidelines

There is no formal test framework or coverage gate yet. Before submitting changes, always run:

```bash
npm run check
```

For behavior changes, include a manual smoke test in the PR description, for example `npm run query -- --no-fallback --dry-run "张安疆是谁"` or a limited ingest command.

## Commit & Pull Request Guidelines

Current history uses short imperative summaries, for example `use gpt-5.4-mini` and `update log`. Keep commits focused and concise. Pull requests should include the motivation, changed commands or environment variables, manual verification steps, and any known runtime prerequisites such as `qmd`, SQLite, or Codex CLI configuration.

## Security & Configuration Tips

Do not commit generated wiki output, query records, API keys, local `.env` files, or machine-specific cache data. Prefer environment variables for runtime configuration: `CODEX_CLI`, `LLM_WIKI_MODEL`, `QMD_BIN`, `QMD_TIMEOUT_MS`, and `CODEX_TIMEOUT_MS`.

## User Preferences

### Grammar Check with Confirmation

For every English message I send:
1. Check grammar and word correctness
2. Guess what I actually mean (not just fix grammar)
3. Print the corrected version
4. **WAIT for me to confirm** the meaning is right
5. Only after confirmation, execute the prompt

If my meaning is wrong, ask me to explain again.

### Simple Language

Use simple words and grammar in ALL output: replies, code comments, commit messages, spec documents, error messages — everything.

Use short words, short sentences, easy grammar. No fancy vocabulary. Write like talking to a friend.
