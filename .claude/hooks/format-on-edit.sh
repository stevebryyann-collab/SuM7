#!/usr/bin/env bash
# PostToolUse: format the just-edited file with the repo's Prettier.
# Always exits 0 — formatting is best-effort and must never block work.
set -uo pipefail

payload="$(cat)"
file="$(printf '%s' "$payload" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("tool_input",{}).get("file_path",""))' 2>/dev/null || true)"

[ -z "$file" ] && exit 0
[ -f "$file" ] || exit 0

case "$file" in
  *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs|*.json|*.md|*.css) ;;
  *) exit 0 ;;
esac

ROOT=/root/wholesale-portal
if [ -x "$ROOT/node_modules/.bin/prettier" ]; then
  ( cd "$ROOT" && ./node_modules/.bin/prettier --write "$file" >/dev/null 2>&1 ) || true
fi

exit 0
