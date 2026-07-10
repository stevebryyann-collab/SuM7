#!/usr/bin/env bash
# PreToolUse guard: block Edit/Write to secrets and lockfiles.
# Reads the tool payload on stdin; exit 2 blocks the tool call.
set -euo pipefail

payload="$(cat)"
file="$(printf '%s' "$payload" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("tool_input",{}).get("file_path",""))' 2>/dev/null || true)"

[ -z "$file" ] && exit 0

base="$(basename "$file")"

# Templates and example env files are meant to be edited — always allow.
case "$base" in
  *.example|*.sample|*.template) exit 0 ;;
esac

case "$base" in
  .env|.env.*|*.pem|*.key|id_rsa|id_ed25519|*.p12|*.pfx|pnpm-lock.yaml|package-lock.json|yarn.lock)
    echo "BLOCKED by block-sensitive hook: '$base' is a protected secret or lockfile." >&2
    echo "Editing it automatically is disabled. If this is truly intended, change it by hand." >&2
    exit 2
    ;;
esac

exit 0
