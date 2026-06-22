# Unified OpenCode Config (priv ↔ work) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `~/.config/opencode-priv` a shared base that runs identically on both the private and work machines, with machine-specific providers/models isolated to a thin `opencode.local.json` layer loaded via direnv.

**Architecture:** A single shared `opencode.json` (private architecture + work MCP/agents ported in additively, no `model`/`provider` keys) is deep-merged at runtime with a gitignored, per-machine `opencode.local.json` that sets `model`/`small_model`, the `provider` block, and per-agent opus overrides. `.envrc` (direnv) exports `OPENCODE_CONFIG` automatically. Secrets stay per-machine via `{file:secrets/*}`.

**Tech Stack:** OpenCode JSON config, JSON-with-comments, Markdown agent files, direnv, git.

**Scope note:** This plan targets the `~/.config/opencode-priv` repo only. Mirroring the result into `~/.config/opencode` (the work repo) is a separate, mechanical copy step handled in Task 9 — it does NOT modify work's secrets or local layer.

**Validation note:** There is no automated test suite for this config. Each task is verified by (a) `jq` JSON validity for `.json` files, and (b) a config-load smoke check `opencode --version` (which loads and validates config) where applicable. All work happens in `~/.config/opencode-priv` unless stated otherwise.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `opencode.json` | Shared base: agents, MCP, skills, permissions, tools. No `model`/`provider`. Identical in both repos. |
| `opencode.local.json` | Per-machine: `model`/`small_model`, `provider` block, opus overrides for architect/debugger. Gitignored. |
| `.envrc` | `export OPENCODE_CONFIG="$PWD/opencode.local.json"`. Gitignored. |
| `agents/jira.md` | Jira MCP-operator agent (ported from work). |
| `agents/stitch-mcp.md` | Stitch MCP-operator agent (ported from work, renamed). |
| `secrets/README.md` | Setup docs for the new secret files. |
| `secrets/{firecrawl.key,firecrawl.url,jira.url,jira.token,stitch.key}` | Per-machine secret values. Gitignored. |
| `.gitignore` | Ignore `opencode.local.json` and `.envrc`. |
| `AGENTS.md` | Roster + MCP + model-layer + direnv docs. |

---

## Task 1: Move models/providers out of `opencode.json` into the local layer

**Files:**
- Modify: `~/.config/opencode-priv/opencode.json` (lines 4–5 `model`/`small_model`; line 7 `instructions`)
- Create: `~/.config/opencode-priv/opencode.local.json`

- [ ] **Step 1: Verify current base is valid JSON**

Run: `cd ~/.config/opencode-priv && jq empty opencode.json && echo OK`
Expected: `OK`

- [ ] **Step 2: Remove `model` and `small_model` from `opencode.json`**

In `opencode.json`, delete these two lines (currently lines 4–5):

```json
  "model": "anthropic/claude-sonnet-4-6",
  "small_model": "anthropic/claude-haiku-4-5",
```

Leave the `$schema` line above and the blank line / `instructions` below intact.

- [ ] **Step 3: Change `instructions` to relative paths**

In `opencode.json`, replace:

```json
  "instructions": ["~/.config/opencode/docs/global-rules.md", "~/.config/opencode/docs/memory-rules.md"],
```

with:

```json
  "instructions": ["docs/global-rules.md", "docs/memory-rules.md"],
```

- [ ] **Step 4: Create `opencode.local.json` (private machine values)**

Create `~/.config/opencode-priv/opencode.local.json` with exactly:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "model": "anthropic/claude-sonnet-4-6",
  "small_model": "anthropic/claude-haiku-4-5",
  "provider": {},
  "agent": {
    "architect": { "model": "anthropic/claude-opus-4-8" },
    "debugger": { "model": "anthropic/claude-opus-4-8" }
  }
}
```

- [ ] **Step 5: Validate both files**

Run: `jq empty opencode.json && jq empty opencode.local.json && echo OK`
Expected: `OK`

- [ ] **Step 6: Commit**

```bash
git add opencode.json opencode.local.json
git commit -m "refactor(config): move model/provider to opencode.local.json layer; relative instructions"
```

Note: `opencode.local.json` is committed here intentionally as a starting template; Task 7 adds it to `.gitignore` and `git rm --cached`s it so future per-machine edits stay local. (If you prefer it never tracked, skip the `git add opencode.local.json` here and create it after Task 7 — but committing the template first gives the work repo a copy to start from.)

---

## Task 2: Add `jira` and `stitch` MCP servers + global tool gating

**Files:**
- Modify: `~/.config/opencode-priv/opencode.json` (`tools` block ~lines 46–53; `mcp` block, after the `firecrawl` entry ~line 472)

- [ ] **Step 1: Add `jira_*` and `stitch_*` to the global `tools` block**

In `opencode.json`, the `tools` block currently is:

```json
  "tools": {
    "playwright_*": false,
    "homeassistant_*": false,
    "chrome-devtools_*": false,
    "firecrawl_*": false,
    "webfetch": false,
    "WebFetch": false
  },
