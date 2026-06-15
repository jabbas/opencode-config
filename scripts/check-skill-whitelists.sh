#!/usr/bin/env bash
#
# check-skill-whitelists.sh
#
# Verifies that every skill referenced in an agent's permission.skill whitelist
# (agent.<name>.permission.skill == "allow" in opencode.json) corresponds to a
# real skill on disk, a known built-in, or — for wildcard patterns — matches at
# least one on-disk skill.
#
# Why: when a skill submodule updates and a skill is renamed/removed, a stale
# whitelist entry silently stops matching (skill/index.ts:314 only filters by
# "deny"; a nonexistent name simply allows nothing). This is silent drift. Run
# this after editing whitelists or updating skill submodules.
#
# Exit: 0 if no dead entries (orphan skills are allowed), 1 if any dead literal
# or dead wildcard entry is found.
#
# Spec: docs/superpowers/specs/2026-06-14-whitelist-consistency-check-design.md

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CONFIG="$REPO_ROOT/opencode.json"

# Built-in skills registered in OpenCode source (NOT SKILL.md files on disk).
# See skill/index.ts (CUSTOMIZE_OPENCODE_SKILL_NAME).
KNOWN_BUILTINS=("customize-opencode")

if ! command -v jq >/dev/null 2>&1; then
  echo "[FAIL] jq is required but not found" >&2
  exit 1
fi
if [[ ! -f "$CONFIG" ]]; then
  echo "[FAIL] opencode.json not found at $CONFIG" >&2
  exit 1
fi

# --- Collect on-disk skill names (frontmatter `name:`, first match per file) ---
DISK_SKILLS="$(
  find "$REPO_ROOT" -name SKILL.md -not -path '*/node_modules/*' -print0 \
    | xargs -0 -I{} awk -F': ' '/^name:/{gsub(/[ \t\r]+$/, "", $2); print $2; exit}' {} \
    | sort -u
)"

# --- Collect whitelist allow-entries: "<agent>\t<skill>" ---
WHITELIST="$(
  jq -r '
    .agent | to_entries[]
    | .key as $a
    | (.value.permission.skill // {}) | to_entries[]
    | select(.value == "allow")
    | "\($a)\t\(.key)"
  ' "$CONFIG"
)"

is_disk_skill() { grep -Fxq -- "$1" <<<"$DISK_SKILLS"; }

is_builtin() {
  local s="$1" b
  for b in "${KNOWN_BUILTINS[@]}"; do [[ "$s" == "$b" ]] && return 0; done
  return 1
}

# Does on-disk skill set contain anything matching the given glob pattern?
wildcard_has_match() {
  local pattern="$1" disk
  while IFS= read -r disk; do
    [[ -z "$disk" ]] && continue
    # shellcheck disable=SC2053  # intentional glob match (pattern unquoted)
    [[ "$disk" == $pattern ]] && return 0
  done <<<"$DISK_SKILLS"
  return 1
}

fail_count=0
checked=0

while IFS=$'\t' read -r agent skill; do
  [[ -z "${agent:-}" || -z "${skill:-}" ]] && continue
  [[ "$skill" == "*" ]] && continue   # deny-all base, never an allow anyway
  checked=$((checked + 1))

  if [[ "$skill" == *"*"* ]]; then
    if ! wildcard_has_match "$skill"; then
      echo "[FAIL] $agent: wildcard '$skill' matches no skill on disk"
      fail_count=$((fail_count + 1))
    fi
  else
    if ! is_disk_skill "$skill" && ! is_builtin "$skill"; then
      echo "[FAIL] $agent: '$skill' not found on disk and not a known built-in"
      fail_count=$((fail_count + 1))
    fi
  fi
done <<<"$WHITELIST"

# --- Orphans: on-disk skills no agent allows (literal or via wildcard) — INFO ---
orphan_count=0
while IFS= read -r disk; do
  [[ -z "$disk" ]] && continue
  owned=0
  while IFS=$'\t' read -r _agent skill; do
    [[ -z "${skill:-}" || "$skill" == "*" ]] && continue
    if [[ "$skill" == *"*"* ]]; then
      # shellcheck disable=SC2053
      [[ "$disk" == $skill ]] && { owned=1; break; }
    else
      [[ "$disk" == "$skill" ]] && { owned=1; break; }
    fi
  done <<<"$WHITELIST"
  if [[ "$owned" -eq 0 ]]; then
    echo "[INFO] orphan skill (no agent whitelists it): $disk"
    orphan_count=$((orphan_count + 1))
  fi
done <<<"$DISK_SKILLS"

echo "---"
if [[ "$fail_count" -eq 0 ]]; then
  echo "[PASS] all $checked whitelist entries resolve to a real skill, built-in, or wildcard match ($orphan_count orphan(s), informational)"
  exit 0
else
  echo "[FAIL] $fail_count dead whitelist entr(ies) found out of $checked checked"
  exit 1
fi
