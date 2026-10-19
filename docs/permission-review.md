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
- **One simple command per tool call** — a single `python3 script.py`. No `&&` /
  `;` chains: if a prompt appears, "Always" would save an approval for every
  sub-command of the chain.
- Scratch files and scripts: `$TMPDIR/opencode/review/`.
- No writes to the DB or `opencode.json` during analysis.

## Evaluate

- Current rules: `cd ~ && opencode debug agents` (run from `~` so project config
  does not interfere). Bash rules have action `shell`; **last match wins**;
  config `deny` is checked first; saved approvals (`permission` table) are
  appended after config rules and override `ask`.
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
3. Report the findings (a)–(d) to the user, with proposed changes.

## Background facts

- Permission config **hot-reloads** in every location — no restart needed.
- The user always clicks "Allow once"; "Always" saves an allow for **every
  sub-command** of the chain, hence the one-command-per-call rule.
