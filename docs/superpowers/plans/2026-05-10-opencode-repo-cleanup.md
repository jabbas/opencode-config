# OpenCode Config Repo Cleanup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `~/.config/opencode` a portable, version-controlled dotfiles repo with secrets extracted, skill repos as submodules, and accurate documentation.

**Architecture:** Minimal cleanup — fix secrets, gitignore, submodules, and docs without changing directory layout. Single initial commit at the end.

**Tech Stack:** Git, git submodules, OpenCode `{env:...}` config syntax

---

### Task 1: Rewrite `.gitignore`

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Rewrite `.gitignore` with correct patterns**

Replace the entire contents of `.gitignore` with:

```gitignore
# Dependencies
node_modules/
package.json
package-lock.json
bun.lock

# Secrets — NEVER commit
alibaba-cloud.apikey
.env
*.secret

# Ephemeral session files
session-*.md

# OS junk
.DS_Store
```

- [ ] **Step 2: Verify `.gitignore` is no longer ignoring itself**

Run:
```bash
git status --porcelain .gitignore
```

Expected: `.gitignore` shows as a trackable file (not ignored). You should see `?? .gitignore` or `A  .gitignore` in the output.

- [ ] **Step 3: Verify secrets and session files are ignored**

Run:
```bash
git check-ignore alibaba-cloud.apikey session-ses_3453.md .env test.secret
```

Expected: All four files are listed (all ignored).

---

### Task 2: Extract secrets from `opencode.json`

**Files:**
- Modify: `opencode.json`
- Create: `.env` (gitignored — will NOT be committed)
- Create: `.env.example`

- [ ] **Step 1: Capture current secret values into `.env`**

Read the current values from `opencode.json` and `alibaba-cloud.apikey`, then create `.env`:

```bash
# Extract the three values from opencode.json and the apikey file
# Write them to .env
cat > .env << 'ENVFILE'
CONTEXT7_API_KEY=<redacted>
GITHUB_PERSONAL_ACCESS_TOKEN=<redacted>
HOMEASSISTANT_TOKEN=<redacted>
ENVFILE
# Append the Alibaba key
echo "ALIBABA_CLOUD_API_KEY=$(cat alibaba-cloud.apikey)" >> .env
```

- [ ] **Step 2: Create `.env.example` with placeholder values**

```bash
cat > .env.example << 'ENVFILE'
CONTEXT7_API_KEY=
GITHUB_PERSONAL_ACCESS_TOKEN=
HOMEASSISTANT_TOKEN=
ALIBABA_CLOUD_API_KEY=
ENVFILE
```

- [ ] **Step 3: Replace hardcoded secrets in `opencode.json`**

Make three edits to `opencode.json`:

**Edit 1** — Replace the Context7 API key (line 145):
```
Old: "CONTEXT7_API_KEY": "<redacted>"
New: "CONTEXT7_API_KEY": "{env:CONTEXT7_API_KEY}"
```

**Edit 2** — Replace the GitHub PAT (line 154):
```
Old: "GITHUB_PERSONAL_ACCESS_TOKEN": "<redacted>"
New: "GITHUB_PERSONAL_ACCESS_TOKEN": "{env:GITHUB_PERSONAL_ACCESS_TOKEN}"
```

**Edit 3** — Replace the Home Assistant JWT (line 183):
```
Old: "Authorization": "Bearer <redacted>"
New: "Authorization": "Bearer {env:HOMEASSISTANT_TOKEN}"
```

- [ ] **Step 4: Verify no secrets remain in `opencode.json`**

Run:
```bash
grep -E '(ctx7sk|github_pat|eyJhbG)' opencode.json
```

Expected: No output (no matches — all secrets replaced).

- [ ] **Step 5: Verify `.env` is gitignored**

Run:
```bash
git check-ignore .env
```

Expected: `.env` is listed (ignored).

---

### Task 3: Convert skill repos to git submodules

