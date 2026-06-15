# OpenCode Config Repo Cleanup — Design Spec

**Date:** 2026-05-10
**Goal:** Make `~/.config/opencode` a portable, version-controlled dotfiles repo. Clone + populate `.env` = ready to go on a new machine.

## Scope

Minimal cleanup — fix immediate issues without restructuring the directory layout. OpenCode dictates the directory conventions; we work within them.

## 1. Rewrite `.gitignore`

**Current state:** 4 lines, self-referencing (`.gitignore` ignores itself), missing critical patterns.

**New `.gitignore`:**

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

**Key changes:**
- `.gitignore` itself is now tracked (normal git behavior)
- `alibaba-cloud.apikey` explicitly ignored
- `session-*.md` pattern added
- `package-lock.json` added alongside `bun.lock`
- `.env` and `*.secret` for secrets files
- `.DS_Store` for macOS

## 2. Extract secrets from `opencode.json`

**Current state:** Three secrets hardcoded inline in `opencode.json`:
- `CONTEXT7_API_KEY` in `mcp.context7.headers`
- `GITHUB_PERSONAL_ACCESS_TOKEN` in `mcp.github.environment`
- Home Assistant JWT bearer token in `mcp.homeassistant.headers.Authorization`
- Additionally, `alibaba-cloud.apikey` is a standalone file

**Approach:** OpenCode supports `{env:VARIABLE_NAME}` syntax for config value interpolation. Replace hardcoded values with env var references.

**Changes to `opencode.json`:**

```json
// mcp.context7.headers
"CONTEXT7_API_KEY": "{env:CONTEXT7_API_KEY}"

// mcp.github.environment
"GITHUB_PERSONAL_ACCESS_TOKEN": "{env:GITHUB_PERSONAL_ACCESS_TOKEN}"

// mcp.homeassistant.headers
"Authorization": "Bearer {env:HOMEASSISTANT_TOKEN}"
```

**New `.env` file** (gitignored, never committed):

```
CONTEXT7_API_KEY=<actual value>
GITHUB_PERSONAL_ACCESS_TOKEN=<actual value>
HOMEASSISTANT_TOKEN=<actual value>
ALIBABA_CLOUD_API_KEY=<actual value>
```

**New machine setup:** Copy `.env.example` (committed with placeholders) to `.env` and fill in values.

Wait — since `opencode.json` itself is now safe to commit (no secrets), we don't need `opencode.json.example`. We do want a `.env.example` so you know what vars to populate:

```
CONTEXT7_API_KEY=
GITHUB_PERSONAL_ACCESS_TOKEN=
HOMEASSISTANT_TOKEN=
ALIBABA_CLOUD_API_KEY=
```

## 3. Convert skill repos to git submodules

**Current state:** Five standalone git clones in the directory, each with their own `.git`.

**Submodules to add:**

| Directory | Remote URL | Pinned Commit |
|-----------|-----------|---------------|
| `superpowers/` | `https://github.com/obra/superpowers.git` | `f2cbfbe` (v5.1.0) |
| `anthropics-skills/` | `https://github.com/anthropics/skills.git` | `f458cee` |
| `cloudflare-skills/` | `https://github.com/cloudflare/skills.git` | `60147cb` |
| `stitch-skills/` | `https://github.com/google-labs-code/stitch-skills.git` | `6c0cbdb` |
| `awesome-agent-skills/` | `https://github.com/VoltAgent/awesome-agent-skills.git` | `95fa85d` |

**Note:** Cloudflare and stitch-skills repos were originally cloned via SSH (`git@github.com:...`). Normalized to HTTPS for portability — no SSH key required on a new machine.

**Process for each:**
1. Note remote URL and current commit
2. Remove the directory
3. `git submodule add <remote-url> <directory-name>`
4. Check out the pinned commit

**Result:** `.gitmodules` file created and committed. `git clone --recurse-submodules` gets everything on a new machine.

**Symlinks unaffected:** `skills/` and `plugins/` symlinks use relative paths (`../superpowers/skills`, etc.) — they work as long as directory names stay the same.

## 4. Update `AGENTS.md`

**Stale content to fix:**

| Section | Problem |
|---------|---------|
| Lines 51-58: `skills/` layout | Lists 7 symlinks with 4 BROKEN. Reality: 4 working symlinks, no broken ones |
| Lines 73-75: broken symlinks paragraph | References `~/...` — no longer applies |
| Line 51: WARNING comment | Says "several symlinks broken" — no longer true |
| Lines 64-67: submodule labels | Says "git submodule" but they're standalone clones (will be true after this cleanup) |
| Lines 181-200: agent roster | Lists 15 agents but only 7 exist in `agents/`: `coder`, `debugger`, `default`, `designer`, `devops`, `ha`, `websearch` |
| Line 213: MCP servers | Missing `dart-mcp-server` |
| Line 212: disabled tools | References tool namespaces not present in current `opencode.json` |

**Approach:** Update all sections to match reality. Keep structure and tone.

## 5. Initial commit

Single commit: "Initial commit: clean repo setup"

All changes go in at once since there's no existing history. The ordering matters during execution (gitignore first to prevent accidental secret commits) but the final commit is one atomic snapshot.

## What stays untouched

- Directory layout
- Symlinks in `skills/` and `plugins/`
- `agents/*.md` file contents
- `docs/global-rules.md`
- `docs/plans/`

## New machine setup

```bash
git clone --recurse-submodules <repo-url> ~/.config/opencode
cp .env.example .env
# Edit .env with your actual API keys/tokens
# Install plugin deps
bun install  # or npm install
```
