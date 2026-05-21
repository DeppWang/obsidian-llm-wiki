#!/bin/zsh
set -u

REPO_DIR="${LLM_WIKI_REPO_DIR:-$HOME/GitHub/obsidian-llm-wiki}"
LOG_DIR="${LLM_WIKI_LOG_DIR:-$HOME/Library/Logs/obsidian-llm-wiki}"
LOG_FILE="$LOG_DIR/ingest.log"
LOCK_DIR="${TMPDIR:-/tmp}/obsidian-llm-wiki-ingest.lock"

mkdir -p "$LOG_DIR"

log() {
  print -r -- "[$(date '+%Y-%m-%d %H:%M:%S %z')] $*" >> "$LOG_FILE"
}

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

if [[ -s "$HOME/.nvm/nvm.sh" ]]; then
  source "$HOME/.nvm/nvm.sh" >/dev/null 2>&1
  nvm use --silent default >/dev/null 2>&1 || true
fi

if [[ ! -d "$REPO_DIR" ]]; then
  log "repo dir not found: $REPO_DIR"
  exit 1
fi

is_ingest_running() {
  local line pid command cwd

  while IFS= read -r line; do
    line="${line#"${line%%[![:space:]]*}"}"
    pid="${line%%[[:space:]]*}"
    command="${line#"$pid"}"
    command="${command#"${command%%[![:space:]]*}"}"

    [[ "$pid" == "$$" ]] && continue
    [[ "$command" == *"npm run ingest"* ]] || continue

    cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1)"
    [[ "$cwd" == "$REPO_DIR" ]] && return 0
  done < <(ps -axo pid=,command=)

  return 1
}

if is_ingest_running; then
  log "ingest is already running, skip"
  exit 0
fi

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  log "lock exists, skip: $LOCK_DIR"
  exit 0
fi

cleanup() {
  rmdir "$LOCK_DIR" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

if is_ingest_running; then
  log "ingest started by another process, skip"
  exit 0
fi

log "start ingest"
cd "$REPO_DIR" || exit 1

npm run ingest >> "$LOG_FILE" 2>&1
status=$?

log "ingest finished with status $status"
exit "$status"
