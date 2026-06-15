# Autopilot Autonomous Agent — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `autopilot` — a user-only, autonomous orchestrator agent (opus) that thinks/plans/decides/reviews and delegates ALL execution to subagents (sonnet+), with a new `autonomous-execution` skill encoding its loop and stop-conditions.

**Architecture:** New agent `agents/autopilot.md` (opus, `mode: primary`, `bash/edit: deny`, `task: allow`, lean skill whitelist) + new local skill `skill/autonomous-execution/SKILL.md`. The skill must exist on disk before being whitelisted (else the whitelist-consistency check flags a dead entry).

**Tech Stack:** Markdown (agent + skill), JSONC (opencode.json), bash/jq for verification.

**Spec:** `docs/superpowers/specs/2026-06-14-autopilot-autonomous-agent-design.md`

---

## File Structure

- **Create:** `skill/autonomous-execution/SKILL.md` — the behavior skill (authored by `@skill-smith`).
- **Create:** `agents/autopilot.md` — agent definition (frontmatter + orchestration prompt).
- **Modify:** `opencode.json` — add `agent.autopilot` (model, mode, permissions, skill whitelist).
- **Modify:** `AGENTS.md` — add autopilot to the Agent Roster.

Order matters: skill on disk (Task 1) BEFORE whitelist (Task 3).

---

## Task 1: Create the `autonomous-execution` skill

**Files:**
- Create: `skill/autonomous-execution/SKILL.md`

- [ ] **Step 1: Delegate skill authoring to @skill-smith**

Dispatch `@skill-smith` with this requirement (it owns skill creation + uses `writing-skills` to pressure-test). The skill MUST:
- Frontmatter: `name: autonomous-execution`; `description: Use when running a task fully autonomously end-to-end without user interaction — orchestrate, delegate execution to subagents, self-verify, and report. (autopilot agent)`. Max 1024 chars frontmatter; name lowercase-hyphen.
- Encode the 6-step loop from the spec: UNDERSTAND (research) → DESIGN (brainstorming-style but autonomous; self-answer; STOP only on irreducible ambiguity) → PLAN (writing-plans artifact) → EXECUTE (delegate ALL execution to subagents; autopilot never writes code/runs commands; STOP before irreversible ops) → VERIFY (assess subagent reports; commission independent review by another subagent; decide "done") → REPORT (write audit artifact: actions, ASSUMPTIONS, verification, stops, which subagent did what).
- State the TWO and only interaction points: (1) irreversible/dangerous op, (2) irreducible ambiguity. List the hard-stop operations (reboot/shutdown, rm -rf, force-push to main, terraform destroy / kubectl delete of prod, db drop/truncate, financial ops, + Global Hard Rules).
- State that it does NOT invoke the interactive `brainstorming` skill (would block); the design thinking is embedded here with a CONDITIONAL gate.
- State the delegation rule: pass fully-specified task prompts to subagents so they don't hit their own interactive gates.
- Keep body focused (<500 words preferred per repo convention).

- [ ] **Step 2: Verify the skill is on disk with valid frontmatter**

Run:
```bash
test -f /Users/jabbas/.config/opencode/skill/autonomous-execution/SKILL.md && echo "exists"
head -5 /Users/jabbas/.config/opencode/skill/autonomous-execution/SKILL.md
awk -F': ' '/^name:/{print $2; exit}' /Users/jabbas/.config/opencode/skill/autonomous-execution/SKILL.md
```
Expected: `exists`; frontmatter with `name: autonomous-execution`; the name printed is exactly `autonomous-execution`.

- [ ] **Step 3: Verify OpenCode discovers it**

Run: `opencode debug agent build 2>&1 | grep -c autonomous-execution || true`
Expected: ≥1 (the `build` agent has no skill whitelist, so it sees all skills incl. the new one → confirms discovery). If 0, the skill dir/pattern is wrong — check it is at `skill/autonomous-execution/SKILL.md` under the config root.

- [ ] **Step 4: Commit**

