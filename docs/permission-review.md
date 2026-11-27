# Permission Review

Periodic review of how the permission config performs in real sessions: how often
the user is asked, what is still asked and why, and which "Always" approvals were
saved. Trigger phrase: **"zrób przegląd uprawnień"** / "permission review".

Rules live in `opencode.json` (see `docs/dev-guide.md` → Configuration → Permissions).
Raw command classification: `scripts/audit-bash-permissions.py`.

## When

- The **coordinator** (the agent the user talks to directly — never a subagent)
  runs `memory_recall` at session start and looks for the entry starting
  `PERMISSION REVIEW LAST:`.
- No entry, or its date is older than **7 days** → dispatch the review to
  `@general` **in the background** and tell the user in one line that it started.
- Also run it whenever the user says "zrób przegląd uprawnień" / "permission review".
- Skip the automatic trigger if the current session is itself about editing or
  verifying permissions.
- Subagents never start a review; they report the need to the coordinator.

## Scope

- Sessions since the last review date (all history if none).
- Exclude sessions that edit/verify the permission config itself, and the review
  session.

## Read-only first

- Open the DB read-only: `file:~/.local/share/opencode/opencode.db?mode=ro`
  (use the expanded absolute path from `$HOME`).
- **The DB is not a complete record (verified 2026-11-28).** v1 stored shell calls
  in `part` (ends 2026-10-28), v2 stores them in `session_part` (starts
  2026-11-25). Between those dates the DB has **no shell rows at all**, while
  sessions kept running. A DB-only replay therefore covers fragments and yields a
  meaningless ask rate (it reported 47 asks/h where the truth was 9.4).
- **Primary source for the ask rate: the permission-model shadow log**
  `~/.local/share/opencode/permission-model/decisions.jsonl` — one entry per
  permission evaluation (`action`, `agent`, `resource`, `incoming`, `decided`,
  `reason`, `ts`). It is complete for the whole window because the plugin has been
  logging since 2026-10-28. Read it with `python3` (plain JSON lines) or summarise
  it with `node scripts/permission-model/log-report.mjs`.
  - asks/h under current config = entries with `incoming == "ask"` / active hours
    (gaps ≤ 5 min between consecutive entries).
  - `resource` holds the command; there is no `cmd` field.
- Use the DB only for what the log lacks: **saved approvals** (`permission` table),
  session titles/agents, and tool-error text. When replaying DB commands, say so
  explicitly and never present that rate as the headline number.
- Read the DB **only through `python3`** (`sqlite3` module, `uri=True`). Never use
  the `sqlite3` CLI: it asks for permission on purpose — even with `mode=ro` its
  dot-commands (`.shell`, `.system`, `.output`, `.load`) and `ATTACH`/`VACUUM INTO`
  can run commands or write files. This includes `.schema`: use
  `SELECT sql FROM sqlite_master` from Python.
- **One simple command per tool call** — a single `python3 script.py`. No `&&` /
  `;` chains: if a prompt appears, "Always" would save an approval for every
  sub-command of the chain.
- Scratch files and scripts: `$TMPDIR/opencode/review/`.
- No writes to the DB or `opencode.json` during analysis.

## Evaluate

- Current rules: `cd ~ && opencode debug agents` (run from `~` so project config
  does not interfere). Bash rules have action `shell`; **last match wins**; config
  `deny` is checked first; saved approvals (`permission` table) are appended after
  config rules and override `ask`.
- **Rule list layout (verified 2026-11-28).** For each agent the resolved list is
  `[*→allow default rule] ++ <config rules> ++ <that agent's own permission block>`.
  Locate the agent block by finding its contiguous tail in the resolved list, then
  take config rules from the head — do not assume the tail is only the agent block.
- **Match action against the literal `"shell"`, resource against the command
  segment.** `evaluate(action, resource, rules)` compares `rule.action` with the
  action name and `rule.resource` with the command text. Matching the command
  against both is the classic bug: every rule then collapses to the `*` allow.
- Match with the real wildcard semantics: `*` → `.*`, `?` → `.`, a trailing `" *"`
  becomes `( .*)?` (so `git log *` also matches bare `git log`), anchored, and
  backslashes normalised to `/`.
- Split each recorded command into sub-commands the way v2 does (tree-sitter-bash;
  `core/src/shell/parse.ts`). A harness may already exist in
  `$TMPDIR/permharness` or `$TMPDIR/opencode/permaudit` — reuse it, else rebuild.
