# Dev Guide — Working in the OpenCode Config Repo

Reference material for editing this repository (`~/.config/opencode`): plugin JS,
SKILL.md files, agent definitions, and shell scripts. Read this BEFORE making
changes here. (Moved out of AGENTS.md to keep the global system prompt lean —
see `docs/superpowers/specs/2026-06-14-agents-md-slimming-design.md`.)

---

## Repository Layout

```
~/.config/opencode/
├── opencode.json              # Main config (model, MCP servers, permissions, agents)
├── alibaba-cloud.apikey       # Root-level secret (gitignored)
├── secrets/                   # API keys and tokens (gitignored; see secrets/README.md)
├── AGENTS.md                  # This file
├── agents/                    # Custom agent definitions (19 files; + built-in `plan` in opencode.json = 20 agents — see Agent Roster)
├── docs/
│   ├── global-rules.md        # Safety rules (loaded via opencode.json instructions)
│   ├── memory-rules.md        # Memory store/recall rules (loaded via opencode.json instructions)
│   ├── plans/                 # Implementation plans
│   └── superpowers/           # Brainstorming specs and plans
├── plugins/superpowers.js     # Symlink → superpowers/.opencode/plugins/superpowers.js
├── plugins/mnemoteca.js       # File symlink → ../opencode-mnemoteca/dist/index.js (dangling until built)
├── skills/                    # Skill discovery symlinks
│   ├── anthropics/            # → ../anthropics-skills/skills
│   ├── cloudflare-skills/     # → ../cloudflare-skills
│   ├── stitch-skills/         # → ../stitch-skills
│   ├── superpowers/           # → ../superpowers/skills
│   └── jenkins-cli/           # → ../jenkins-cli/skills
├── superpowers/               # Main plugin repo — git submodule (obra/superpowers, v6.4.2 — v2-plugin-API capable, required by OpenCode ≥2.0)
├── anthropics-skills/         # Anthropic official skills — git submodule
├── cloudflare-skills/         # Cloudflare skills — git submodule
├── stitch-skills/             # Google Stitch skills — git submodule
├── awesome-agent-skills/      # Community skills — git submodule
├── jenkins-cli/               # Jenkins CLI (jk) skill — git submodule (avivsinai/jenkins-cli)
└── opencode-mnemoteca/        # Memory plugin (mnemoteca, OpenCode v2) — git submodule (jabbas/opencode-mnemoteca, branch opencode-v2); needs build
```

**Plugin load method:** Symlink (`plugins/superpowers.js` → `superpowers/.opencode/plugins/superpowers.js`). Frontmatter parsing and skill discovery are inlined in `superpowers.js`. The plugin auto-adds `superpowers/skills/` to config at runtime.

**Secrets:** Stored in `secrets/` (gitignored), referenced via `{file:PATH}` syntax in `opencode.json`. See `secrets/README.md` for required files and setup.

**Plugins:** Loaded via `opencode.json` `plugin` array. OpenCode v2 requires plugins to export a default `{ id, setup | effect }` object — v1-style function exports fail with `PluginModule.LoadError`.
- `@andrzejchm/opencode-anthropic-auth@2.3.0` (pinned) — Claude Pro/Max OAuth; maintained fork of the abandoned `opencode-anthropic-oauth` (v1-only). Imports existing logins from the old plugin. CLI: `oc-anthropic` (optional).
- `plugins/mnemoteca.js` — memory plugin: fork `jabbas/opencode-mnemoteca` (branch `opencode-v2`) as submodule `opencode-mnemoteca/`, loaded via **file symlink** `plugins/mnemoteca.js` → `../opencode-mnemoteca/dist/index.js` (not in the `plugin` array; v2.0.22 silently skips a directory plugin whose entry is only in `package.json#main`). The symlink is dangling until built: run `(cd opencode-mnemoteca && npm ci && npm run build)` after cloning and after every submodule update. Needs the binary `brew install gandazgul/tap/mnemoteca`; data in `~/.local/share/mnemoteca/mnemoteca.db`. Replaces the old `opencode-mnemosyne` (v1-only).