```bash
git -C /Users/jabbas/.config/opencode add skill/autonomous-execution/SKILL.md
git -C /Users/jabbas/.config/opencode commit -m "feat(skill): add autonomous-execution skill for autopilot"
```

---

## Task 2: Create the `autopilot` agent definition

**Files:**
- Create: `agents/autopilot.md`

- [ ] **Step 1: Write `agents/autopilot.md`**

Create with this exact content:

```markdown
---
name: autopilot
description: User-only autonomous orchestrator - give it any task and it plans, delegates all execution to subagents, self-verifies, and reports, without interaction
mode: primary
tools:
  read: true
  write: true
  glob: true
  grep: true
  edit: false
  bash: false
---

You are an autonomous orchestrator. The user gives you a task and you drive it
end-to-end WITHOUT interaction — with only two exceptions where you STOP and ask:
(1) an irreversible/dangerous operation, (2) irreducible ambiguity you cannot
resolve by research or reasonable assumption.

You THINK; subagents EXECUTE. You never write project code, edit project files, or
run commands yourself. You read to understand, write only your own plan/report
artifacts, and delegate ALL execution to subagents.

Follow the `autonomous-execution` skill for the full loop. In short:
1. UNDERSTAND — research (code, docs, memory, web); resolve ambiguity.
2. DESIGN — explore alternatives, trade-offs, YAGNI; answer your own design
   questions; STOP only if truly ambiguous; save the design artifact.
3. PLAN — produce a plan artifact (writing-plans).
4. EXECUTE — delegate fully-specified tasks to subagents (@coder, @frontend,
   @devops, @writer, @cloudflare, @general); instruct them to use TDD, frequent
   commits, and isolation (worktree/branch). STOP before any irreversible op.
5. VERIFY — assess subagent reports; commission an INDEPENDENT review by another
   subagent (@debugger or @coder code-review); decide whether it is truly done.
6. REPORT — write an audit artifact: what was done, your ASSUMPTIONS, verification
   results, any STOPs, and which subagent did what.

Delegation: always pass subagents complete, unambiguous task specs (you already did
the design), so they execute without hitting their own interactive gates.

Safety: honor the Global Hard Rules. Never reboot/shutdown/destroy/force-push or
run irreversible commands without explicit user confirmation in the conversation.
Prefer isolated branches/worktrees so changes stay reversible until integration.
```

- [ ] **Step 2: Verify frontmatter parses**

Run: `head -15 /Users/jabbas/.config/opencode/agents/autopilot.md`
Expected: valid YAML frontmatter with `name: autopilot`, `mode: primary`, `bash: false`, `edit: false`.

- [ ] **Step 3: Commit**

```bash
git -C /Users/jabbas/.config/opencode add agents/autopilot.md
git -C /Users/jabbas/.config/opencode commit -m "feat(agents): add autopilot agent definition"
```

---

## Task 3: Wire autopilot into opencode.json

**Files:**
- Modify: `opencode.json` (add `agent.autopilot`)

- [ ] **Step 1: Add the autopilot agent block**

Using the `Edit` tool, add this entry inside the `"agent"` object in `opencode.json`
(place it alongside the other agents, e.g., after `"architect"`). Match the file's
existing indentation:

```json
    "autopilot": {
      "model": "anthropic/claude-opus-4-8",
      "mode": "primary",
      "permission": {
        "bash": "deny",
        "edit": "deny",
        "task": "allow",
        "skill": {
          "*": "deny",
          "using-superpowers": "allow",
          "autonomous-execution": "allow",
          "writing-plans": "allow",
          "subagent-driven-development": "allow",
          "dispatching-parallel-agents": "allow",
          "verification-before-completion": "allow",
          "requesting-code-review": "allow"
        }
      }
    },
```

- [ ] **Step 2: Verify JSON + resolved agent**

Run:
```bash
jq empty /Users/jabbas/.config/opencode/opencode.json && echo JSON_OK
jq '.agent.autopilot.mode, .agent.autopilot.model, .agent.autopilot.permission.skill["autonomous-execution"]' /Users/jabbas/.config/opencode/opencode.json
opencode debug agent autopilot 2>&1 | grep -iE 'opus|primary' | head
```
Expected: `JSON_OK`; mode `"primary"`, model opus, skill `"allow"`; debug shows opus + primary.

