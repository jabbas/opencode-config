# Zen Principles for Agents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Zen of Python (numbered #1–#19) the single shared rule set for all agents, extend "How Agents Apply This" with the agreed interpretations, and give `architect`, `coder`, `reviewer` and `devops` a short role-specific block.

**Architecture:** One shared source (`docs/design-principles.md`, already loaded for every agent via `opencode.json` → `instructions`) plus one "Zen in this role" section per agent prompt that only adds role-specific behavior and never restates the shared file.

**Tech Stack:** Markdown agent prompts and instruction files of the OpenCode config repo (`~/.config/opencode`).

**Spec:** `docs/superpowers/specs/2026-11-01-zen-principles-design.md` (Polish; decisions D1–D7, architect calls A1–A4 in section 8).

## Global Constraints

- All repository text is English; commit messages in English.
- No code examples in any prompt (spec D4).
- Role blocks must not restate bullets of the shared file (spec D2).
- Do not rename or move `docs/design-principles.md` — `opencode.json` loads it by absolute `~/` path.
- Do not touch `opencode.json`, `docs/global-rules.md`, `AGENTS.md`, or any skill submodule (spec non-goals; `AGENTS.md` "Design Principles" stays accurate as is).
- Agent frontmatter (`---` block, lines 1–13 in each agent file) stays byte-identical.
- Shared file growth: roughly 10–12 lines (soft limit; meaning wins — spec A4).
- Follow the spec's own "No abbreviations" rule in everything you write for the user (reports, commit bodies): expand any abbreviation on first use.

## Review Focus

1. **Broken agent load** — an edit that touches the frontmatter makes the agent fail to load or lose permissions; expected: frontmatter unchanged (verified in Task 2 Step 5).
2. **Shared file stops loading** — a renamed path or a stray edit to `opencode.json`; expected: file path unchanged and still listed (verified in Task 1 Step 4).
3. **Reviewer output contract broken** — the new reviewer block must not add output outside the review template, nor displace the mandatory first line `Model: …`; expected: block only shapes findings and severity (Task 2 Step 3 wording + Step 5 check).
4. **Duplication** — a role block repeating "No silent failures", "Ask, don't guess" etc. creates two sources of one rule; expected: role blocks contain only the role-specific lines given below.
5. **Numbering drift** — the Zen list must have exactly 19 numbered items in original order, so "#10" means "Errors should never pass silently."; expected: verified in Task 1 Step 3.

---

### Task 1: Shared principles file

**Files:**
- Modify: `docs/design-principles.md:14-47` (sections "The Zen of Python (PEP 20)" — PEP 20 is Python Enhancement Proposal 20 — and "How Agents Apply This")
- Also commit: `docs/superpowers/specs/2026-11-01-zen-principles-design.md`, `docs/superpowers/plans/2026-11-01-zen-principles.md` (written by the architect, not yet committed)

**Interfaces:**
- Produces: rule numbers #1–#19 that Task 2 role blocks cite (#4, #8, #9, #10, #11 in particular).

- [ ] **Step 1: Number the Zen list.** Replace the 19 plain lines (14–34) with an ordered Markdown list `1.`–`19.`, original wording and order unchanged, preceded by the line `Numbered so reviews and reports can cite a rule (e.g. "#10").`

- [ ] **Step 2: Replace the "How Agents Apply This" bullets (36–47) with exactly this text:**

```markdown
## How Agents Apply This

- **Ambiguity → ask, failure → diagnose (#12).** Do not guess requirements, paths,
  names, or intent — ask. When something fails for an unclear reason, find the root
  cause before changing anything; no trial-and-error fixes.
- **No silent failures (#10, #11).** Never swallow errors. Any deliberate silencing is
  explicit and carries a comment explaining why.
- **Now, but not half-baked (#15, #16).** Don't postpone indefinitely, but don't ship
  something unfinished just to have it now. Anything deliberately left out is listed
  explicitly as debt — in your final report; whoever owns the spec or plan the work
  came from (usually the coordinator) also records it there.
- **Subtract before adding.** Prefer deleting or simplifying an existing mechanism
  over introducing a new one.
- **One obvious way (#13).** Do not create parallel mechanisms that do the same thing.
- **Explainable or redesign (#17, #18).** If a solution can't be explained in a few
  sentences, go back to design.
- **Flat and namespaced (#5, #19).** Prefer shallow structures and clear names,
  prefixes, and namespaces over deep nesting.
- **Readable over clever (#1, #6, #7).** Use full descriptive names; no one-liners at
  the cost of readability; of two working solutions, pick the simpler one.
- **No abbreviations.**
  - *To the user* — in chat, in summaries relayed from subagents, and in specs and
    plans (`docs/superpowers/`): write full names. If an abbreviation is unavoidable,
    expand it on first use in that message or document. Never assume an abbreviation
    is "commonly known".
  - *In code and scripts* — no abbreviated identifiers (`create_list`, not
    `create_lst`); long flags and full resource names in scripts and pipelines
    (`--namespace`, `kustomization` not `ks`). Exceptions: language idioms (`err`,
    `ctx`, `i`, single-letter Go receivers) and acronyms common in code (`URL`, `ID`,
    `HTTP`).
```