**Files:**
- Remove and re-add: `superpowers/`, `anthropics-skills/`, `cloudflare-skills/`, `stitch-skills/`, `awesome-agent-skills/`
- Create: `.gitmodules`

This task must be done one repo at a time. The order matters because `skills/` and `plugins/` contain symlinks into these directories — we process `superpowers/` last since the plugin symlink points there.

**Important:** Before starting, verify all symlinks so we can validate them after:
```bash
ls -la skills/
ls -la plugins/
```

- [ ] **Step 1: Convert `anthropics-skills/`**

```bash
# Remove the standalone clone
rm -rf anthropics-skills/

# Add as submodule (HTTPS for portability)
git submodule add https://github.com/anthropics/skills.git anthropics-skills

# Pin to the exact commit that was checked out
cd anthropics-skills && git checkout f458cee31a7577a47ba0c9a101976fa599385174 && cd ..
```

Verify symlink still works:
```bash
ls skills/anthropics/
```
Expected: Lists skill directories/files (not a broken symlink error).

- [ ] **Step 2: Convert `cloudflare-skills/`**

```bash
rm -rf cloudflare-skills/
git submodule add https://github.com/cloudflare/skills.git cloudflare-skills
cd cloudflare-skills && git checkout 60147cbb773649eadca89cee92b4e0caf02234b4 && cd ..
```

Verify:
```bash
ls skills/cloudflare-skills/
```
Expected: Lists skill directories/files.

- [ ] **Step 3: Convert `stitch-skills/`**

```bash
rm -rf stitch-skills/
git submodule add https://github.com/google-labs-code/stitch-skills.git stitch-skills
cd stitch-skills && git checkout 6c0cbdb909b7d256c8b9b3854c8c8f87aab2c140 && cd ..
```

Verify:
```bash
ls skills/stitch-skills/
```
Expected: Lists skill directories/files.

- [ ] **Step 4: Convert `awesome-agent-skills/`**

```bash
rm -rf awesome-agent-skills/
git submodule add https://github.com/VoltAgent/awesome-agent-skills.git awesome-agent-skills
cd awesome-agent-skills && git checkout 95fa85de2b8044984d8ee790d0a4c1884ff2cf0b && cd ..
```

- [ ] **Step 5: Convert `superpowers/`**

```bash
rm -rf superpowers/
git submodule add https://github.com/obra/superpowers.git superpowers
cd superpowers && git checkout f2cbfbefebbfef77321e4c9abc9e949826bea9d7 && cd ..
```

Verify plugin symlink and skills symlink:
```bash
ls -la plugins/superpowers.js
# Should show: plugins/superpowers.js -> ../superpowers/.opencode/plugins/superpowers.js

ls skills/superpowers/
# Should list skill directories

cat plugins/superpowers.js | head -5
# Should show the plugin file content (not a broken symlink error)
```

- [ ] **Step 6: Verify `.gitmodules` is correct**

Run:
```bash
cat .gitmodules
```

Expected: Five submodule entries with HTTPS URLs:
```
[submodule "anthropics-skills"]
	path = anthropics-skills
	url = https://github.com/anthropics/skills.git
[submodule "cloudflare-skills"]
	path = cloudflare-skills
	url = https://github.com/cloudflare/skills.git
[submodule "stitch-skills"]
	path = stitch-skills
	url = https://github.com/google-labs-code/stitch-skills.git
[submodule "awesome-agent-skills"]
	path = awesome-agent-skills
	url = https://github.com/VoltAgent/awesome-agent-skills.git
[submodule "superpowers"]
	path = superpowers
	url = https://github.com/obra/superpowers.git
```

- [ ] **Step 7: Verify all symlinks survived**

```bash
# All four skill symlinks
ls skills/anthropics/ >/dev/null && echo "anthropics: OK" || echo "anthropics: BROKEN"
ls skills/cloudflare-skills/ >/dev/null && echo "cloudflare: OK" || echo "cloudflare: BROKEN"
ls skills/stitch-skills/ >/dev/null && echo "stitch: OK" || echo "stitch: BROKEN"
ls skills/superpowers/ >/dev/null && echo "superpowers: OK" || echo "superpowers: BROKEN"

# Plugin symlink
cat plugins/superpowers.js >/dev/null && echo "plugin: OK" || echo "plugin: BROKEN"
```

