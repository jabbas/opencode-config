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
├── skills/                    # Skill discovery symlinks
│   ├── anthropics/            # → ../anthropics-skills/skills
│   ├── cloudflare-skills/     # → ../cloudflare-skills
│   ├── stitch-skills/         # → ../stitch-skills
│   ├── superpowers/           # → ../superpowers/skills
│   └── jenkins-cli/           # → ../jenkins-cli/skills
├── superpowers/               # Main plugin repo — git submodule (obra/superpowers, v5.1.0)
├── anthropics-skills/         # Anthropic official skills — git submodule
├── cloudflare-skills/         # Cloudflare skills — git submodule
├── stitch-skills/             # Google Stitch skills — git submodule
├── awesome-agent-skills/      # Community skills — git submodule
└── jenkins-cli/               # Jenkins CLI (jk) skill — git submodule (avivsinai/jenkins-cli)
```

**Plugin load method:** Symlink (`plugins/superpowers.js` → `superpowers/.opencode/plugins/superpowers.js`). Frontmatter parsing and skill discovery are inlined in `superpowers.js`. The plugin auto-adds `superpowers/skills/` to config at runtime.

**Secrets:** Stored in `secrets/` (gitignored), referenced via `{file:PATH}` syntax in `opencode.json`. See `secrets/README.md` for required files and setup.

**Plugins:** Loaded via `opencode.json` `plugin` array: `opencode-mnemosyne` (memory: SQLite + FTS5 + sqlite-vec) and `opencode-anthropic-oauth`. Note: `package.json` declares only `@opencode-ai/plugin` and `opencode-mnemosyne` as deps, and `package.json` itself is gitignored.

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
- **Compaction:** Auto and prune enabled with 10k reserved tokens
- **Permissions:** `edit`/`bash` default to `ask`; safe read-only commands auto-allowed globally
- **Secrets:** Referenced via `{file:...}` syntax — actual values in `secrets/` (gitignored)
- **MCP servers:** context7 (remote), github (npx, disabled), playwright (npx), pdf-reader (npx, disabled), homeassistant (remote), chrome-devtools (npx), firecrawl (npx, self-hosted), dart-mcp-server (disabled)
- **Global tool disables:** `playwright_*`, `homeassistant_*`, `chrome-devtools_*`, `firecrawl_*`, `webfetch` — re-enabled per-agent as needed

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
| Memory config | Plugin: `opencode-mnemosyne` (mnemosyne binary, SQLite + FTS5 + sqlite-vec) |
| Global rules | `docs/global-rules.md` |
| Memory rules | `docs/memory-rules.md` |

## Superpowers Skills (14 total)

Located in `superpowers/skills/`:
`brainstorming`, `dispatching-parallel-agents`, `executing-plans`, `finishing-a-development-branch`, `receiving-code-review`, `requesting-code-review`, `subagent-driven-development`, `systematic-debugging`, `test-driven-development`, `using-git-worktrees`, `using-superpowers`, `verification-before-completion`, `writing-plans`, `writing-skills`
