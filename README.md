# OpenCode Configuration

Personal global OpenCode config: the Superpowers plugin system, skill repositories
(git submodules), custom agents, MCP servers, and memory.

This config is designed to run **identically on multiple machines** (e.g. a private
and a work laptop). The shared base (`opencode.json`, agents, skills, docs) is the
same everywhere; everything machine-specific lives in two gitignored files:
`opencode.local.json` (models/providers) and `secrets/*` (keys/URLs).

---

## How it works: shared base + local layer

| File | Tracked? | Same on every machine? | Holds |
|------|----------|------------------------|-------|
| `opencode.json` | yes | **yes (identical)** | agents, MCP servers, skills, permissions, tool gating |
| `opencode.local.json` | no (gitignored) | no | `model`, `small_model`, `provider` block, per-agent model overrides |
| `secrets/*` | no (gitignored) | no | API keys and infra URLs (`{file:secrets/...}`) |
| `.envrc` | no (gitignored) | no | optional direnv loader for `OPENCODE_CONFIG` |

At runtime OpenCode loads `opencode.json`, then deep-merges `opencode.local.json`
on top (via the `OPENCODE_CONFIG` env var). The local layer wins per-key, so it can
set models/providers without touching the shared base.

`{file:secrets/...}` references resolve **relative to the config directory**, so the
same `opencode.json` automatically reads each machine's own `secrets/`.

---

## Models

Only two model roles are used:

- **thinking** = `anthropic/claude-opus-4-8` → `architect`, `debugger`
- **default** = `anthropic/claude-sonnet-4-6` → everyone else
- **small** = `anthropic/claude-haiku-4-5`

All of this is set in `opencode.local.json`. **To change a model for one agent,
edit one line** in that file:

```json
{
  "model": "anthropic/claude-sonnet-4-6",
  "small_model": "anthropic/claude-haiku-4-5",
  "provider": { },
  "agent": {
    "architect": { "model": "anthropic/claude-opus-4-8" },
    "debugger":  { "model": "anthropic/claude-opus-4-8" }
  }
}
```

Machine-specific providers (e.g. a work-only gateway such as `kilocode`) go in the
`provider` block here — never in `opencode.json`.

---

## Setup on a new machine

### 1. Clone with submodules

```bash
git clone <repo-url> ~/.config/opencode
cd ~/.config/opencode
git submodule update --init --recursive
```

### 2. Create `opencode.local.json`

Copy the template above into `~/.config/opencode/opencode.local.json` and fill in
the `provider` block for this machine (leave `{}` if none).

### 3. Fill in secrets

Each file holds a single value with **no trailing newline** (use `printf '%s'`).
All files in `secrets/` except `README.md` are gitignored.

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

### 4. Wire up `OPENCODE_CONFIG`

Pick **one** of the options below.

---

## Running: pointing OpenCode at the local layer

OpenCode needs `OPENCODE_CONFIG` to point at `opencode.local.json`. Three ways:

### Option A — Shell alias (no extra tools)

Add to `~/.zshrc`:

```bash
alias opencode='OPENCODE_CONFIG="$HOME/.config/opencode/opencode.local.json" opencode'
```

Then `source ~/.zshrc` and just run `opencode`.

If you keep two configs side by side, use two aliases instead:

```bash
alias opencode-work='OPENCODE_CONFIG="$HOME/.config/opencode/opencode.local.json" opencode'
alias opencode-priv='OPENCODE_CONFIG="$HOME/.config/opencode-priv/opencode.local.json" opencode'
```

### Option B — direnv (automatic per directory)

[direnv](https://direnv.net/) auto-loads `OPENCODE_CONFIG` when you `cd` into the
config dir and unloads it when you leave.

```bash
brew install direnv
echo 'eval "$(direnv hook zsh)"' >> ~/.zshrc
source ~/.zshrc

cd ~/.config/opencode
direnv allow .       # approve the .envrc once
```

The committed-as-ignored `.envrc` contains:

```bash
export OPENCODE_CONFIG="$PWD/opencode.local.json"
```

### Option C — Export manually (one-off)

```bash
OPENCODE_CONFIG="$HOME/.config/opencode/opencode.local.json" opencode
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
# config is valid JSON
jq empty opencode.json && jq empty opencode.local.json && echo OK

# the local layer is being applied (run with OPENCODE_CONFIG set)
opencode --version
```

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
├── opencode.local.json    # per-machine models/providers (gitignored)
├── .envrc                 # optional direnv loader (gitignored)
├── AGENTS.md              # agent roster + conventions
├── agents/               # agent definitions (*.md)
├── docs/                 # rules, specs, plans
├── secrets/              # API keys/URLs (gitignored; {file:...} refs)
├── plugins/              # superpowers.js symlink
├── skills/               # skill-discovery symlinks
└── superpowers/, anthropics-skills/, cloudflare-skills/,
    stitch-skills/, awesome-agent-skills/   # skill submodules
```