- [ ] **Step 3: Verify numbering and content**

Run: `grep -cE '^[0-9]+\. ' docs/design-principles.md`
Expected: `19`

Run: `grep -nE '^10\. Errors should never pass silently\.$|^19\. Namespaces' docs/design-principles.md`
Expected: two lines, numbered 10 and 19.

Run: `grep -c '^- \*\*' docs/design-principles.md`
Expected: `9` (nine top-level bullets).

- [ ] **Step 4: Verify the file is still loaded**

Run: `grep -n 'design-principles.md' opencode.json`
Expected: one line `"~/.config/opencode/docs/design-principles.md"`; `git status --short opencode.json` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add docs/design-principles.md docs/superpowers/specs/2026-11-01-zen-principles-design.md docs/superpowers/plans/2026-11-01-zen-principles.md
git commit -m "docs: number Zen of Python rules and extend how agents apply them"
```

---

### Task 2: Role blocks for architect, coder, reviewer, devops

**Files:**
- Modify: `agents/architect.md` — insert after the "Guidelines:" list (after line 33), before `<CRITICAL-TOOL-CONSTRAINT>`
- Modify: `agents/coder.md` — insert after the "Guidelines:" list (after line 32), before "Delegate to specialist agents:"
- Modify: `agents/reviewer.md` — insert after the "How you work:" list (after line 22), before `<CRITICAL-TOOL-CONSTRAINT>`
- Modify: `agents/devops.md` — insert after the "Shell command style" paragraph (after line 36), before "Delegate to specialist agents:"

**Interfaces:**
- Consumes: rule numbers from Task 1 (`docs/design-principles.md`).

Each block starts with the same heading line, then a blank line, then its bullets:

`Zen in this role (adds to docs/design-principles.md, never replaces it):`

- [ ] **Step 1: `agents/architect.md` block bullets**

```markdown
- Always evaluate "don't build it / remove something" as one of the alternatives.
- Every new component, layer, or dependency names the requirement that justifies it.
- When a problem is genuinely complex (#4), say so and choose clear component
  boundaries instead of faking simplicity.
```

- [ ] **Step 2: `agents/coder.md` block bullets**

```markdown
- Early return instead of `else` after `return`; keep nesting shallow.
- Signal failure with an exception or a returned error, never by returning `None` or an
  empty value; a legitimately absent or empty result is not a failure.
- Split long expressions into named intermediate steps.
- On a bug: reproduce it with a failing test before changing code.
- "Preserve existing code style" (#8) still applies; if that style violates these
  principles, report it instead of silently rewriting it.
```

- [ ] **Step 3: `agents/reviewer.md` block bullets**

```markdown
- Zen violations are regular findings in the template's own format: cite the rule
  number (e.g. "#10") and `file:line`. The template still decides process and output.
- Flag over-engineering: unneeded layers, parallel mechanisms, unused abstractions.
- A deviation from these principles, justified by a comment in the code that gives a
  real reason (#9, #11), is not a defect. This never excuses a deviation from the
  spec, the plan, or the task requirements.
- Minimum severity, within the template's scale: an error swallowed or silenced
  without a justifying comment in the code (#10, #11) is at least Important (blocks
  merge), even if the plan allowed it. Readability and abbreviation issues are Minor
  unless they hide behavior. If the template has no severity scale, state in words
  that such a finding is blocking.
```

- [ ] **Step 4: `agents/devops.md` block bullets**

```markdown
- No hidden defaults: set chart and image versions explicitly (never missing, never
  `latest`). Explicit ranges (e.g. `1.x`) and Flux image automation are fine — do not
  rewrite working explicit setups. A wildcard range such as `*` counts as `latest`.
- Keep Kustomize overlays shallow.
- No `|| true`, `continue-on-error`, or `failurePolicy: Ignore` without a comment
  explaining why.
- The long-flag and full-name rule covers Helm values, Flux manifests, and GitHub
  Actions steps; one-off interactive commands may keep the short forms shown above.
```

- [ ] **Step 5: Verify**

Run: `grep -c 'Zen in this role' agents/architect.md agents/coder.md agents/reviewer.md agents/devops.md`
Expected: each file `:1`.

Run: `git diff -U0 agents/ | grep -E '^@@ -([0-9]|1[0-3])[ ,]'`
Expected: no output (no hunk touches lines 1–13, the frontmatter).

Run: `git diff --stat`
Expected: only the four `agents/*.md` files changed, insertions only.

Read `agents/reviewer.md` end to end: the final two paragraphs (report-only reply, mandatory first line `Model: …`) are unchanged and the new block does not ask for any output outside the template.

- [ ] **Step 6: Commit**

```bash
git add agents/architect.md agents/coder.md agents/reviewer.md agents/devops.md
git commit -m "agents: add role-specific Zen blocks to architect, coder, reviewer, devops"
```

---

### After both tasks (user)

Start a fresh session in any directory and ask an agent to quote rule #10 from its design principles; it should answer "Errors should never pass silently." — this confirms the shared file still loads with numbering.
