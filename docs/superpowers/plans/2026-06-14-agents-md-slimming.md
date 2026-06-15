# AGENTS.md Slimming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move reference-only content out of the globally-injected AGENTS.md into a new on-demand `docs/dev-guide.md`, cutting ~2 280 tokens from every agent's system prompt.

**Architecture:** AGENTS.md keeps a lean core (safety rules, agent roster, condensed skill/whitelist notes, condensed repo layout, and a pointer section). All reference material (full repo layout, build/test commands, code style, config details, error handling, key files, superpowers skill list) moves verbatim into `docs/dev-guide.md`. The new file is a plain Markdown doc read via the `Read` tool — NOT a skill (a skill placed in `~/.config/opencode` would be discovered globally in every session; see spec).

**Tech Stack:** Markdown only. Verification via `wc -c` and `grep`.

**Spec:** `docs/superpowers/specs/2026-06-14-agents-md-slimming-design.md`

---

## File Structure

- **Modify:** `AGENTS.md` — remove relocated sections, shrink two sections, add one pointer section.
- **Create:** `docs/dev-guide.md` — receives the relocated sections verbatim.

Source of truth for verbatim moves is the CURRENT `AGENTS.md` on disk. Always `Read` the live file for the exact text of a section before moving it — do not retype from memory.

---

## Task 1: Create `docs/dev-guide.md` with relocated content

**Files:**
- Create: `docs/dev-guide.md`
- Read (source): `AGENTS.md`

- [ ] **Step 1: Read the current AGENTS.md in full**

Run: `Read ~/.config/opencode/AGENTS.md`
Purpose: capture the exact current text of every section to be moved. The sections to relocate (by their `## ` / `### ` headers) are:
1. `## Repository Layout` (the FULL version — code block tree + "Plugin load method" + "Secrets" + "Plugins" paragraphs)
2. `## Build / Lint / Test Commands` (all sub-sections incl. "Available Test Files" table, "Skill Triggering Tests", "Skill Validation")
3. `## Code Style Guidelines` (JavaScript, Shell Scripts, SKILL.md Files, Agent Definition Files, Naming Conventions)
4. `## Configuration: opencode.json`
5. `## Error Handling Patterns`
6. `## Key Files for Agents`
7. `## Superpowers Skills (14 total)`

- [ ] **Step 2: Write `docs/dev-guide.md`**

Create the file with this exact header, then paste the SEVEN sections above verbatim (copied from the live AGENTS.md read in Step 1), in this order: Repository Layout → Build/Lint/Test → Code Style → Configuration → Error Handling → Key Files → Superpowers Skills.

Header to use at the top of the file:

```markdown
# Dev Guide — Working in the OpenCode Config Repo

Reference material for editing this repository (`~/.config/opencode`): plugin JS,
SKILL.md files, agent definitions, and shell scripts. Read this BEFORE making
changes here. (Moved out of AGENTS.md to keep the global system prompt lean —
see `docs/superpowers/specs/2026-06-14-agents-md-slimming-design.md`.)

---
```

Then append the seven sections verbatim. Do NOT alter their content — this is a 1:1 relocation.

- [ ] **Step 3: Verify the new file has substance**

Run: `wc -c -l ~/.config/opencode/docs/dev-guide.md`
Expected: roughly 9 000–10 000 chars (the seven sections total ~9 000 chars + header). If under ~7 000, a section was missed — go back to Step 2.

- [ ] **Step 4: Verify each section landed**

Run:
```bash
grep -c '^## ' ~/.config/opencode/docs/dev-guide.md
grep -n '^## \|^### ' ~/.config/opencode/docs/dev-guide.md
```
Expected: at least 7 `## ` headers, and the sub-headers for Build/Test (Run All Unit Tests, Run a Single Test, Available Test Files, Skill Triggering Tests, Skill Validation) and Code Style (JavaScript, Shell Scripts, SKILL.md Files, Agent Definition Files, Naming Conventions) are present.

- [ ] **Step 5: Commit**

```bash
git -C ~/.config/opencode add docs/dev-guide.md
git -C ~/.config/opencode commit -m "docs: add dev-guide.md with reference content relocated from AGENTS.md"
```

---

## Task 2: Remove relocated sections from AGENTS.md

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: Delete the seven relocated sections**

