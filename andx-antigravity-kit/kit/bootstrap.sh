#!/usr/bin/env bash
# Usage: ./bootstrap.sh /path/to/ANDX-Web2-Assessment.zip /path/to/new-repo
# Creates the submission repo: untouched assessment kit first, then the agent setup, as two clean commits.
set -euo pipefail
ZIP="${1:?path to ANDX-Web2-Assessment.zip}"; DEST="${2:?destination repo dir}"
KIT_DIR="$(cd "$(dirname "$0")" && pwd)"
[ -e "$DEST" ] && [ -n "$(ls -A "$DEST" 2>/dev/null)" ] && { echo "destination not empty: $DEST"; exit 1; }
mkdir -p "$DEST"; DEST="$(cd "$DEST" && pwd)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
unzip -q "$ZIP" -d "$TMP"
git -C "$DEST" init -q -b main
mkdir -p "$DEST/docs"
cp -R "$TMP/web2-kit" "$DEST/web2-kit"
cp "$TMP/ANDX-Web2-Assessment.md" "$DEST/docs/ASSESSMENT.md"   # gitignored on purpose: it is the employer's document
cp "$KIT_DIR/.gitignore" "$DEST/.gitignore"
git -C "$DEST" add -- .gitignore web2-kit
git -C "$DEST" commit -q -m "chore: add unmodified assessment kit (generator, expected answers, AI dev set)"
cp -R "$KIT_DIR/.agents" "$KIT_DIR/tools" "$DEST/"
cp "$KIT_DIR/AGENTS.md" "$DEST/AGENTS.md"
mkdir -p "$DEST/docs/evidence"
cp "$KIT_DIR/docs/STATUS.md" "$KIT_DIR/docs/TIME_LOG.md" "$KIT_DIR/docs/ai-log.md" "$DEST/docs/"
touch "$DEST/docs/evidence/.gitkeep"
git -C "$DEST" add -- AGENTS.md .agents tools docs/STATUS.md docs/TIME_LOG.md docs/ai-log.md docs/evidence/.gitkeep
git -C "$DEST" commit -q -m "chore(agents): add agent rules, skills, workflows and spec oracle

Assisted-by: Antigravity (Gemini 3.1 Pro)"
echo "Repo ready at $DEST"; git -C "$DEST" log --oneline
echo "Next: open $DEST in Antigravity, then paste MASTER_PROMPT.md (see SETUP.md)."