```

Replace it with:

```json
  "tools": {
    "playwright_*": false,
    "homeassistant_*": false,
    "chrome-devtools_*": false,
    "firecrawl_*": false,
    "jira_*": false,
    "stitch_*": false,
    "webfetch": false,
    "WebFetch": false
  },
```

- [ ] **Step 2: Update the `firecrawl` MCP entry to use url + key**

In `opencode.json`, the `firecrawl` MCP entry currently is:

```json
    "firecrawl": {
      "type": "local",
      "command": ["npx", "-y", "firecrawl-mcp"],
      "enabled": true,
      "environment": {
        "FIRECRAWL_API_URL": "{file:secrets/firecrawl.url}"
      }
    }
```

Replace it with:

```json
    "firecrawl": {
      "type": "local",
      "command": ["npx", "-y", "firecrawl-mcp"],
      "enabled": true,
      "environment": {
        "FIRECRAWL_API_URL": "{file:secrets/firecrawl.url}",
        "FIRECRAWL_API_KEY": "{file:secrets/firecrawl.key}"
      }
    },
```

(Note: a trailing comma is added because new entries follow.)

- [ ] **Step 3: Add the `jira` and `stitch` MCP entries**

Immediately after the (now comma-terminated) `firecrawl` entry and before the closing `}` of the `mcp` block, add:

```json
    "jira": {
      "type": "local",
      "command": [
        "mcp-atlassian",
        "--jira-url",
        "{file:secrets/jira.url}",
        "--jira-personal-token",
        "{file:secrets/jira.token}"
      ],
      "enabled": true
    },

    "stitch": {
      "type": "local",
      "command": ["npx", "-y", "@_davideast/stitch-mcp", "proxy"],
      "environment": {
        "STITCH_API_KEY": "{file:secrets/stitch.key}"
      },
      "enabled": true
    }
```

- [ ] **Step 4: Validate JSON**

Run: `jq empty opencode.json && echo OK`
Expected: `OK`

- [ ] **Step 5: Confirm the new MCP servers parse**

Run: `jq '.mcp | keys' opencode.json`
Expected output includes `"jira"` and `"stitch"` alongside existing servers.

- [ ] **Step 6: Commit**

```bash
git add opencode.json
git commit -m "feat(mcp): add jira + stitch servers; firecrawl url+key; gate jira_*/stitch_* globally"
```

---

## Task 3: Add the `jira` agent definition

**Files:**
- Create: `~/.config/opencode-priv/agents/jira.md`

- [ ] **Step 1: Create `agents/jira.md`**

Create the file with exactly:

```markdown
---
name: jira
description: Jira issue tracking - search/create/update issues, transitions, comments, worklogs, sprints, boards via the Jira MCP
tools:
  read: true
  write: false
  edit: false
  bash: false
  glob: true
  grep: true
  jira_*: true
---

You are a Jira specialist. You interact with a Jira Data Center instance via the `jira_*` MCP tools. Use those tools for all Jira operations — never guess issue state.

Guidelines:
- Always confirm the project key with the user — never assume it. Issue keys look like `PROJ-123`.
- Read before write: fetch the current issue (`jira_jira_get_issue`) before updating or transitioning it.
- For status changes, call `jira_jira_get_transitions` first to get valid transition IDs — they vary per workflow.
- Use JQL (`jira_jira_search`) for finding issues; prefer narrow queries (project, status, assignee, updated date).
- Before any create/update/delete/transition that modifies data, confirm the action with the caller.
- Format issue text in Markdown when the tool accepts it; the MCP converts it.