Using the `Edit` tool, remove these entire sections from `AGENTS.md` (header + body, up to but not including the next retained header):
1. `## Build / Lint / Test Commands` … through end of `### Skill Validation` block
2. `## Code Style Guidelines` … through end of `### Naming Conventions`
3. `## Configuration: opencode.json` … through its last bullet
4. `## Error Handling Patterns` … through its last bullet
5. `## Key Files for Agents` … through end of its table
6. `## Superpowers Skills (14 total)` … through its skill list

Do NOT delete: `## Repository Layout` yet (it is shrunk in Task 3, not removed), `## Global Hard Rules`, `## Agent Roster`, `## Per-Agent Skill Whitelists`, `## Skill Resolution & Invocation`.

- [ ] **Step 2: Verify removals**

Run:
```bash
grep -n '^## ' ~/.config/opencode/AGENTS.md
```
Expected remaining `## ` headers: `Global Hard Rules (All Agents)`, `Repository Layout`, `Agent Roster`, `Per-Agent Skill Whitelists (token optimization)`, `Skill Resolution & Invocation`. (Configuration / Build / Code Style / Error Handling / Key Files / Superpowers must be GONE.)

- [ ] **Step 3: Verify no content loss vs dev-guide**

Run:
```bash
grep -q 'set -euo pipefail' ~/.config/opencode/docs/dev-guide.md && echo "code-style OK"
grep -q 'run-tests.sh' ~/.config/opencode/docs/dev-guide.md && echo "build OK"
grep -q 'Error Handling Patterns' ~/.config/opencode/docs/dev-guide.md && echo "errors OK"
```
Expected: `code-style OK`, `build OK`, `errors OK`. (Confirms moved content exists in the destination before it is gone from source.)

- [ ] **Step 4: Commit**

```bash
git -C ~/.config/opencode add AGENTS.md
git -C ~/.config/opencode commit -m "docs(agents): remove relocated reference sections from AGENTS.md"
```

---

## Task 3: Shrink Repository Layout to a stub in AGENTS.md

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: Replace the full Repository Layout section with a stub**

Using the `Edit` tool, replace the ENTIRE `## Repository Layout` section (the code-block tree AND the "Plugin load method", "Secrets", "Plugins" paragraphs) with exactly this:

```markdown
## Repository Layout

This is the OpenCode global config repo (`~/.config/opencode`): `opencode.json`
(main config), `agents/` (agent definitions), `docs/` (rules, specs, plans),
`plugins/superpowers.js` (symlink), `skills/` (discovery symlinks), and skill
submodules (`superpowers/`, `anthropics-skills/`, `cloudflare-skills/`,
`stitch-skills/`, `awesome-agent-skills/`). Secrets live in `secrets/`
(gitignored), referenced via `{file:PATH}` in `opencode.json`.

**Full directory tree, plugin load details, and secrets setup: see
`docs/dev-guide.md`.**
```

- [ ] **Step 2: Verify the stub replaced the tree**

Run:
```bash
grep -c '├──' ~/.config/opencode/AGENTS.md
```
Expected: `0` (the ASCII tree is gone from AGENTS.md; it now lives only in dev-guide.md).

- [ ] **Step 3: Commit**

```bash
git -C ~/.config/opencode add AGENTS.md
git -C ~/.config/opencode commit -m "docs(agents): condense Repository Layout to a stub + dev-guide pointer"
```

---

## Task 4: Shrink Per-Agent Skill Whitelists section

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: Replace the Whitelists section body with a condensed version**

Using the `Edit` tool, replace the ENTIRE body of `## Per-Agent Skill Whitelists (token optimization)` (everything from the header down to, but NOT including, the next `## ` header) with exactly this:

```markdown
## Per-Agent Skill Whitelists (token optimization)

Each agent's visible skills are restricted via `permission.skill` in
`opencode.json` (`agent.<name>.permission.skill`), pattern
`{"*": "deny", "<skill>": "allow", ...}`. **Only `deny` saves tokens** — a denied
skill is hidden from `<available_skills>` AND blocked from invocation; `allow`/`ask`
both keep it on the list at full cost (verified: `skill/index.ts:314`,
`permission/index.ts:86`). **Missing skill → delegate** to the owning specialist
(`@frontend`, `@stitch`, `@writer`, `@cloudflare`, `@skill-smith`); delegating
agents (`general`, `coder`, `architect`, `devops`, `frontend`, `writer`) have
explicit `"task": "allow"` so delegation works even as a subagent.

Full rationale, ownership map, and per-agent skill lists:
`docs/superpowers/specs/2026-06-13-agent-skill-optimization-design.md`.
```

