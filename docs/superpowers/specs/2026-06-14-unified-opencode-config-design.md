# Unified OpenCode Config (priv ↔ work) — Design

## Problem & Goal

Two OpenCode config repos exist on two machines:

- `~/.config/opencode-priv` — the **private** machine's config. Newer, cleaner
  architecture: richer agent roster (`architect`, `autopilot`, `cloudflare`,
  `frontend`, `writer`, `skill-smith`), per-agent skill whitelists (token
  optimization), `task.autopilot:deny` containment, and infra-as-secrets
  indirection (`{file:secrets/*.url}`).
- `~/.config/opencode` — the **work** machine's config. Has work-specific tools,
  models, and integrations the private config lacks: `work-provider` + `kilocode`
  providers, `jira` (mcp-atlassian) + `stitch` MCP servers, firecrawl with an API
  key, and MCP-operator agents (`jira`, `stitch`).

**Goal:** a single shared setup that runs **identically** in both directories,
while allowing:

1. **Different providers/models per machine** (work: work-provider/kilocode; private:
   its own/none).
2. **Easy per-agent model switching.** In practice only two model roles are used:
   "thinking" = opus (`architect`, `debugger`) and "default" = sonnet (everyone
   else).

The private config's architecture is the base. Work-specific tools/models/agents
are ported in additively. Machine-specific variation is isolated to a thin local
layer plus secrets.

## Approach

**Base + thin local layer**, validated against the OpenCode source
(`~/Projects/opencode`):

- `OPENCODE_CONFIG` is loaded **after** the base config and deep-merged
  (`mergeDeep`, remeda), so the local layer wins per-key
  (`packages/opencode/src/config/config.ts:398–401`).
- `agent.<name>.model` set in the local layer overrides the base without touching
  that agent's permissions or skills.
- `{file:relative}` resolves against the **config file's own directory**
  (`packages/opencode/src/config/variable.ts:66`), so identical config text reads
  per-machine secrets. `{file:~/...}` expands `~` to home.
- OpenCode has **no native model-alias feature** — a model is a plain
  `provider/model` string per agent. "Easy per-agent switching" therefore comes
  from config structure (the local layer), not a built-in alias.

Rejected alternatives:

- **Identical `opencode.json` bit-for-bit, no local layer** — impossible once
  providers/models must differ per machine.
- **`OPENCODE_CONFIG_DIR` second dir** — heavier; a single explicit local file is
  simpler.
- **Inline per-machine `provider`/`model` directly in `opencode.json`** — breaks
  the "identical base" property and forces manual merging on sync.

## Architecture

### 1. Shared `opencode.json` (identical bit-for-bit in both repos)

- **Base** = current private architecture (agents, skill whitelists, `autopilot`,
  `task.autopilot:deny`) — preserved unchanged.
- **Ported from work (additive):**
  - MCP servers `jira` (mcp-atlassian) and `stitch` (`@_davideast/stitch-mcp
    proxy`) added.
  - `firecrawl` MCP updated to use **both** `FIRECRAWL_API_URL={file:secrets/firecrawl.url}`
    **and** `FIRECRAWL_API_KEY={file:secrets/firecrawl.key}`.
  - `jira` MCP URL via `{file:secrets/jira.url}`, token via
    `{file:secrets/jira.token}` (work hardcodes the URL; we follow the private
    "infra URL = secret" convention).
  - `stitch` MCP key via `{file:secrets/stitch.key}`.
  - Global `tools` block gains `"jira_*": false` and `"stitch_*": false` (disabled
    globally, re-enabled per operator agent — matches the existing pattern).
- **Agents carry no `model` key** — the model comes from the local layer.
- `instructions` → **relative paths** (`docs/global-rules.md`,
  `docs/memory-rules.md`) so the file is identical and correct in both repos.
- All URLs/keys via `{file:secrets/*}`.
- **No machine-specific `provider` block** in the base — providers live in the
  local layer.

### 2. `opencode.local.json` (per machine, gitignored, loaded via `OPENCODE_CONFIG`)

Single place for all model/provider decisions.

- `model` = `anthropic/claude-sonnet-4-6` (default), `small_model` =
  `anthropic/claude-haiku-4-5`.
- `provider` = machine-specific block (work: `work-provider` + `kilocode`; private:
  its own or empty).
- `agent.<name>.model` set **only for deviations**: `architect` and `debugger` →
  `anthropic/claude-opus-4-8`. Everyone else inherits the global `model` (sonnet).

Changing an agent's model = edit one line here. Re-classifying an agent between
"thinking" and "default" = move one line.

**Work `opencode.local.json`:**

```jsonc
{
  "model": "anthropic/claude-sonnet-4-6",
  "small_model": "anthropic/claude-haiku-4-5",
  "provider": {
    "work-provider": { /* ...verbatim from current work opencode.json... */ },
    "kilocode":  { /* ...verbatim from current work opencode.json... */ }
  },
  "agent": {
    "architect": { "model": "anthropic/claude-opus-4-8" },
    "debugger":  { "model": "anthropic/claude-opus-4-8" }
  }
}
```