**OpenCode install:** via Homebrew formula `anomalyco/tap/opencode-v2` (conflicts with homebrew-core `opencode` — only one can be installed). homebrew-core's `opencode` formula and the opencode.ai install script track the 1.x line; v2 binary releases live only in the anomalyco tap. Note: `package.json` declares only `@opencode-ai/plugin` as a dep, and `package.json` itself is gitignored.

## Build / Lint / Test Commands

No traditional build system. The codebase uses Markdown, ES module JS, and Bash scripts.

### Run All Unit Tests
```bash
cd ~/.config/opencode/superpowers/tests/opencode
bash run-tests.sh
```

### Run a Single Test
```bash
cd ~/.config/opencode/superpowers/tests/opencode
bash run-tests.sh --test test-plugin-loading.sh
```

### Run with Verbose Output
```bash
bash run-tests.sh --verbose
```

### Run Integration Tests (requires OpenCode CLI)
```bash
bash run-tests.sh --integration
bash run-tests.sh --integration --test test-tools.sh
```

### Available Test Files
| Test | Type | Description |
|------|------|-------------|
| `test-plugin-loading.sh` | Unit | Plugin installation, structure, symlink |
| `test-bootstrap-caching.sh` | Unit | Bootstrap caching behavior (uses `test-bootstrap-caching.mjs`) |
| `test-priority.sh` | Integration | Skill priority resolution |
| `test-tools.sh` | Integration | use_skill and find_skills tools |

### Skill Triggering Tests
```bash
cd ~/.config/opencode/superpowers/tests/skill-triggering
bash run-all.sh                    # All tests
bash run-test.sh <skill-name>      # Single test
```

### Skill Validation
```bash
# Word count limits (getting-started: <150w, others: <500w)
wc -w superpowers/skills/<skill-name>/SKILL.md

# Verify frontmatter
head -5 superpowers/skills/<skill-name>/SKILL.md

# Render flowcharts to SVG
./superpowers/skills/writing-skills/render-graphs.js superpowers/skills/<skill-name>
```

### Skill Whitelist Consistency Check
Verifies every `permission.skill: allow` entry in `opencode.json` resolves to a
real skill on disk (or a known built-in, or a wildcard match). Run after editing
agent whitelists or updating skill submodules — catches silent drift when a skill
is renamed/removed upstream. Orphan skills (no agent whitelists them) are reported
as `[INFO]`, not failures.
```bash
bash scripts/check-skill-whitelists.sh   # exit 0 = OK, exit 1 = dead entries
```

### Permission Audit (what commands actually run)
Reads the OpenCode SQLite DB (`~/.local/share/opencode/opencode.db`, table
`part`, `$.state.input.command` where `$.tool == "bash"`) and classifies every
executed simple command as read-only vs mutating, aggregated by signature
(`git log`, `kubectl get`, `aws ec2 describe-*`). Use it to tune the
`permission.bash` allowlist against real usage instead of guesswork.
```bash
scripts/audit-bash-permissions.py                        # query default DB (~10 s)
scripts/audit-bash-permissions.py --top 120 --json /tmp/report.json
scripts/audit-bash-permissions.py --from-json export.json  # reuse an export
```

## Code Style Guidelines

### JavaScript (ES Modules)
- **Module system:** ES modules (`import`/`export`) — never CommonJS `require()`
- **`__dirname` equivalent:** `path.dirname(fileURLToPath(import.meta.url))`
- **Path handling:** `path.join()` / `path.resolve()`, never string concatenation
- **Error handling:** Try/catch with graceful fallbacks; never block bootstrap or session start
- **JSDoc:** Required for all exported functions — include `@param` and `@returns`
- **Naming:** camelCase for functions/variables; PascalCase for class/export names
- **Indentation:** 2 spaces in `superpowers.js` — match the file you're editing

### Shell Scripts (Bash)
- **Shebang:** `#!/usr/bin/env bash`
- **Strict mode:** `set -euo pipefail` at the top of every script
- **Variables:** Always quote expansions: `"$VAR"`, never `$VAR`
- **Script dir:** `SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"`
- **Test output:** `[PASS]`, `[FAIL]`, `[SKIP]` prefixes on all result lines
- **Exit codes:** 0 for success, 1 for failure