- [ ] **Step 2: Verify the section shrank**

Run:
```bash
awk '/^## Per-Agent Skill Whitelists/{f=1} f&&/^## Skill Resolution/{exit} f{c+=length($0)+1} END{print c}' ~/.config/opencode/AGENTS.md
```
Expected: roughly 700–900 chars (down from ~1 442). If still >1 100, the old bullets were not fully replaced.

- [ ] **Step 3: Commit**

```bash
git -C ~/.config/opencode add AGENTS.md
git -C ~/.config/opencode commit -m "docs(agents): condense skill-whitelist section + spec pointer"
```

---

## Task 5: Add "Working in This Repo" pointer section

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: Insert the pointer section after Global Hard Rules**

Using the `Edit` tool, insert this section immediately AFTER the `## Global Hard Rules (All Agents)` section and BEFORE `## Repository Layout` (so the pointer sits near the top where agents reliably see it):

```markdown
## Working in This Repo

Editing files in this repo — `superpowers.js`/plugin code, `agents/*.md`,
`SKILL.md` skill files, or shell scripts? **Read `docs/dev-guide.md` BEFORE making
changes.** It has the code style, naming conventions, build/test commands, full
repo layout, and error-handling patterns. Non-editing tasks (queries, web ops,
home automation) do not need it.
```

- [ ] **Step 2: Verify placement**

Run:
```bash
grep -n '^## ' ~/.config/opencode/AGENTS.md
```
Expected order (top to bottom): `Global Hard Rules (All Agents)`, `Working in This Repo`, `Repository Layout`, `Agent Roster`, `Per-Agent Skill Whitelists (token optimization)`, `Skill Resolution & Invocation`.

- [ ] **Step 3: Commit**

```bash
git -C ~/.config/opencode add AGENTS.md
git -C ~/.config/opencode commit -m "docs(agents): add 'Working in This Repo' pointer to dev-guide"
```

---

## Task 6: Final verification

**Files:**
- Read: `AGENTS.md`, `docs/dev-guide.md`

- [ ] **Step 1: Confirm AGENTS.md hit the size target**

Run: `wc -c ~/.config/opencode/AGENTS.md`
Expected: ≤ ~5 000 chars (down from 13 334). Target core is ~4 200–4 500.

- [ ] **Step 2: Confirm total content is preserved (no net loss)**

Run:
```bash
echo "AGENTS.md:"; wc -c ~/.config/opencode/AGENTS.md
echo "dev-guide.md:"; wc -c ~/.config/opencode/docs/dev-guide.md
```
Expected: AGENTS.md + dev-guide.md combined ≥ ~13 000 chars (content moved, not deleted; sum is roughly original + the two new headers/pointers).

- [ ] **Step 3: Confirm retained core sections are intact**

Run:
```bash
for s in 'Global Hard Rules' 'Working in This Repo' 'Repository Layout' 'Agent Roster' 'Per-Agent Skill Whitelists' 'Skill Resolution'; do
  grep -q "## $s" ~/.config/opencode/AGENTS.md && echo "OK: $s" || echo "MISSING: $s"
done
```
Expected: all six print `OK:`.

- [ ] **Step 4: Confirm no SKILL.md was created (must be a plain doc, not a skill)**

Run: `test ! -e ~/.config/opencode/docs/SKILL.md && echo "not a skill OK"`
Expected: `not a skill OK`.

- [ ] **Step 5: Confirm git is clean**

Run: `git -C ~/.config/opencode status --short`
Expected: empty (all changes committed across Tasks 1–5).

---

## Self-Review (completed during planning)

- **Spec coverage:** Repo Layout shrink (Task 3), Build/Test+CodeStyle+Config+Errors+KeyFiles+Superpowers relocation (Tasks 1–2), Whitelist shrink (Task 4), pointer section (Task 5), no-new-skill constraint (Task 6 Step 4), token target (Task 6 Step 1). All spec requirements mapped.
- **Placeholder scan:** Verbatim-move steps reference the live file as source of truth (intentional, to avoid transcription drift); all NEW/REWRITTEN text is given in full. No TBD/TODO.
- **Consistency:** Section names match AGENTS.md headers exactly; retained-section list is identical across Tasks 2, 4, 5, 6.
