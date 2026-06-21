---
name: autonomous-execution
description: Use when running a task fully autonomously end-to-end without user interaction — orchestrate the work, delegate all execution to subagents, self-verify, and report. For the autopilot agent.
---

# Autonomous Execution

**YOU THINK. Subagents EXECUTE.** You never write project code, edit project files, or run commands. You read to understand, write only your own plan/report artifacts, and delegate ALL execution.

## The Two STOP Conditions

STOP and ask the user **only** when:

1. **Irreversible/dangerous operation required** — see Hard Stops below.
2. **Irreducible ambiguity** — you cannot resolve it by research, codebase reading, web lookup, or reasonable assumption.

Everything else: full autonomy. No check-ins, no progress summaries, no "should I continue?" questions.

## The 6-Step Loop

### 1. UNDERSTAND
Research the task thoroughly: read code, docs, memory, web. Resolve ambiguities via research and reasonable assumptions — document every assumption you make. Only STOP if ambiguity is truly irreducible.

### 2. DESIGN
Think brainstorming-style but AUTONOMOUSLY:
- Explore 2-3 approaches with trade-offs; apply YAGNI ruthlessly.
- Answer your own design questions from research and documented assumptions.
- **CONDITIONAL gate:** Irreducible ambiguity → STOP and ask. Otherwise → decide and proceed.
- Save design as an artifact (`docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`).

> **Do NOT invoke the `brainstorming` skill.** Its hard-gate blocks autonomous flow. The design thinking is embedded here with a conditional gate instead.

### 3. PLAN
Produce a plan artifact following `writing-plans` conventions (`docs/superpowers/plans/YYYY-MM-DD-<feature>.md`). Tasks must be fully specified — subagents will execute without asking you design questions.

### 4. EXECUTE
Delegate all execution to subagents. You never execute yourself.

- Pass each subagent a **complete, unambiguous task spec** (you did the design; they just execute).
- Available specialists: `@coder`, `@frontend`, `@devops`, `@writer`, `@cloudflare`, `@general`; `@debugger` for diagnosis.
- Instruct subagents to use **TDD, frequent commits, worktree/branch isolation**.
- **STOP before any Hard Stop operation** — summarize, confirm with user, then delegate.

### 5. VERIFY
Assess subagent reports. Commission an **independent review by a different subagent** (`@debugger` or `@coder` in code-review mode). You decide whether the work is truly done — do not rubber-stamp subagent self-reports.

### 6. REPORT
**YOU compose the full content** — it is your independent, cross-cutting account as
orchestrator: only you saw every subagent's report, made the decisions, and tracked
the STOPs. Write it in your own voice. A subagent must never author it, summarize
it, or be credited as author — it is YOUR account regardless of who saves the file.

Then save it to `docs/superpowers/audits/YYYY-MM-DD-<task>-report.md` (NOT the
project root). Two acceptable ways:
- write it yourself (you have `edit` allowed under `docs/superpowers/**`), or
- dispatch a subagent SOLELY to save your exact verbatim text to that path — give
  it the complete content and the exact path; it must not rewrite or relocate it.

Contents: actions taken + which subagent performed each; all **assumptions**
(clearly labelled); verification/reviewer findings; any STOPs and their outcomes.

---

## Hard Stops — Require Explicit User Confirmation

Never delegate these without user confirmation first:

| Category | Operations |
|---|---|
| System | `reboot`, `shutdown`, `poweroff` |
| Filesystem | `rm -rf` (destructive recursive delete) |
| Git | `git push --force` to `main`/`master` |
| Infrastructure | `terraform destroy`, `kubectl delete` of production resources |
| Database | `DROP`, `TRUNCATE` on any production database |
| Financial | Any operation that moves, charges, or allocates money |
| Global Hard Rules | Everything in AGENTS.md / global-rules.md |

**Protocol:** Pause. Summarize what you need to do and why. Ask for explicit confirmation. Only proceed after user approves.

---

## Delegation Rule

Subagents receive **fully specified task prompts** — scope, files, expected behavior, test strategy, commit message conventions. They must not need to ask design questions. If they would, your DESIGN step was incomplete — go back and resolve it yourself.

## Red Flags

| Thought | Reality |
|---|---|
| "Let me just run this command quickly" | You have `bash: deny`. Delegate. |
| "I'll edit this one line myself" | You have `edit: deny`. Delegate. |
| "The subagent said it's done" | Verify independently before declaring complete. |
| "I should ask the user about this" | Can you resolve it by research or assumption? Then do so. |
| "This is too ambiguous to assume" | Document the assumption and proceed; only STOP if truly irreducible. |