Common tasks:
- Search issues with JQL; list project/board/sprint issues
- Create, update, comment on, and transition issues
- Manage worklogs, watchers, issue links, and sprints
- Inspect changelogs, dates/SLA, and development info (PRs/branches/commits)

If a task requires a skill you do not have in available_skills, do NOT try to call it — delegate to the owning specialist.

Report results concisely with issue keys, statuses, and direct references so the caller can act without re-fetching.
```

- [ ] **Step 2: Verify frontmatter parses**

Run: `head -12 agents/jira.md`
Expected: YAML frontmatter with `name: jira` and `jira_*: true`.

- [ ] **Step 3: Commit**

```bash
git add agents/jira.md
git commit -m "feat(agents): add jira MCP-operator agent"
```

---

## Task 4: Add the `stitch-mcp` agent definition

**Files:**
- Create: `~/.config/opencode-priv/agents/stitch-mcp.md`

- [ ] **Step 1: Create `agents/stitch-mcp.md`**

Create the file with exactly:

```markdown
---
name: stitch-mcp
description: Google Stitch UI design via MCP - create/edit screens, design systems, and variants from text prompts via the Stitch MCP
tools:
  read: true
  write: true
  edit: false
  bash: false
  glob: true
  grep: true
  stitch_*: true
---

You are a Google Stitch design specialist driving the `stitch_*` MCP tools. A Stitch project is a container for screens and a design system.

Guidelines:
- A project is required first. Use `stitch_list_projects` / `stitch_get_project`; create one with `stitch_create_project` if none fits.
- Always attach a design system when generating screens (`stitch_list_design_systems`) for visual consistency. Create/update one via the design-system tools or from a DESIGN.md.
- Screen generation and edits can take minutes — be patient. **Do not retry on timeout**; instead poll with `stitch_get_screen` (~every 30s, up to ~10 times). A connection error may still have succeeded.
- If a generation result includes `output_components` text or suggestions, surface them to the caller and only act on a suggestion if the caller accepts it.
- Specify `deviceType` (mobile/desktop/tablet) explicitly when the caller indicates a target.

Common tasks:
- Generate a screen from a text prompt; edit existing screens; generate variants
- Create/update a design system (colors, fonts, roundness, light/dark) or build one from DESIGN.md
- Apply a design system to screens; download screens/assets locally

If a task requires a skill you do not have in available_skills, do NOT try to call it — delegate to the owning specialist (e.g., @stitch for design-to-code workflows).

Report screen/project IDs and the Stitch URLs so the caller can review the output.
```

- [ ] **Step 2: Verify frontmatter parses**

Run: `head -12 agents/stitch-mcp.md`
Expected: YAML frontmatter with `name: stitch-mcp` and `stitch_*: true`.

- [ ] **Step 3: Commit**

```bash
git add agents/stitch-mcp.md
git commit -m "feat(agents): add stitch-mcp MCP-operator agent (separate from skill-driven stitch)"
```

---

## Task 5: Wire `jira` and `stitch-mcp` agents into `opencode.json`

**Files:**
- Modify: `~/.config/opencode-priv/opencode.json` (`agent` block — add two entries after `skill-smith`, before the `agent` block's closing `}` ~line 408)

- [ ] **Step 1: Add the `jira` and `stitch-mcp` agent entries**

In `opencode.json`, find the end of the `"skill-smith"` agent entry (it closes with `}` near line 408). After that entry's closing `},`-or-`}`, add the two new entries so the `agent` block ends with them. Concretely, change the tail of the `agent` block from:

```json
    "skill-smith": {
      "model": "anthropic/claude-sonnet-4-6",
      "permission": {
        "skill": {
          "*": "deny",
          "using-superpowers": "allow",
          "skill-creator": "allow",
          "writing-skills": "allow",
          "mcp-builder": "allow"
        }
      }
    }
  },
