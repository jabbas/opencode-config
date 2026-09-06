# OpenCode Configuration

Personal global OpenCode config: the Superpowers plugin system, skill repositories
(git submodules), custom agents, MCP servers, and memory.

This config is designed to run **identically on multiple machines** (e.g. a private
and a work laptop). The shared base (`opencode.json`, agents, skills, docs) is the
same everywhere; everything machine-specific lives in two gitignored places:
`opencode.jsonc` (models/providers) and `secrets/*` (keys/URLs).

---

## How it works: shared base + local layer

| File | Tracked? | Same on every machine? | Holds |
|------|----------|------------------------|-------|
| `opencode.json` | yes | **yes (identical)** | agents, MCP servers, skills, permissions, tool gating |
| `opencode.jsonc` | no (gitignored) | no | `model`, `small_model`, `provider` block, per-agent model overrides |
| `secrets/*` | no (gitignored) | no | API keys and infra URLs (`{file:secrets/...}`) |

At runtime OpenCode auto-loads and deep-merges, in ascending precedence:

```
config.json  →  opencode.json  →  opencode.jsonc  →  project config
                (shared base)     (per-machine)
```

The local layer wins per-key, so it can set models/providers without touching the
shared base. **No environment variable is involved** — `opencode.jsonc` is one of
the filenames OpenCode discovers natively in the config dir. It also supports `//`
comments.

> **Do not use `OPENCODE_CONFIG`.** Pointing it at a config file silently disables
> project-level config discovery: a repo's own `opencode.json`/`.opencode/opencode.jsonc`
> is ignored without warning. An earlier `opencode.local.json` layer relied on it and
> has been retired.

`{file:secrets/...}` references resolve **relative to the config directory**, so the
same `opencode.json` automatically reads each machine's own `secrets/`.

---

## Models

Only three model roles are used:

- **thinking** = `anthropic/claude-opus-5` → `architect`, `debugger`
- **default** = `anthropic/claude-sonnet-5` → everyone else
- **small** = `anthropic/claude-haiku-4-5`