- Replay every sub-command against the rules of the agent that ran it to find the
  deciding rule and whether it resolves to `ask`.

## Report

**(a) Ask rate**
- Asks per hour of active work. Active time = sum of gaps ≤ 5 min between
  consecutive tool calls.
- Compare with the baseline **37 asks/h** (audit 2026-10-04..18: 930 asks / 2 weeks)
  and with the previous review (`PERMISSION REVIEW LAST:` memory).
- Count calls that actually waited for a reply (time between tool start and
  completion while status was pending).

**(b) Remaining asks**
- Group by sub-command prefix → deciding rule → category:
  `READ`, `BUILD-TEST`, `SCRATCH`, `PROJECT-WRITE`, `WRAPPER-STYLE`, `EXTERNAL`,
  `SYSTEM`, `SENSITIVE`, `CONFIG-GUARD`, `FALSE-POSITIVE`.
- Per group give a suggested fix (new allow, narrower rule, style change in
  `docs/global-rules.md`, or "keep asking").

**(c) New saved approvals**
- New rows in the `permission` table since the last review.
- Classify each: `JUNK` (one-off literal), `WRAPPER` (shell wrapper / variable),
  `SHELL-ANY` (allows any shell command), `RISKY`, `REDUNDANT` (already allowed
  by config), `KEEP`.
- **Rows are per project.** The same resource can be saved in several projects;
  delete by explicit id, scoped to the project that owns it. An `action = "edit"`
  or `"read"` row with `resource = "*"` is a project-wide grant — treat it as
  `SHELL-ANY` and review carefully.
- Repeated save patterns seen so far grant arbitrary command execution in that
  project (the `*` covers every command): `bash *`, `sh *`, `zsh *`, `perl *`, plus
  the irreversible `pkill *`, `docker stop|rm|restart *`, `docker network rm *`.

**(d) Safety signals**
- Denials, and whether the agent then switched to the edit tool (bypass check).
- Reads of sensitive paths.
- Writes outside the project directory.
- Edits to OpenCode config (`opencode.json*`, `agents/`, `secrets/`, `.opencode/`).

## Changes need the user's approval

Propose only. **Never** edit `opencode.json` or delete DB rows without an explicit
"yes" from the user.

- **Deleting saved approvals:**
  1. Online backup to `$TMPDIR/opencode/opencode.db.bak-perm-review-<date>` and
     verify with `PRAGMA integrity_check`.
  2. Delete by explicit ids in one transaction.
  3. Verify the remaining rows.
- **Config changes:**
  1. Edit with the edit tool (not the shell).
  2. Verify with `cd ~ && opencode debug agents` plus harness cases (allow/ask/deny
     per changed rule).
  3. Commit and push via `@devops` — Conventional Commits, no force. Commit
     messages must not contain private-key paths (the shell denies them).

## After the review

1. `memory_delete` the old `PERMISSION REVIEW LAST:` entry.
2. `memory_store` (project scope) a new one:
   `PERMISSION REVIEW LAST: <ISO date UTC> — asks/h <n>, saved rows <n>, notes`
   If no such entry exists yet, say so in the report instead of implying a
   comparison was possible — a missing marker means the 7-day trigger never fired.
3. Report the findings (a)–(d) to the user, with proposed changes.

## Review log

- **2026-11-28** — asks/h **9.4** (all actions) / **9.9** (shell only) on 96.7 h of
  logged activity, against the 37 asks/h baseline (~4× fewer). Source: shadow log;
  the DB gap 2026-10-29..2026-11-24 made a DB-only replay useless. Saved approvals
  211 → 200 after deleting 11 (6 `WRAPPER`, 5 `RISKY`). Sensitive-file debt from the
  previous review confirmed fixed (`*.pem*`, `*.key`, `*.token*`, `~/.aws/credentials`,
  `~/.kube/config`, `~/.config/gcloud/*` ask; `~/.ssh/id_*` denies). Only real denial
  was `perl -0pi`, and the agent correctly fell back to the edit tool. No new allows
  proposed: the remaining noise is agent style (`cd … && git …`, `export VAR=`,
  `source .venv/bin/activate`) already banned by `docs/global-rules.md`.

## Background facts

- Permission config **hot-reloads** in every location — no restart needed.
- The user always clicks "Allow once"; "Always" saves an allow for **every
  sub-command** of the chain, hence the one-command-per-call rule.
