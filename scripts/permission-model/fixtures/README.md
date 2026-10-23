# permission-model fixtures

| File | Entries | Status |
|---|---|---|
| `session-commands.json` | 64 | present |
| `audit-evaluated.json` | — | **MISSING** (source `$TMPDIR/opencode/permaudit/evaluated.json` does not exist; the directory is empty) |
| `audit-remaining.json` | — | **MISSING** (source `$TMPDIR/opencode/permaudit/remaining.json` does not exist) |

## `session-commands.json`

Array of `{ id, agent, cwd, command }`. **Authored by hand from a list of command shapes seen in the
2026-10-19..22 sessions — not extracted from real session logs.** Covers (talosctl,
syft, ansible-lint from `.venv/bin`, kind, helm, git clone, gh api, `kubectl --context`, `flux --context`,
`cargo test` with env, `rm -rf $TMPDIR/x`, tmp scripts, `sh <(yq …)`, `K=… ; $K get`, shell functions,
heredocs, destructive git/kubectl, aws profiles, `sh -c`, `eval`, `xargs`). Args are invented and harmless;
secrets are redacted in the agent-guard style (`ghp_[REDACTED]`, `sk-[REDACTED]`, `AKIA[REDACTED]`,
`-----BEGIN [REDACTED]-----`, `eyJ[REDACTED]`). `id` is `sc-NNN`; `agent` is the agent that would run it; `cwd`
is an illustrative absolute directory.

## `audit-commands.json`

Raw corpus of every `shell`/`read`/`edit`/`write` tool call, rebuilt directly from OpenCode's SQLite DB because
`$TMPDIR/opencode/permaudit/` was cleaned up. Companion: `audit-commands-summary.json` (counts per
tool / agent / day / tool×agent / day×tool, redaction counts, top-100 command-word histogram).

- **Source:** `~/.local/share/opencode/opencode.db`, opened read-only. Tables `session_v2` (agent, title,
  directory, parent_id) + `session_message` where `type='assistant'`, parts `content[]` with `type='tool'`
  and `name ∈ {shell, read, edit, write}`. (Legacy tables `session`/`part` stop at 2026-10-03, so they are not used.)
- **Date range:** 2026-10-04T00:16 .. 2026-10-23T00:21 (local, CEST); root + child (subagent) sessions.
  Snapshot taken while a live session was still running, so counts may be a few entries higher than listed.
- **Counts (snapshot):** 10 016 entries — shell 5 908, read 1 507, edit 2 000, write 601; 8 624 from child
  sessions. Agents: coder 4 030, general 2 895, devops 1 262, architect 769, explore 318, build 269, writer 239,
  debugger 234. Status: completed 9 902, error 110, running 3, streaming 1. Per-day figures: summary file.
- **Size:** ~5.4 MB — under the 15 MB target, so nothing was dropped (no read/edit/write entries removed).
- **Redaction:** patterns `ghp_…`, `gho_…`, `sk-…`, `AKIA…`, `-----BEGIN…-----`, `eyJ…` (40+), and
  `(password|token|secret)=<12+ chars>` → `<REDACTED>`; applied to `command` only. Result: 2 matches in 1
  command, both `-----BEGIN…-----` (a Rust test fixture); no real tokens were found. The `sk-` pattern is
  tightened to `(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{8,}`: the literal `sk-[A-Za-z0-9]+` also matched ordinary
  words like `task-1-brief` (210 false positives). Note that agent-authored placeholders already present in
  the original commands (e.g. `sed 's/eyJ…/<REDACTED>/'`) are left as they were.
- **Heredocs:** bodies kept verbatim, except bodies > 4 KB, which are cut to 4 KB + `…` (terminator line kept so the
  command stays parseable): 27 bodies in 25 commands.
- **Schema:** `{ id, ts, agent, sessionTitle, cwd, tool, command?, path?, sessionId, child, status }`
  - `id` – tool-call id (`tool_…` / `toolu_…`); `ts` – ISO-8601 with local offset;
  - `agent` – agent of the assistant message that made the call (falls back to the session's agent);
  - `cwd` – the call's `workdir` if given, else the session directory;
  - `command` (shell only) / `path` (read, edit, write; the DB input key is `path`, not `filePath`);
  - extras beyond the requested schema: `sessionId`, `child` (true = subagent session), `status`
    (`completed`/`error`/`running`/`streaming` — `error` includes permission denials and failed commands).
- **Command-word histogram:** crude heuristic (split on `; | || && & newline`, skip env assignments and
  shell keywords, ignore heredoc bodies), meant for orientation, not as parser ground truth.
- **Regenerate:** the build script is `$TMPDIR/opencode/pm-corpus/build.py` (ephemeral).

## `expected-decisions.json` / `known-divergences.json` (generated locally, gitignored)

**Not committed:** they contain real commands from the corpus. Generate them locally with
`node scripts/permission-model/build-expected.mjs` (needs `audit-commands.json`; seed `20261023`; also writes
`docs/permission-model-expected-decisions.md`, gitignored too). On a fresh clone they are absent and
`test-replay.mjs` skips the tests that need them (`test.skip`); the rest of the suite is unaffected.
`expected-decisions.json` = ~980 rows `{ id, tool, command|path, agent, cwd, expected, why, group, note? }`:
all 64 `session-commands.json` entries (`session`), every corpus entry the plugin would ask/deny (`non-allow`, ~830)
and a seeded random 80 of the allowed rest (`sample`). Labels come from `label.mjs` (an independent reading of spec §3–§4,
not the plugin's output). `known-divergences.json` lists corpus entries where plugin ≠ label (triaged; see
`docs/permission-model-expected-decisions.md` §3); `PM_STRICT=1 node --test scripts/permission-model/test-replay.mjs` ignores the tolerance.
CLI: `node scripts/permission-model/replay.mjs [--out FILE] [--top N]` (writes `$TMPDIR/opencode/pm-replay.json`).

## `audit-*.json` (to be added)

Copy from `$TMPDIR/opencode/permaudit/` (`evaluated.json` → `audit-evaluated.json`, `remaining.json` →
`audit-remaining.json`), redacting secrets (`ghp_`, `sk-`, `AKIA`, `-----BEGIN`, `eyJ…`) with the same
placeholders as above. Do not commit them when larger than 5 MB: add them to `.gitignore` and document how
to regenerate here (audit script: `scripts/audit-bash-permissions.py`). Fill in the entry counts and the
field schema in this table once the files exist.
