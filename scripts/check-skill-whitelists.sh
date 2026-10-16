#!/usr/bin/env bash
#
# check-skill-whitelists.sh [CONFIG_DIR]
#
# Verifies that every skill referenced in an agent's permission.skill whitelist
# (agent.<name>.permission.skill entries that are not "deny" in opencode.json)
# corresponds to a skill OpenCode v2 actually discovers, a known built-in, or —
# for wildcard patterns — matches at least one of those.
#
# Why: a whitelist key that matches no skill ID silently grants nothing. v2
# (packages/core/src/skill.ts `Skill.available`) only filters out "deny", and
# matches keys against the skill ID — NOT the frontmatter `name:`. This drifts
# when skill submodules rename/remove skills. Run this after editing whitelists
# or updating skill submodules.
#
# Discovery mirrors OpenCode v2.0.29 (config/plugin/skill.ts, skill-file.ts):
#   - scanned roots: <CONFIG_DIR>/skill and <CONFIG_DIR>/skills (symlinks
#     followed), plus local paths in the config's top-level `skills` array
#   - pattern {*.md,**/SKILL.md}
#   - ID = parent directory name of SKILL.md, or basename of a top-level *.md
#   - duplicate IDs: the later source silently wins -> reported as [WARN]
#
# Exit: 0 if no dead entries (orphans and duplicates are informational),
#       1 if any dead literal or dead wildcard entry is found.
#
# Spec: docs/superpowers/specs/2026-06-14-whitelist-consistency-check-design.md

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG_DIR="$(cd "${1:-$SCRIPT_DIR/..}" && pwd)"
CONFIG="$CONFIG_DIR/opencode.json"

# Built-in skills shipped inside OpenCode v2 (no SKILL.md on disk).
# See packages/core/src/plugin/skill/*.md (`opencode api skill.list` shows them
# with path /builtin/<id>.md).
KNOWN_BUILTINS=("opencode" "report")

if ! command -v jq >/dev/null 2>&1; then
  echo "[FAIL] jq is required but not found" >&2
  exit 1
fi
if [[ ! -f "$CONFIG" ]]; then
  echo "[FAIL] opencode.json not found at $CONFIG" >&2
  exit 1
fi

# --- Discovery roots, in v2 load order ---
roots=("$CONFIG_DIR/skill" "$CONFIG_DIR/skills")
while IFS= read -r item; do
  [[ -z "$item" ]] && continue
  if [[ "$item" =~ ^https?:// ]]; then
    echo "[INFO] skipping URL skill source (not checked offline): $item"
    continue
  fi
  [[ "$item" == \~/* ]] && item="$HOME/${item#\~/}"
  [[ "$item" != /* ]] && item="$CONFIG_DIR/$item"
  roots+=("$item")
done < <(jq -r '.skills[]? // empty' "$CONFIG")

# --- Collect discovered skills as "<id>\t<path>" (load order preserved) ---
# NAMES maps frontmatter name -> ID, only to hint at v1-style whitelist keys.
DISCOVERED=""
NAMES=""
for root in "${roots[@]}"; do
  [[ -d "$root" ]] || continue
  while IFS= read -r -d '' file; do
    if [[ "$(basename "$file")" == "SKILL.md" ]]; then
      id="$(basename "$(dirname "$file")")"
    else
      id="$(basename "$file" .md)"
    fi
    DISCOVERED+="$id"$'\t'"$file"$'\n'
    name="$(awk '/^name:/{sub(/^name:[ \t]*/, ""); gsub(/^["\047]|["\047 \t\r]+$/, ""); print; exit}' "$file" || true)"
    [[ -n "$name" && "$name" != "$id" ]] && NAMES+="$name"$'\t'"$id"$'\n'
  done < <(
    {
      find -L "$root" -mindepth 1 -maxdepth 1 -type f -name '*.md' ! -name SKILL.md -print0
      find -L "$root" -mindepth 1 -type f -name SKILL.md -print0
    } | sort -z
  )
done

SKILL_IDS="$(cut -f1 <<<"$DISCOVERED" | sed '/^$/d' | sort -u)"
KNOWN_IDS="$(printf '%s\n' "$SKILL_IDS" "${KNOWN_BUILTINS[@]}" | sed '/^$/d' | sort -u)"

# --- Duplicate IDs: later source wins silently in v2 ---
while IFS= read -r dup; do
  [[ -z "$dup" ]] && continue
  paths="$(awk -F'\t' -v id="$dup" '$1 == id {print "    " $2}' <<<"$DISCOVERED")"
  echo "[WARN] skill ID '$dup' is defined more than once; the last one wins:"
  echo "$paths"
done < <(cut -f1 <<<"$DISCOVERED" | sed '/^$/d' | sort | uniq -d)

# --- Whitelist entries that make a skill visible: "<agent>\t<key>" ---
WHITELIST="$(
  jq -r '
    .agent // {} | to_entries[]
    | .key as $a
    | (.value.permission.skill // {}) | to_entries[]
    | select(.value != "deny")
    | "\($a)\t\(.key)"
  ' "$CONFIG"
)"

is_known() { grep -Fxq -- "$1" <<<"$KNOWN_IDS"; }

# Does any known skill ID match the given glob pattern?
wildcard_has_match() {
  local pattern="$1" id
  while IFS= read -r id; do
    [[ -z "$id" ]] && continue
    # shellcheck disable=SC2053  # intentional glob match (pattern unquoted)
    [[ "$id" == $pattern ]] && return 0
  done <<<"$KNOWN_IDS"
  return 1
}

fail_count=0
checked=0

while IFS=$'\t' read -r agent skill; do
  [[ -z "${agent:-}" || -z "${skill:-}" ]] && continue
  [[ "$skill" == "*" ]] && continue   # deny-all base
  checked=$((checked + 1))

  if [[ "$skill" == *"*"* ]]; then
    if ! wildcard_has_match "$skill"; then
      echo "[FAIL] $agent: wildcard '$skill' matches no skill ID"
      fail_count=$((fail_count + 1))
    fi
  elif ! is_known "$skill"; then
    hint=""
    real_id="$(awk -F'\t' -v n="$skill" '$1 == n {print $2; exit}' <<<"$NAMES")"
    [[ -n "$real_id" ]] && hint=" (that is a frontmatter name; use the ID '$real_id')"
    echo "[FAIL] $agent: '$skill' is not a discovered skill ID or built-in$hint"
    fail_count=$((fail_count + 1))
  fi
done <<<"$WHITELIST"

# --- Orphans: discovered skills no agent makes visible — INFO ---
orphan_count=0
while IFS= read -r id; do
  [[ -z "$id" ]] && continue
  owned=0
  while IFS=$'\t' read -r _agent skill; do
    [[ -z "${skill:-}" || "$skill" == "*" ]] && continue
    # shellcheck disable=SC2053
    if [[ "$id" == $skill ]]; then owned=1; break; fi
  done <<<"$WHITELIST"
  if [[ "$owned" -eq 0 ]]; then
    echo "[INFO] orphan skill (no agent whitelists it): $id"
    orphan_count=$((orphan_count + 1))
  fi
done <<<"$SKILL_IDS"

echo "---"
if [[ "$fail_count" -eq 0 ]]; then
  echo "[PASS] all $checked whitelist entries resolve to a discovered skill ID, built-in, or wildcard match ($orphan_count orphan(s), informational)"
  exit 0
else
  echo "[FAIL] $fail_count dead whitelist entr(ies) found out of $checked checked"
  exit 1
fi
