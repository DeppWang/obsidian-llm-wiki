#!/bin/zsh
set -eu

REPO_DIR="${LLM_WIKI_REPO_DIR:-$HOME/GitHub/obsidian-llm-wiki}"
LABEL="com.depp.obsidian-llm-wiki.ingest"
SOURCE_PLIST="$REPO_DIR/launchd/$LABEL.plist"
TARGET_DIR="$HOME/Library/LaunchAgents"
TARGET_PLIST="$TARGET_DIR/$LABEL.plist"

if [[ ! -f "$SOURCE_PLIST" ]]; then
  print -u2 "plist not found: $SOURCE_PLIST"
  exit 1
fi

mkdir -p "$TARGET_DIR" "$HOME/Library/Logs/obsidian-llm-wiki"
chmod +x "$REPO_DIR/scripts/run-ingest-if-idle.zsh"
cp "$SOURCE_PLIST" "$TARGET_PLIST"

if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
  launchctl bootout "gui/$(id -u)" "$TARGET_PLIST" >/dev/null 2>&1 || true
fi

launchctl bootstrap "gui/$(id -u)" "$TARGET_PLIST"
launchctl enable "gui/$(id -u)/$LABEL"

print "installed: $TARGET_PLIST"
print "status: launchctl print gui/$(id -u)/$LABEL"
print "log: $HOME/Library/Logs/obsidian-llm-wiki/ingest.log"
