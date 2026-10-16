#!/usr/bin/env bash
# Tests for check-skill-whitelists.sh against a fixture config dir that mirrors
# OpenCode v2 skill discovery (ID = parent dir of SKILL.md, or basename of a
# top-level *.md; only skill/ and skills/ are scanned; symlinks are followed).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CHECK="$SCRIPT_DIR/check-skill-whitelists.sh"

TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

failures=0
fail() { echo "[FAIL] $1"; failures=$((failures + 1)); }

skill() { # skill <path-to-dir> <frontmatter-name>
  mkdir -p "$1"
  printf -- '---\nname: %s\ndescription: test\n---\nbody\n' "$2" > "$1/SKILL.md"
}

C="$TMPDIR/cfg"
skill "$C/skills/pack/plugins/x/skills/generate-design" "stitch::generate-design"
skill "$C/skill/solo" "solo"
printf -- '---\nname: flat\ndescription: test\n---\nbody\n' > "$C/skills/flat.md"
skill "$C/vendor/skills/linkedskill" "linkedskill"
ln -s ../vendor/skills "$C/skills/linked"
skill "$C/notdiscovered/hidden" "hidden"
skill "$C/skill/dup" "dup"
skill "$C/skills/pack/dup" "dup"

write_config() {
  printf '{"agent":{%s}}' "$1" > "$C/opencode.json"
}

# --- Case 1: all entries valid under v2 rules -> exit 0 ---
write_config '"good":{"permission":{"skill":{"*":"deny","generate-design":"allow","solo":"allow","flat":"allow","linkedskill":"allow","opencode":"allow","report":"ask","gen*":"allow","dup":"allow"}}}'
if out="$("$CHECK" "$C" 2>&1)"; then :; else
  fail "valid whitelist should pass (exit 0); got: $out"
fi
grep -q '^\[PASS\]' <<<"$out" || fail "expected [PASS] line; got: $out"
grep -q "^\[WARN\].*'dup'" <<<"$out" || fail "expected [WARN] for duplicate skill ID 'dup'; got: $out"

# --- Case 2: v1-style / undiscovered entries -> exit 1, one FAIL each ---
write_config '"bad":{"permission":{"skill":{"*":"deny","stitch::*":"allow","stitch::generate-design":"allow","hidden":"allow","customize-opencode":"allow","ignored":"deny"}}}'
if out="$("$CHECK" "$C" 2>&1)"; then
  fail "dead entries should fail (exit 1); got: $out"
fi
for e in "stitch::\\*" "stitch::generate-design" "hidden" "customize-opencode"; do
  grep -q "^\[FAIL\] bad: .*'$e'" <<<"$out" || fail "expected [FAIL] for '$e'; got: $out"
done
grep -q "'ignored'" <<<"$out" && fail "deny entries must not be checked; got: $out"
[[ "$(grep -c '^\[FAIL\] bad:' <<<"$out")" -eq 4 ]] || fail "expected exactly 4 FAIL lines; got: $out"

if [[ "$failures" -eq 0 ]]; then
  echo "[PASS] check-skill-whitelists follows OpenCode v2 skill ID rules"
else
  exit 1
fi