### SKILL.md Files (Markdown)
- **Required YAML frontmatter:**
  ```yaml
  ---
  name: skill-name-with-hyphens
  description: Use when [triggering condition] - never summarize the workflow
  ---
  ```
- **Frontmatter rules:** Only `name` + `description`; max 1024 chars total
- **Name format:** Lowercase letters, numbers, hyphens only
- **Description:** Third person; starts with "Use when..."; never describes internal steps
- **Encoding:** UTF-8, LF line endings, 80–100 char line width
- **H1** = skill name (matches frontmatter); **H2** sections: Overview, When to Use, Core Pattern
- **Cross-references:** `superpowers:skill-name` format — never use file paths

### Agent Definition Files (`agents/*.md`)
- YAML frontmatter with `name`, `description`, `model`, `mode`, and `tools` map
- Prose instructions follow frontmatter: guidelines, then a `Skills to use:` section
- `Skills to use:` lists skill names with a one-line trigger condition each
- All agents reference context7 MCP for documentation
- Per-agent bash permission overrides are in `opencode.json` under `agent.<name>`

### Naming Conventions
- **Skill directories:** Verb-first hyphenated: `using-git-worktrees`, `requesting-code-review`
- **Agent definitions:** `agents/<name>.md`
- **Session files:** `session-<id>.md` — ephemeral, do not commit (gitignored)

## Configuration: opencode.json

- **Default model:** `anthropic/claude-sonnet-4-6`
- **Small model:** `anthropic/claude-haiku-4-5`
- **Instructions:** `docs/global-rules.md`, `docs/memory-rules.md`
- **Compaction:** Auto enabled with 10k reserved tokens
- **Permissions:** `edit`/`bash` default to `ask`; safe read-only commands auto-allowed globally
- **Secrets:** Referenced via `{file:...}` syntax — actual values in `secrets/` (gitignored)
- **MCP servers:** context7 (remote), github (npx, disabled), playwright (npx), pdf-reader (npx, disabled), homeassistant (remote), chrome-devtools (npx), firecrawl (npx, self-hosted), dart-mcp-server (disabled), grafana-dev/grafana-test/grafana-stage (`mcp-grafana` via Homebrew, read-only `--disable-write`; prod not wired — no service account)
- **Global tool disables:** `playwright_*`, `homeassistant_*`, `chrome-devtools_*`, `firecrawl_*`, `grafana-dev_*`, `grafana-test_*`, `grafana-stage_*`, `webfetch` — re-enabled per-agent as needed (the three grafana-* tool sets are enabled only on `debugger`)

## Error Handling Patterns

- **Plugin bootstrap:** Never throw; wrap in try/catch and return graceful defaults
- **Network operations:** Use short timeouts (e.g., `git fetch` with 3 s timeout via `execSync`)
- **File operations:** Always `fs.existsSync()` before reading; return `{ name:'', description:'' }` on failure
- **Test assertions:** Pattern-match output with grep; emit `[PASS]`/`[FAIL]` prefixes

## Key Files for Agents

| Purpose | File |
|---------|------|
| OpenCode config | `opencode.json` |
| Active plugin | `plugins/superpowers.js` (symlink) |
| Plugin source | `superpowers/.opencode/plugins/superpowers.js` |
| Install/migration guide | `superpowers/.opencode/INSTALL.md` |
| Test runner | `superpowers/tests/opencode/run-tests.sh` |
| Default agent | `agents/default.md` (name: `general`) |
| Skill writing guide | `superpowers/AGENTS.md` |
| Memory config | Plugin: `plugins/mnemoteca.js` → `opencode-mnemoteca` fork (mnemoteca binary, SQLite + FTS5 + sqlite-vec; DB `~/.local/share/mnemoteca/mnemoteca.db`) |
| Global rules | `docs/global-rules.md` |
| Memory rules | `docs/memory-rules.md` |

## Superpowers Skills (14 total)

Located in `superpowers/skills/`:
`brainstorming`, `dispatching-parallel-agents`, `executing-plans`, `finishing-a-development-branch`, `receiving-code-review`, `requesting-code-review`, `subagent-driven-development`, `systematic-debugging`, `test-driven-development`, `using-git-worktrees`, `using-superpowers`, `verification-before-completion`, `writing-plans`, `writing-skills`