Expected: All five say "OK".

---

### Task 4: Update `AGENTS.md`

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: Fix the Repository Layout section (lines 44-69)**

Replace the tree diagram and surrounding text. The new version should reflect:
- 7 agents (not 15)
- 4 working skill symlinks (no broken ones)
- Submodule repos (not standalone clones)
- `.env.example` as a new file
- `.gitignore` as a tracked file
- Remove `package.json` and `bun.lock` from the tree (they're gitignored)

Replace lines 44-69 with:

```markdown
```
~/.config/opencode/
├── opencode.json              # Main OpenCode config (model, MCP servers, permissions)
├── .env.example               # Template for required env vars (copy to .env and fill in)
├── .gitignore                 # Tracked — ignores secrets, deps, session files
├── AGENTS.md                  # This file
├── agents/                    # Custom agent definitions (7 agents — see Agent Roster below)
├── docs/                      # Global rules, design specs, implementation plans
│   ├── global-rules.md        # Safety rules loaded via opencode.json instructions
│   ├── plans/                 # Implementation plans
│   └── superpowers/           # Brainstorming specs and plans
├── plugins/superpowers.js     # Symlink → superpowers/.opencode/plugins/superpowers.js
├── skills/                    # Skill discovery symlinks (all working)
│   ├── anthropics/            # → ../anthropics-skills/skills
│   ├── cloudflare-skills/     # → ../cloudflare-skills
│   ├── stitch-skills/         # → ../stitch-skills
│   └── superpowers/           # → ../superpowers/skills
├── superpowers/               # Main plugin repo — git submodule (obra/superpowers, v5.1.0)
├── anthropics-skills/         # Anthropic official skills — git submodule
├── cloudflare-skills/         # Cloudflare skills — git submodule
├── stitch-skills/             # Google Stitch skills — git submodule
└── awesome-agent-skills/      # Community skills — git submodule
```
```

- [ ] **Step 2: Fix the plugin load method paragraph (lines 71-75)**

Replace lines 71-75 with:

```markdown
**No `lib/skills-core.js`** — frontmatter parsing and skill discovery are inlined directly in `superpowers.js`.

**Plugin load method:** Uses the symlink method (`plugins/superpowers.js` → `superpowers/.opencode/plugins/superpowers.js`). The plugin auto-adds `superpowers/skills/` to config at runtime.

**Secrets:** All API keys and tokens are stored in `.env` (gitignored) and referenced via `{env:VARIABLE_NAME}` syntax in `opencode.json`. See `.env.example` for required variables.
```

- [ ] **Step 3: Fix the Agent Roster (lines 181-203)**

Replace lines 181-203 with the actual 7 agents from `agents/` and `opencode.json`:

```markdown
## Agent Roster

| Agent | Model | Purpose |
|-------|-------|---------|
| `general` | `claude-sonnet-4-6` | General-purpose fallback; software + DevOps (default agent: `agents/default.md`) |
| `coder` | `claude-sonnet-4-6` | Polyglot code — Go, Python, TypeScript, Shell |
| `designer` | `claude-opus-4-6` | Architecture ADRs, system design (bash: deny) |
| `debugger` | `claude-opus-4-6` | Full-stack debugging, diagnosis only |
| `devops` | `claude-sonnet-4-6` | CI/CD pipelines, GitHub, Flux, Helm, Kustomize |
| `ha` | `claude-sonnet-4-6` | Home Assistant — query entities, control devices |
| `websearch` | `claude-haiku-4-5` | Web content fetching, no reasoning |

- Per-agent bash permission overrides are in `opencode.json` under the `agent` key.
- `plan` agent is also defined in `opencode.json` (read-only: no bash/edit/write tools).
```

- [ ] **Step 4: Fix the Configuration section (lines 205-213)**

Replace lines 205-213 with:

```markdown
## Configuration: opencode.json

- **Default model:** `anthropic/claude-sonnet-4-6`
- **Small model:** `anthropic/claude-haiku-4-5`
- **Compaction:** Auto and prune enabled with 10k reserved tokens
- **Permissions:** `edit`/`bash` default to `ask`; safe read-only commands auto-allowed globally
- **Plan agent:** Read-only (no bash/edit/write tools)
- **Secrets:** Referenced via `{env:...}` syntax — actual values in `.env` (gitignored)
- **MCP servers:** context7 (remote), github (npx), playwright (npx), pdf-reader (npx), homeassistant (remote), chrome-devtools (disabled), dart-mcp-server (disabled)
```

- [ ] **Step 5: Fix the Naming Conventions session-files line (line 179)**

Replace:
```markdown
- **Session files:** `session-<id>.md` — ephemeral, do not commit (already in `.gitignore`)
```

With:
```markdown
- **Session files:** `session-<id>.md` — ephemeral, do not commit (gitignored via `session-*.md` pattern)
```

- [ ] **Step 6: Fix the agents count in line 47**

This is already handled by the tree replacement in Step 1. Verify the tree says "7 agents" not "15 agents".

- [ ] **Step 7: Verify the updated AGENTS.md is internally consistent**

Run:
```bash
# Check that the 7 agent names match what's in agents/
ls agents/ | sed 's/\.md$//' | sort
# Expected: coder, debugger, default, designer, devops, ha, websearch

# Check that AGENTS.md no longer references broken symlinks or wrong user
grep -c 'gdziegielewski\|BROKEN\|wrong user' AGENTS.md
# Expected: 0
```

---

### Task 5: Initial commit

**Files:**
- All modified and new files from Tasks 1-4

- [ ] **Step 1: Review what will be committed**

Run:
```bash
git status
```

Expected tracked files include:
- `.gitignore`
- `.gitmodules`
- `.env.example`
- `AGENTS.md`
- `opencode.json`
- `agents/*.md` (7 files)
- `docs/global-rules.md`
- `docs/plans/` (2 files)
- `docs/superpowers/specs/` (design spec)
- `docs/superpowers/plans/` (this plan)
- `plugins/superpowers.js` (symlink)
- `skills/` (symlinks)
- Submodule references for all 5 repos

Expected NOT tracked: `.env`, `alibaba-cloud.apikey`, `session-*.md`, `node_modules/`, `package.json`, `bun.lock`, `package-lock.json`

- [ ] **Step 2: Verify no secrets in staged content**

Run:
```bash
git diff --cached -- opencode.json | grep -E '(ctx7sk|github_pat|eyJhbG)'
```

Expected: No output.

Also run:
```bash
git diff --cached | grep -iE '(api.key|password|secret|token|bearer)' | grep -vE '(\{env:|\.env|NEVER commit|example|placeholder|\.secret)'
```

Expected: No suspicious matches (only references to env vars or documentation about secrets).

- [ ] **Step 3: Stage and commit everything**

```bash
git add -A
git commit -m "Initial commit: clean repo setup

- Secrets extracted to .env (gitignored), referenced via {env:...} in opencode.json
- Skill repos (superpowers, anthropics-skills, cloudflare-skills, stitch-skills,
  awesome-agent-skills) converted to git submodules with HTTPS URLs
- .gitignore: tracks itself, ignores secrets, deps, session files, .DS_Store
- AGENTS.md: updated to reflect current state (7 agents, working symlinks, submodules)
- .env.example: template for required environment variables"
```

- [ ] **Step 4: Verify the commit**

Run:
```bash
git log --oneline -1
git show --stat HEAD
```

Expected: One commit with all the files listed. No secrets in the diff.

- [ ] **Step 5: Verify submodules work from scratch (dry run)**

Run:
```bash
# Simulate what a fresh clone would do
git submodule status
```

Expected: All five submodules listed with their pinned commits (prefixed with `-` or a space, not `+` which would mean modified).
