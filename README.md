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
opencode.json  →  opencode.jsonc  →  project config
(shared base)     (per-machine)
```

The local layer wins per-key, so it can set models/providers without touching the
shared base. **No environment variable is involved** — `opencode.jsonc` is one of
the filenames OpenCode discovers natively in the config dir. It also supports `//`
comments.

> **Do not use `OPENCODE_CONFIG`.** It only works where the variable is exported
> (e.g. from `~/.zshrc`; OpenCode Desktop, editor/ACP launches and the background
> service started by launchd don't see it — there `model` silently resolves to
> `null`), and it is merged *after* `opencode.jsonc`, so it silently overrides the
> local layer. An earlier `opencode.local.json` layer relied on it and has been
> retired. (v2 does not read `config.json` at all; only `opencode.json` /
> `opencode.jsonc`.)

`{file:secrets/...}` references resolve **relative to the config directory**, so the
same `opencode.json` automatically reads each machine's own `secrets/`.

---

## Models

Only four model roles are used:

- **thinking** = `anthropic/claude-opus-5` → `architect`, `debugger`
- **review** = a model from a *different* family, set per machine → `reviewer`
  (it takes all code review, so reviews get a second opinion and spread the cost)
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
    "debugger":  { "model": "anthropic/claude-opus-5" },
    "reviewer":  { "model": "<other-family model>" }
  }
}
```

Machine-specific providers (e.g. a work-only gateway such as `my-company`) go in the
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

#### Optional: switchable variants

If one machine needs more than one model setup (e.g. a work gateway and plain
Anthropic), keep each as a gitignored variant file and make `opencode.jsonc` a
symlink to the active one:

```bash
cd ~/.config/opencode
# variants: opencode.kilocode.json, opencode.anthropic.json, ... (gitignored: opencode.*.json)
ln -sfn opencode.kilocode.json opencode.jsonc     # switch = re-point the symlink
ls -l opencode.jsonc                               # confirm it is still a symlink
```

Restart OpenCode after switching. Note: when OpenCode itself writes global config
(e.g. settings changed from the TUI), v2 writes to `opencode.jsonc` if it exists,
else `opencode.json` — i.e. through the symlink into the active variant, not into
the shared `opencode.json`. Add shared plugins to
`opencode.json` by hand.

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

To switch to a completely separate config directory, use `XDG_CONFIG_HOME` (or, in
v2, `OPENCODE_CONFIG_DIR`). Both replace the config dir and keep project config
discovery working:

```bash
alias opencode-priv='XDG_CONFIG_HOME="$HOME/.config-priv" opencode'
# reads $HOME/.config-priv/opencode/
```

This swaps only the config dir; data/state/cache have their own `XDG_*_HOME`.

Config-related environment variables (verified in OpenCode v2.0.29 source:
`cli/src/server-process.ts`, `core/src/config.ts`, `core/src/config/discovery.ts`):

| Variable | Behaviour in v2 |
|---|---|
| `OPENCODE_CONFIG_DIR` | **Replaces** the global config dir (`Global.config`), like `XDG_CONFIG_HOME/opencode`. (In v1 it was *appended* as an extra layer — no longer true.) |
| `OPENCODE_CONFIG` | Loads one extra file, ranked above the global dir (so above `opencode.jsonc`) and below project config. Only applies where the variable is exported. Don't use it; use `opencode.jsonc`. |
| `OPENCODE_CONFIG_CONTENT` | Inline JSON config, ranked above project config. |
| `OPENCODE_DISABLE_PROJECT_CONFIG` / `OPENCODE_CONFIG_PROJECT_DISABLE` | Skip project config discovery. |

The background service (`opencode serve --service`) reads its environment when it
starts, so after changing any of these, restart the service.

Full merge order (ascending precedence):

```
remote .well-known config
  → ~/.config/opencode/{opencode.json → opencode.jsonc}
  → $OPENCODE_CONFIG
  → project files (opencode.json/jsonc, walking up from the cwd; nearest wins)
  → project .opencode/ dirs
  → $OPENCODE_CONFIG_CONTENT
  → managed config (/Library/Application Support/opencode, MDM ai.opencode.managed)
```

v2 also discovers skills/agents from `~/.claude`, `~/.agents` and their project
equivalents (Claude Code / agents-standard compatibility).

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

# reviewer really runs on its own model
opencode run --standalone --agent reviewer "Reply with OK"   # header must show the reviewer model from opencode.jsonc, not the default
```

`model`/`small_model` coming back `null` means `opencode.jsonc` is missing or not
being read.

An invalid or retired `agent.reviewer.model` id falls back silently to the default
model — run the reviewer check after setting or changing it (especially `kilo/…` ids
on the work machine).

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
├── opencode.jsonc         # per-machine models/providers (gitignored, auto-merged; may be a symlink)
├── opencode.*.json        # optional per-machine variants opencode.jsonc points to (gitignored)
├── AGENTS.md              # agent roster + conventions
├── agents/               # agent definitions (*.md)
├── docs/                 # rules, specs, plans
├── secrets/              # API keys/URLs (gitignored; {file:...} refs)
├── plugins/              # superpowers.js symlink
├── skills/               # skill-discovery symlinks
└── superpowers/, anthropics-skills/, cloudflare-skills/,
    stitch-skills/, awesome-agent-skills/   # skill submodules
```
