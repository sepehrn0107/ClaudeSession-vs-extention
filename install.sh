#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXT_ID="sepehrn.claude-sessions-0.1.0"
EXT_DIR="$HOME/.vscode/extensions/$EXT_ID"

echo "→ Installing Claude Sessions extension..."

# 1. Compile
cd "$SCRIPT_DIR"
npm install --silent
npm run compile --silent

# 2. Copy to VS Code extensions folder
rm -rf "$EXT_DIR"
mkdir -p "$EXT_DIR"
cp -r out media package.json "$EXT_DIR/"

echo ""
echo "✓ Done. Extension installed to ~/.vscode/extensions/$EXT_ID"
echo ""
echo "  To activate: open VS Code and press Ctrl+Shift+P → 'Developer: Reload Window'"
echo "  Then look for the chat icon in the Activity Bar."