**Private `opencode.local.json`:**

```jsonc
{
  "model": "anthropic/claude-sonnet-4-6",
  "small_model": "anthropic/claude-haiku-4-5",
  "provider": { /* private/empty */ },
  "agent": {
    "architect": { "model": "anthropic/claude-opus-4-8" },
    "debugger":  { "model": "anthropic/claude-opus-4-8" }
  }
}
```

### 3. `.envrc` (direnv) in each config dir

```bash
export OPENCODE_CONFIG="$PWD/opencode.local.json"
```

Entering the directory activates the local layer automatically. Absolute path via
`$PWD` so OpenCode loads it regardless of where `opencode` is invoked from. Present
in **both** `~/.config/opencode-priv` and `~/.config/opencode`.

### 4. Agents ported from work

- **`jira`** — MCP operator, ported as-is: `tools.jira_*: true`, `bash: deny`,
  skill whitelist `{"*": "deny", "using-superpowers": "allow"}` (matches private
  token-optimization convention). Both `agents/jira.md` and the `opencode.json`
  agent entry.
- **`stitch-mcp`** — a **separate** MCP-operator agent (the private skill-driven
  `stitch` agent stays untouched). Configured like the other private operator
  agents (e.g. `ha`/`jira`): `tools.stitch_*: true`, `bash: deny`, skill whitelist
  `{"*": "deny", "using-superpowers": "allow"}`. New `agents/stitch-mcp.md`
  (work's stitch-operator prose, renamed).

### 5. Secrets (per machine, gitignored)

New secret files (values differ per machine): `firecrawl.key`, `firecrawl.url`,
`jira.url`, `jira.token`, `stitch.key`. Update `secrets/README.md` with rows and
`printf` setup lines for each.

### 6. Docs

- `AGENTS.md` — add `jira` and `stitch-mcp` to the roster; document the new MCP
  servers, the base + local-layer model architecture, and the direnv mechanism.
- Bring `docs/dev-guide.md` to parity in the work repo (present in private, absent
  in work).

## Files Changed / Added

Applied identically to **both** repos (`opencode-priv` first, then mirrored to
`opencode`), except `opencode.local.json`, `.envrc`, and `secrets/*` which hold
per-machine values.

| Path | Change |
|------|--------|
| `opencode.json` | Add jira/stitch MCP; firecrawl url+key; global `jira_*`/`stitch_*` false; add `jira` + `stitch-mcp` agents; relative `instructions`; strip machine `provider`/`model` (moved to layer) |
| `opencode.local.json` | **New**, gitignored — model defaults, provider block, opus for architect/debugger |
| `.envrc` | **New** — `export OPENCODE_CONFIG="$PWD/opencode.local.json"` |
| `agents/jira.md` | **New** (port from work) |
| `agents/stitch-mcp.md` | **New** (port work's stitch operator, renamed) |
| `secrets/README.md` | Add rows + setup for firecrawl.key/url, jira.url/token, stitch.key |
| `secrets/{firecrawl.key,firecrawl.url,jira.url,jira.token,stitch.key}` | **New**, gitignored, per-machine values |
| `.gitignore` | Ensure `opencode.local.json` and `.envrc` are ignored |
| `AGENTS.md` | Roster + new MCP + model-layer + direnv docs |
| `docs/dev-guide.md` | (work repo only) bring to parity |

## How Requirements Are Met

- **Different providers/models per machine** → entire `provider` block + `model`
  live in `opencode.local.json`, different per machine.
- **Easy per-agent model switching** → one file, one `agent.<name>.model` key per
  deviation; sonnet is the default, opus is opt-in for architect/debugger.
- **Identical shared base** → `opencode.json`, agents, MCP, skills, permissions
  are byte-identical in both repos.
- **Per-machine secrets** → `{file:secrets/*}`, gitignored.

## Source-Verified Mechanics

- `OPENCODE_CONFIG` loaded after base, deep-merged, layer wins —
  `config.ts:398–401`, `mergeDeep` at `config.ts:42`.
- `{file:relative}` resolves to config-file dir; `~/` expands to home —
  `variable.ts:62–66`.
- `instructions` arrays are unioned across configs — `config.ts:47–48`.
- No native model aliases (grep across `packages/` found none) — model is a plain
  per-agent string.

## Out of Scope

- Migrating the `superpowers` submodule version difference (private is 1 commit
  ahead after a `git pull`; harmless).
- Cleaning up the work repo's uncommitted `opencode.json` and `opencode.json.bak*`
  files (separate housekeeping; the current on-disk `opencode.json` is treated as
  the source of truth for the port).
- Any non-model, non-secret per-machine config divergence (none exists today;
  YAGNI).
