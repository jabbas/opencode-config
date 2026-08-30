#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

mkdir -p "$TMPDIR/secrets"

cat > "$TMPDIR/opencode.json" <<'JSON'
{
  "mcp": {
    "one": {
      "environment": {
        "TOKEN": "{file:secrets/one.key}",
        "URL": "{file:secrets/nested/two.url}"
      }
    }
  }
}
JSON

printf '%s' 'keep-me' > "$TMPDIR/secrets/one.key"

(
  cd "$TMPDIR"
  "$REPO_ROOT/scripts/init-secret-placeholders.sh" > "$TMPDIR/output.txt"
)

if [[ "$(cat "$TMPDIR/secrets/one.key")" != "keep-me" ]]; then
  echo "[FAIL] existing secret was overwritten"
  exit 1
fi

if [[ ! -f "$TMPDIR/secrets/nested/two.url" ]]; then
  echo "[FAIL] missing secret placeholder was not created"
  exit 1
fi

if [[ -s "$TMPDIR/secrets/nested/two.url" ]]; then
  echo "[FAIL] placeholder should be empty"
  exit 1
fi

echo "[PASS] init-secret-placeholders creates missing files without overwriting existing values"
