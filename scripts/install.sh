#!/usr/bin/env bash
# markup one-shot installer.
#
# Installs Node dependencies and registers the MCP server with Claude Code
# at user scope so any Claude Code session — in any directory — can call
# `present_and_await_feedback`. Safe to re-run: replaces an existing entry.

set -euo pipefail

# Resolve repo root (this script lives in scripts/)
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

TSX="$REPO_ROOT/node_modules/.bin/tsx"
ENTRY="$REPO_ROOT/src/index.ts"

step() { printf "\n\033[1;33m→\033[0m %s\n" "$1"; }
ok()   { printf "  \033[1;32m✓\033[0m %s\n" "$1"; }
warn() { printf "  \033[1;33m!\033[0m %s\n" "$1"; }

step "Installing node dependencies"
if [ ! -d node_modules ] || [ package.json -nt node_modules ]; then
  npm install --silent
else
  warn "node_modules looks up to date — skipping (delete it to force a reinstall)"
fi
ok "deps installed"

if [ ! -x "$TSX" ]; then
  echo "ERROR: $TSX not found after npm install — aborting." >&2
  exit 1
fi
if [ ! -f "$ENTRY" ]; then
  echo "ERROR: entry point $ENTRY not found — aborting." >&2
  exit 1
fi

step "Registering Claude Code MCP server (user scope)"
if ! command -v claude >/dev/null 2>&1; then
  warn "claude CLI not found on PATH"
  echo ""
  echo "  To register manually later, run:"
  echo "    claude mcp add --scope user markup \"$TSX\" \"$ENTRY\""
  echo ""
else
  # Idempotent: remove any existing user-scope entry first, ignoring failure
  claude mcp remove markup --scope user >/dev/null 2>&1 || true
  claude mcp add --scope user markup "$TSX" "$ENTRY" >/dev/null
  ok "user-scope MCP server registered as 'markup'"
fi

cat <<EOF

\033[1;32m✓ markup installed.\033[0m
  location: $REPO_ROOT

To enable in the current Claude Code session:
  • type \033[1m/mcp\033[0m to reconnect, or restart Claude Code.

After that, any Claude Code session — in any project — can call the
\033[1mpresent_and_await_feedback\033[0m tool. The viewer auto-opens in your
browser at http://127.0.0.1:14271 (or the next free port).

If you ever move or rename this repo, re-run \033[1mbash scripts/install.sh\033[0m
from the new location to update the registered absolute paths.
EOF