- [ ] **Step 3: Verify autopilot is NOT dispatchable as a subagent**

Run: `opencode debug agent coder 2>&1 | grep -c '\bautopilot\b' || true`
Expected: `0` — autopilot (mode primary) must NOT appear in another agent's available subagent list (`registry.ts:253` filters `mode !== "primary"`).

- [ ] **Step 4: Verify whitelist consistency still passes**

Run: `bash /Users/jabbas/.config/opencode/scripts/check-skill-whitelists.sh; echo "exit=$?"`
Expected: `[PASS]` and `exit=0` — confirms `autonomous-execution` resolves to the on-disk skill (no dead entry).

- [ ] **Step 5: Commit**

```bash
git -C /Users/jabbas/.config/opencode add opencode.json
git -C /Users/jabbas/.config/opencode commit -m "feat(agents): wire autopilot into opencode.json (opus, primary, deny bash/edit)"
```

---

## Task 4: Document autopilot in AGENTS.md

**Files:**
- Modify: `AGENTS.md` (Agent Roster)

- [ ] **Step 1: Add roster row**

Using the `Edit` tool, add this row to the Agent Roster table in `AGENTS.md`,
right after the `architect` row:

```markdown
| `autopilot` | `claude-opus-4-8` | User-only autonomous orchestrator; opus thinks, subagents execute; `mode: primary` (no agent can dispatch it); bash/edit: deny |
```

- [ ] **Step 2: Verify**

Run: `grep -n 'autopilot' /Users/jabbas/.config/opencode/AGENTS.md`
Expected: the new roster row is present.

- [ ] **Step 3: Commit**

```bash
git -C /Users/jabbas/.config/opencode add AGENTS.md
git -C /Users/jabbas/.config/opencode commit -m "docs(agents): add autopilot to roster"
```

---

## Task 5: Final verification

- [ ] **Step 1: Full resolved-agent check**

Run:
```bash
opencode debug agent autopilot 2>&1 | head -40
```
Expected: model opus, mode primary, skill list contains the 7 whitelisted skills (and NOT brainstorming), bash/edit denied.

- [ ] **Step 2: Confirm non-dispatchability across a couple of agents**

Run:
```bash
for a in coder general devops frontend; do
  echo -n "$a sees autopilot: "; opencode debug agent "$a" 2>&1 | grep -c '\bautopilot\b' || true
done
```
Expected: `0` for every agent.

- [ ] **Step 3: Whitelist consistency + JSON sanity**

Run:
```bash
bash /Users/jabbas/.config/opencode/scripts/check-skill-whitelists.sh; echo "wl-exit=$?"
jq empty /Users/jabbas/.config/opencode/opencode.json && echo JSON_OK
```
Expected: `[PASS]`, `wl-exit=0`, `JSON_OK`.

- [ ] **Step 4: Confirm clean git state**

Run: `git -C /Users/jabbas/.config/opencode status --short`
Expected: empty (all changes committed across Tasks 1–4).

---

## Self-Review (completed during planning)

- **Spec coverage:** skill loop+stops (Task 1), pure-orchestrator agent with bash/edit deny + write-own-artifacts (Task 2), opus+primary+task:allow+lean whitelist (Task 3), non-dispatchability (Task 3 Step 3, Task 5 Step 2), roster doc (Task 4). All spec requirements mapped.
- **Ordering:** skill created (Task 1) before whitelist references it (Task 3) — avoids dead-entry FAIL.
- **Placeholder scan:** full agent prompt + exact JSON block + exact roster row provided; skill content delegated to @skill-smith with explicit, complete requirements (it is the skill owner and pressure-tests via writing-skills). No TBD.
- **Consistency:** skill name `autonomous-execution`, agent name `autopilot`, model `claude-opus-4-8`, `mode: primary` consistent across all tasks.