All of this is set in `opencode.jsonc`. **To change a model for one agent,
edit one line** in that file:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "model": "anthropic/claude-sonnet-5",
  "small_model": "anthropic/claude-haiku-4-5",
  "provider": { },
  "agent": {
    "architect": { "model": "anthropic/claude-opus-5" },
    "debugger":  { "model": "anthropic/claude-opus-5" }
  }
}
```

Machine-specific providers (e.g. a work-only gateway such as `kilocode`) go in the
`provider` block here — never in `opencode.json`.

A few agent models are pinned in the shared `opencode.json` instead, because they
should be identical on every machine (currently `autopilot` → sonnet, `architect`
→ opus). `opencode.jsonc` can still override them locally.

---

## Setup on a new machine

### 1. Clone with submodules

```bash
git clone <repo-url> ~/.config/opencode
cd ~/.config/opencode
git submodule update --init --recursive
```

### 2. Create `opencode.jsonc`

Copy the template above into `~/.config/opencode/opencode.jsonc` and fill in
the `provider` block for this machine (leave `{}` if none). It is picked up
automatically — nothing else to wire up.

### 3. Fill in secrets

Each file holds a single value with **no trailing newline** (use `printf '%s'`).
All files in `secrets/` except `README.md` are gitignored.

If OpenCode fails with `bad file reference`, create all missing placeholder
files first:

```bash
bash scripts/init-secret-placeholders.sh
```

The placeholders only satisfy config validation. Fill in real values for the MCP
servers you want to use.

| File | Description |
|------|-------------|
| `context7.key` | Context7 API key |
| `github.pat` | GitHub Personal Access Token (only if the `github` MCP is enabled) |
| `homeassistant.token` | Home Assistant long-lived token (without `Bearer ` prefix) |
| `homeassistant.url` | Home Assistant MCP endpoint URL |
| `firecrawl.url` | Firecrawl MCP base URL |
| `firecrawl.key` | Firecrawl MCP API key |
| `jira.url` | Jira base URL (Atlassian MCP) |
| `jira.token` | Jira personal access token |
| `stitch.key` | Google Stitch API key |
| `alibaba-cloud.key` | Alibaba Cloud API key (optional) |

```bash
cd ~/.config/opencode
printf '%s' 'your-key'                            > secrets/context7.key
printf '%s' 'your-jwt'                            > secrets/homeassistant.token
printf '%s' 'https://ha.example.com/api/mcp'      > secrets/homeassistant.url
printf '%s' 'https://firecrawl.example.internal'  > secrets/firecrawl.url
printf '%s' 'your-firecrawl-key'                  > secrets/firecrawl.key
printf '%s' 'https://jira.example.internal'       > secrets/jira.url
printf '%s' 'your-jira-token'                     > secrets/jira.token
printf '%s' 'your-stitch-key'                     > secrets/stitch.key
```

### 4. Run it

Nothing to wire up — just run `opencode`. The local layer is discovered
automatically.

### Side-by-side configs

To switch to a completely separate config directory, use `XDG_CONFIG_HOME`. It
genuinely replaces `Path.config` and keeps project config discovery working
(verified empirically):

```bash
alias opencode-priv='XDG_CONFIG_HOME="$HOME/.config-priv" opencode'
# reads $HOME/.config-priv/opencode/
```

This swaps only the config dir; data/state/cache have their own `XDG_*_HOME`.

Two variables that look like they'd do this, but **don't**:

| Variable | Actual behaviour |
|---|---|
| `OPENCODE_CONFIG` | Loads one extra file — and **silently disables project config discovery**. Never use it. |
| `OPENCODE_CONFIG_DIR` | Does **not** replace the config dir. `~/.config/opencode` still loads in full; the given dir is *appended* as the highest-priority layer, overriding even project config. OpenCode also writes `.gitignore`/`package.json`/`node_modules/` into it (treats it as a plugin dir). |

Full merge order (ascending precedence):

```
~/.config/opencode/{config.json → opencode.json → opencode.jsonc}
  → $OPENCODE_CONFIG
  → project config (opencode.json/jsonc walking up the tree)
  → .opencode/ dirs + $OPENCODE_CONFIG_DIR
```

---

## Agents

See `AGENTS.md` for the full agent roster, per-agent skill whitelists, and MCP
wiring. Key points:

- MCP tools are disabled globally in `opencode.json` (`tools` block) and
  re-enabled only inside their specialist agent (`ha`, `jira`, `stitch-mcp`,
  `webscraper`/`webresearcher`/`webmonitor`, `webdebugger`).
- `jira` and `stitch-mcp` are MCP-operator agents; `stitch` is the separate
  skill-driven design-to-code agent.

---

## Verifying the setup

```bash
# config is valid JSON (opencode.jsonc may contain // comments)
jq empty opencode.json && echo OK

# the local layer is actually being applied
opencode debug config > /tmp/cfg.json      # ~70 KB; don't pipe straight to jq
jq '{model, small_model, architect: .agent.architect.model}' /tmp/cfg.json

# per-agent resolution
opencode debug agent architect
```

`model`/`small_model` coming back `null` means `opencode.jsonc` is missing or not
being read.

To confirm two machines share an identical base:

```bash
diff <(jq -S . ~/.config/opencode-priv/opencode.json) \
     <(jq -S . ~/.config/opencode/opencode.json) && echo "IDENTICAL BASE"
```

---

## Layout

```
~/.config/opencode/
├── opencode.json          # shared base (tracked, identical everywhere)
├── opencode.jsonc         # per-machine models/providers (gitignored, auto-merged)
├── AGENTS.md              # agent roster + conventions
├── agents/               # agent definitions (*.md)
├── docs/                 # rules, specs, plans
├── secrets/              # API keys/URLs (gitignored; {file:...} refs)
├── plugins/              # superpowers.js symlink
├── skills/               # skill-discovery symlinks
└── superpowers/, anthropics-skills/, cloudflare-skills/,
    stitch-skills/, awesome-agent-skills/   # skill submodules
```
