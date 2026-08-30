#!/usr/bin/env bash
set -euo pipefail

CONFIG_FILE="${1:-opencode.json}"

if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "[FAIL] config file not found: $CONFIG_FILE" >&2
  exit 1
fi

created=0

while IFS= read -r secret_path; do
  case "$secret_path" in
    secrets/*) ;;
    *)
      echo "[FAIL] refusing non-secrets file reference: $secret_path" >&2
      exit 1
      ;;
  esac

  if [[ -e "$secret_path" ]]; then
    continue
  fi

  mkdir -p "$(dirname "$secret_path")"
  : > "$secret_path"
  echo "[CREATE] $secret_path"
  created=$((created + 1))
done < <(
  grep -oE '\{file:secrets/[^}]+\}' "$CONFIG_FILE" \
    | sed -E 's/^\{file://; s/\}$//' \
    | sort -u
)

if [[ "$created" -eq 0 ]]; then
  echo "[OK] all secret placeholder files already exist"
else
  echo "[OK] created $created missing secret placeholder file(s)"
fi