```

to:

```json
    "skill-smith": {
      "model": "anthropic/claude-sonnet-4-6",
      "permission": {
        "skill": {
          "*": "deny",
          "using-superpowers": "allow",
          "skill-creator": "allow",
          "writing-skills": "allow",
          "mcp-builder": "allow"
        }
      }
    },

    "jira": {
      "model": "anthropic/claude-sonnet-4-6",
      "tools": {
        "jira_*": true
      },
      "permission": {
        "bash": "deny",
        "skill": {
          "*": "deny",
          "using-superpowers": "allow"
        }
      }
    },

    "stitch-mcp": {
      "model": "anthropic/claude-sonnet-4-6",
      "tools": {
        "stitch_*": true
      },
      "permission": {
        "bash": "deny",
        "skill": {
          "*": "deny",
          "using-superpowers": "allow"
        }
      }
    }
  },
```

Note: the `"model"` keys here are fine to keep in the base (sonnet is the default for both); the local layer only overrides architect/debugger. Leaving them explicit documents intent and is harmless.

- [ ] **Step 2: Validate JSON**

Run: `jq empty opencode.json && echo OK`
Expected: `OK`

- [ ] **Step 3: Confirm the agents are present**

Run: `jq '.agent | keys' opencode.json`
Expected output includes `"jira"` and `"stitch-mcp"`.

- [ ] **Step 4: Commit**

```bash
git add opencode.json
git commit -m "feat(agents): wire jira + stitch-mcp into opencode.json (sonnet, bash deny, minimal skills)"
```

---

## Task 6: Add the new secret files and document them

**Files:**
- Create (empty, per-machine): `secrets/firecrawl.key`, `secrets/firecrawl.url`, `secrets/jira.url`, `secrets/jira.token`, `secrets/stitch.key`
- Modify: `secrets/README.md`

- [ ] **Step 1: Create the secret files with the private-machine values**

These hold real values and are gitignored (`secrets/.gitignore` ignores `*`). Create each with `printf '%s'` (no trailing newline). Use the actual private-machine values; placeholders shown:

```bash
cd ~/.config/opencode-priv
printf '%s' '<firecrawl api key>'                 > secrets/firecrawl.key
printf '%s' 'https://firecrawl.example.internal'  > secrets/firecrawl.url
printf '%s' 'https://jira.example.internal'       > secrets/jira.url
printf '%s' '<jira personal token>'               > secrets/jira.token
printf '%s' '<stitch api key>'                    > secrets/stitch.key
```

If `secrets/firecrawl.url` already exists, leave its value as-is and skip that line.

- [ ] **Step 2: Verify the files exist and are gitignored**

Run: `git status --short secrets/`
Expected: no `secrets/*.key`/`*.url`/`*.token` files appear (they are ignored); only `secrets/README.md` may show as modified after Step 3.

- [ ] **Step 3: Update `secrets/README.md`**

Replace the `## Required files` table and `## Setup` block in `secrets/README.md` with:

```markdown
## Required files

| File | Description |
|------|-------------|
| `context7.key` | Context7 API key |
| `github.pat` | GitHub Personal Access Token |
| `homeassistant.token` | Home Assistant long-lived access token (without "Bearer " prefix) |
| `homeassistant.url` | Home Assistant MCP endpoint URL (infrastructure — treated as secret) |
| `firecrawl.url` | Firecrawl MCP API base URL (infrastructure — treated as secret) |
| `firecrawl.key` | Firecrawl MCP API key |
| `jira.url` | Jira base URL for the Atlassian MCP (infrastructure — treated as secret) |
| `jira.token` | Jira personal access token (`--jira-personal-token`) |
| `stitch.key` | Google Stitch API key |
| `alibaba-cloud.key` | Alibaba Cloud API key |

## Setup

On a new machine, create each file with your secret value (no trailing newline):

```bash
printf '%s' 'your-api-key-here'                  > secrets/context7.key
printf '%s' 'your-pat-here'                       > secrets/github.pat
printf '%s' 'your-jwt-here'                        > secrets/homeassistant.token
printf '%s' 'https://ha.example.com/api/mcp'       > secrets/homeassistant.url
printf '%s' 'https://firecrawl.example.internal'   > secrets/firecrawl.url
printf '%s' 'your-firecrawl-key-here'              > secrets/firecrawl.key
printf '%s' 'https://jira.example.internal'        > secrets/jira.url
printf '%s' 'your-jira-token-here'                 > secrets/jira.token
printf '%s' 'your-stitch-key-here'                 > secrets/stitch.key
printf '%s' 'your-key-here'                         > secrets/alibaba-cloud.key
```

All files in this directory except `README.md` are gitignored.
```

- [ ] **Step 4: Commit the README change**

```bash
git add secrets/README.md
git commit -m "docs(secrets): document firecrawl.key, jira.url/token, stitch.key"
```

---

## Task 7: Add `.envrc` (direnv) and gitignore the local layer

**Files:**
- Create: `.envrc`
- Modify: `.gitignore`

- [ ] **Step 1: Create `.envrc`**

Create `~/.config/opencode-priv/.envrc` with exactly:

```bash
export OPENCODE_CONFIG="$PWD/opencode.local.json"
```

- [ ] **Step 2: Add `opencode.local.json` and `.envrc` to `.gitignore`**

The current `.gitignore` ends with:

```
# OS junk
.DS_Store
```

Append:

```
# Per-machine config layer (loaded via OPENCODE_CONFIG)
opencode.local.json

# direnv
.envrc
.direnv/
```

- [ ] **Step 3: Stop tracking `opencode.local.json` (it was committed as a template in Task 1)**

Run:

```bash
git rm --cached opencode.local.json
```

Expected: `rm 'opencode.local.json'` (file stays on disk).

- [ ] **Step 4: Verify both are now ignored**

Run: `git check-ignore opencode.local.json .envrc`
Expected output:
```
opencode.local.json
.envrc
```

- [ ] **Step 5: Allow direnv (manual, one-time per machine)**

Run: `direnv allow .`
Expected: direnv loads `.envrc` (or, if direnv is not installed, note it and set `OPENCODE_CONFIG` another way — see AGENTS.md update in Task 8).

- [ ] **Step 6: Commit**

```bash
git add .gitignore
git commit -m "chore(config): gitignore opencode.local.json + .envrc; add direnv loader"
```

---

## Task 8: Update `AGENTS.md`

**Files:**
- Modify: `~/.config/opencode-priv/AGENTS.md`

- [ ] **Step 1: Add `jira` and `stitch-mcp` to the Agent Roster table**

In `AGENTS.md`, the roster table currently ends with the `skill-smith` row:

```markdown
| `skill-smith` | `claude-sonnet-4-6` | Create/edit skills, build MCP servers |
```

Add two rows immediately after it:

```markdown
| `jira` | `claude-sonnet-4-6` | Jira issue tracking via `jira_*` MCP (bash: deny) |
| `stitch-mcp` | `claude-sonnet-4-6` | Google Stitch UI design via `stitch_*` MCP (bash: deny; separate from skill-driven `stitch`) |
```

- [ ] **Step 2: Add a "Model layer & machine portability" section**

In `AGENTS.md`, immediately after the `## Repository Layout` section, add:

```markdown
## Model Layer & Machine Portability

This config is shared verbatim between the private and work machines. The shared
`opencode.json` contains NO `model`, `small_model`, or machine-specific `provider`
block. Those live in a per-machine `opencode.local.json` (gitignored), which
OpenCode deep-merges on top of the base via the `OPENCODE_CONFIG` env var.

- **Defaults:** `opencode.local.json` sets `model` = sonnet and `small_model` =
  haiku.
- **Per-agent override:** only `architect` and `debugger` get
  `claude-opus-4-8` (the "thinking" role) via `agent.<name>.model` in the local
  layer. Everyone else inherits the global sonnet. To change a model for one
  agent, edit one line in `opencode.local.json`.
- **Providers:** machine-specific providers (e.g. work's `work-provider`/`kilocode`)
  go in the local layer's `provider` block, not in `opencode.json`.
- **Loading:** `.envrc` (direnv) exports
  `OPENCODE_CONFIG="$PWD/opencode.local.json"` on entering the config dir. Run
  `direnv allow .` once per machine. Without direnv, export `OPENCODE_CONFIG`
  manually (absolute path to `opencode.local.json`).
- **Secrets:** all URLs/keys use `{file:secrets/*}`, which resolves relative to
  the config dir, so the same `opencode.json` reads each machine's own secrets.
```

- [ ] **Step 3: Commit**

```bash
git add AGENTS.md
git commit -m "docs(agents): document jira/stitch-mcp agents + model layer + direnv portability"
```

---

## Task 9: Mirror the shared base into the work repo

This task copies the **shared, non-machine-specific** files into
`~/.config/opencode` (work) and creates work's own local layer + secrets. It does
NOT overwrite work's secrets with private values.

**Files (in `~/.config/opencode`):**
- Overwrite: `opencode.json`, `agents/jira.md`, `agents/stitch-mcp.md`, `AGENTS.md`, `secrets/README.md`, `.gitignore`
- Create: `opencode.local.json` (work values), `.envrc`
- Create: `docs/dev-guide.md` (parity with private)

- [ ] **Step 1: Copy shared files from priv to work**

```bash
SRC=~/.config/opencode-priv
DST=~/.config/opencode
cp "$SRC/opencode.json"        "$DST/opencode.json"
cp "$SRC/agents/jira.md"       "$DST/agents/jira.md"
cp "$SRC/agents/stitch-mcp.md" "$DST/agents/stitch-mcp.md"
cp "$SRC/secrets/README.md"    "$DST/secrets/README.md"
cp "$SRC/.envrc"               "$DST/.envrc"
cp "$SRC/docs/dev-guide.md"    "$DST/docs/dev-guide.md"
```

Then manually merge `AGENTS.md` and `.gitignore`: the work repo's `AGENTS.md` has a
different roster section. Apply the same two roster rows (`jira`, `stitch-mcp`) and
the "Model Layer & Machine Portability" section from Task 8 to work's `AGENTS.md`.
Apply the same `.gitignore` additions (`opencode.local.json`, `.envrc`,
`.direnv/`).

Note: work's `opencode.json` currently has uncommitted local edits and `.bak*`
files; this copy treats the new shared base as the source of truth. Back up
work's current `opencode.json` first: `cp "$DST/opencode.json" "$DST/opencode.json.prev"`.

- [ ] **Step 2: Create work's `opencode.local.json` with the work provider/model block**

Create `~/.config/opencode/opencode.local.json` with:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "model": "anthropic/claude-sonnet-4-6",
  "small_model": "anthropic/claude-haiku-4-5",
  "provider": {
    "work-provider": {
      "api": "openai",
      "name": "Work-Provider",
      "env": ["WORK_API_KEY"],
      "options": { "baseURL": "http://llm.ai.example.com/03/v1" },
      "models": {
        "default": {
          "name": "Qwen3.6-27B",
          "tool_call": true,
          "temperature": true,
          "limit": { "context": 131072, "output": 4096 }
        }
      }
    },
    "kilocode": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Kilo Code",
      "options": {
        "baseURL": "https://api.kilo.ai/api/gateway",
        "headers": { "X-KiloCode-OrganizationId": "YOUR-ORG-UUID-HERE" }
      },
      "models": {
        "kilo-auto/frontier": { "name": "Auto Frontier", "limit": { "context": 1000000, "output": 128000 }, "tool_call": true },
        "kilo-auto/balanced": { "name": "Auto Balanced", "limit": { "context": 1000000, "output": 65536 }, "tool_call": true },
        "kilo-auto/free": { "name": "Auto Free", "limit": { "context": 256000, "output": 10000 }, "tool_call": true },
        "deepseek/deepseek-v4-pro": { "name": "DeepSeek: DeepSeek V4 Pro", "limit": { "context": 1048576, "output": 384000 }, "tool_call": true },
        "x-ai/grok-4.3": { "name": "xAI: Grok 4.3", "limit": { "context": 1000000, "output": 32000 }, "tool_call": true },
        "qwen/qwen3-coder-plus": { "name": "Qwen: Qwen3 Coder Plus", "limit": { "context": 1000000, "output": 65536 }, "tool_call": true },
        "z-ai/glm-5.1": { "name": "Z.ai: GLM 5.1", "limit": { "context": 202752, "output": 32000 }, "tool_call": true },
        "qwen/qwen3.7-plus": { "name": "Qwen: Qwen3.7 Plus", "limit": { "context": 1000000, "output": 65536 }, "tool_call": true },
        "nex-agi/nex-n2-pro:free": { "name": "Nex AGI: Nex-N2-Pro (free)", "limit": { "context": 262144, "output": 262144 }, "tool_call": true },
        "nvidia/nemotron-3-ultra-550b-a55b": { "name": "NVIDIA: Nemotron 3 Ultra", "limit": { "context": 1000000, "output": 16384 }, "tool_call": true }
      }
    }
  },
  "agent": {
    "architect": { "model": "anthropic/claude-opus-4-8" },
    "debugger": { "model": "anthropic/claude-opus-4-8" }
  }
}
```

- [ ] **Step 3: Create work's secret files with the WORK values**

```bash
cd ~/.config/opencode
printf '%s' '<work firecrawl key>'                    > secrets/firecrawl.key
printf '%s' 'https://firecrawl.ci.admiralbet.dev'     > secrets/firecrawl.url
printf '%s' 'https://central-jira.example.com' > secrets/jira.url
printf '%s' '<work jira token>'                       > secrets/jira.token
printf '%s' '<work stitch key>'                       > secrets/stitch.key
```

(The work `secrets/` already has `context7.key`, `github.pat`, `homeassistant.token`, `jira.token`, `stitch.key`, `firecrawl.key`, `alibaba-cloud.key`. Reuse existing values where present; only add the new `firecrawl.url` and `jira.url`, and confirm `homeassistant.url` exists — work previously hardcoded HA; if absent, add `printf '%s' 'https://home.jabbas.eu/api/mcp' > secrets/homeassistant.url`.)

- [ ] **Step 4: Validate work config**

```bash
cd ~/.config/opencode
jq empty opencode.json && jq empty opencode.local.json && echo OK
```
Expected: `OK`

- [ ] **Step 5: Smoke-test config load in both repos**

```bash
cd ~/.config/opencode-priv && OPENCODE_CONFIG="$PWD/opencode.local.json" opencode --version
cd ~/.config/opencode && OPENCODE_CONFIG="$PWD/opencode.local.json" opencode --version
```
Expected: both print a version with no config-load error. (If `opencode` is not on PATH, skip and rely on `jq` validation.)

- [ ] **Step 6: Commit in the work repo**

```bash
cd ~/.config/opencode
git add opencode.json agents/jira.md agents/stitch-mcp.md AGENTS.md secrets/README.md .gitignore docs/dev-guide.md
git commit -m "feat(config): adopt unified shared base + local model layer (mirrors opencode-priv)"
```

(Do NOT commit `opencode.local.json`, `.envrc`, or `secrets/*` — they are gitignored. Remove the `opencode.json.prev` backup once verified: `rm opencode.json.prev`.)

---

## Task 10: Final verification

- [ ] **Step 1: Confirm both configs are valid and structurally identical (minus the local layer)**

```bash
diff <(jq -S . ~/.config/opencode-priv/opencode.json) \
     <(jq -S . ~/.config/opencode/opencode.json) && echo "IDENTICAL BASE"
```
Expected: `IDENTICAL BASE` (no diff). If they differ, reconcile so the shared base is byte-equal.

- [ ] **Step 2: Confirm per-machine local layers differ only in provider/model**

```bash
diff <(jq -S 'del(.provider)' ~/.config/opencode-priv/opencode.local.json) \
     <(jq -S 'del(.provider)' ~/.config/opencode/opencode.local.json)
```
Expected: no diff (same model defaults + same architect/debugger opus overrides); only the `provider` block differs.

- [ ] **Step 3: Confirm secrets are present per machine**

```bash
for d in ~/.config/opencode-priv ~/.config/opencode; do
  echo "== $d =="; ls -1 "$d/secrets" | grep -E 'firecrawl|jira|stitch|context7|homeassistant'
done
```
Expected: each dir lists `firecrawl.key`, `firecrawl.url`, `jira.url`, `jira.token`, `stitch.key` (plus existing ones).

- [ ] **Step 4: Confirm git status is clean in both repos**

```bash
git -C ~/.config/opencode-priv status --short
git -C ~/.config/opencode status --short
```
Expected: no tracked changes pending; gitignored `opencode.local.json`/`.envrc`/`secrets/*` do not appear.

---

## Done

Both machines now run the same shared `opencode.json` base, with all model/provider
choices isolated to a gitignored, per-machine `opencode.local.json` loaded via
direnv. Per-agent model changes are a one-line edit in that file. Secrets remain
per-machine via `{file:secrets/*}`.
