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
├── agents/                    # Custom agent definitions (21 files; + built-in `plan` in opencode.json = 22 agents — see Agent Roster)
├── docs/
│   ├── global-rules.md        # Safety rules (loaded via opencode.json instructions)
│   ├── memory-rules.md        # Memory store/recall rules (loaded via opencode.json instructions)
│   ├── design-principles.md   # Design principles (loaded via opencode.json instructions)
│   ├── plans/                 # Implementation plans
│   └── superpowers/           # Brainstorming specs and plans
├── plugins/superpowers.js     # Symlink → superpowers/.opencode/plugins/superpowers.js
├── plugins/shell-style.js     # Local plugin: tightens shell permission decisions (see "shell-style plugin")
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

**Plugins:** Loaded via `opencode.json` `plugins` array (v1 key `plugin`, deprecated). OpenCode v2 requires plugins to export a default `{ id, setup | effect }` object — v1-style function exports fail with `PluginModule.LoadError`.
- `@andrzejchm/opencode-anthropic-auth@2.3.0` (pinned) — Claude Pro/Max OAuth; maintained fork of the abandoned `opencode-anthropic-oauth` (v1-only). Imports existing logins from the old plugin. CLI: `oc-anthropic` (optional).
- `github:jabbas/opencode-kilo-gateway#<sha>` (pinned commit, branch `opencode-v2`) — Kilo gateway provider; fork of `dragenet/opencode-kilo-gateway` with the v2 port. Installed from git by OpenCode itself, no local build: `dist/` is committed in the fork and its compile script is named `compile`, not `build` (npm's git fetcher would otherwise try to "prepare" the package and fail). Update: in the fork `yarn compile`, commit `dist/`, push, then bump the SHA here. Remote tarball URLs do NOT work as plugin specs in v2.0.29.
- `plugins/mnemoteca.js` — memory plugin: fork `jabbas/opencode-mnemoteca` (branch `opencode-v2`) as submodule `opencode-mnemoteca/`, loaded via **file symlink** `plugins/mnemoteca.js` → `../opencode-mnemoteca/dist/index.js` (not in the `plugins` array; v2.0.22 silently skips a directory plugin whose entry is only in `package.json#main`). The symlink is dangling until built: run `(cd opencode-mnemoteca && npm ci && npm run build)` after cloning and after every submodule update. Needs the binary `brew install gandazgul/tap/mnemoteca`; data in `~/.local/share/mnemoteca/mnemoteca.db`. Replaces the old `opencode-mnemosyne` (v1-only).

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
| `test-session-bootstrap.sh` | Unit | v2 bootstrap injection across sessions (uses `test-session-bootstrap.mjs`) |
| `test-skill-registration.sh` | Unit | v2 `setup()` skill registration contract (uses `test-skill-registration.mjs`) |
| `test-priority.sh` | Integration | Duplicate skill-ID behavior (local vs bundled) |
| `test-tools.sh` | Integration | Native `skill` tool loads personal, project and bundled skills |

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
Verifies every non-`deny` skill whitelist entry in `opencode.json`
(`agents.<name>.permissions` rules with `action: "skill"`) resolves to a
skill **ID** OpenCode v2 discovers (or a built-in `opencode`/`report`, or a wildcard
match). Mirrors v2 discovery: only `skill/` and `skills/` (symlinks followed) plus
config `skills` paths; ID = parent dir of `SKILL.md`, not the frontmatter `name:`.
Run after editing agent whitelists or updating skill submodules — catches silent
drift when a skill is renamed/removed upstream. Duplicate IDs are `[WARN]`, orphan
skills (no agent whitelists them) `[INFO]`; neither fails.
```bash
bash scripts/check-skill-whitelists.sh        # exit 0 = OK, exit 1 = dead entries
bash scripts/test-check-skill-whitelists.sh   # fixture test for the checker
```

### Permission Audit (what commands actually run)
Reads the OpenCode SQLite DB (`~/.local/share/opencode/opencode.db`, table
`part`, `$.state.input.command` where `$.tool == "bash"`) and classifies every
executed simple command as read-only vs mutating, aggregated by signature
(`git log`, `kubectl get`, `aws ec2 describe-*`). Use it to tune the
`shell` rules in `permissions` against real usage instead of guesswork.
```bash
scripts/audit-bash-permissions.py                        # query default DB (~10 s)
scripts/audit-bash-permissions.py --top 120 --json /tmp/report.json
scripts/audit-bash-permissions.py --from-json export.json  # reuse an export
```
Periodic review procedure (ask rate, remaining asks, saved "Always" approvals): `docs/permission-review.md`.

### shell-style plugin (`plugins/shell-style.js`)
Dependency-free OpenCode v2 plugin (`export default { id, setup }` + named export
`analyze(command, { cwd, tmpRoots, home })`) that **tightens** `shell` permission
decisions for shapes the wildcard rules cannot judge, with an explanatory
`shell-style: …` message back to the model:
- **deny** — shell function definitions (`f() {`, `function f {`); a variable as the command
  word after `NAME=v` assignments (`X=1 $sh w.sh`, `$K get`); an **unquoted** filter expression
  — the sequence `[?(` outside quotes (`-o jsonpath={.items[?(@.x=="y")].name}`,
  `custom-columns=…[?(@.name==\"r\")]`): the parentheses parse as a subshell and zsh fails on the glob;
  **agent-authored text written to a file outside tmp** — a stdout redirect (`>`, `>>`, `>|`, `&>`)
  on `echo`/`printf` (incl. `builtin echo`) or on `cat` fed by a heredoc/herestring, `tee FILE` fed
  by a heredoc/herestring or piped from `echo`/`printf`/`cat <<EOF`, and `{ …; } > f` / `( … ) > f`
  groups made only of such commands (any other command in the group → not flagged). Targets in tmp
  roots, `/dev/*`, fd dups (`>&2`), unresolvable targets (unknown `$VAR`/cwd) and real tool output
  (`cargo test > log`, `cat a b > c`) are not flagged; `echo "$(cmd)" > f` is flagged;
  an **`env VAR=… cmd` prefix** (rules see `env`, not the command; `env`, `env | grep`, `env -u X`,
  `printenv` and bare `VAR=x cmd` are not flagged); a **redirect with no command** (`: > f`, `> f`,
  `>> f`) to a file outside tmp (`done > f`, `} > f`, `( … ) > f` and `cmd > f` are not bare).
- **ask** — scripts run from `$TMPDIR` / `/tmp` / `/var/folders/*/*/T` (`sh w.sh` after
  `cd $TMPDIR`, `./x.sh`, `bash /tmp/x.sh`) and sourced ones (`source $TMPDIR/env.sh`,
  `. ./x.sh` after `cd $TMPDIR`); `sh -c …`, `sh <(…)` and `source <(…)` are left to the config.

It hooks `tool.execute.before` (stashes the command by call id) and `permission.evaluate`
(looks it up via `source.id`) and only moves a decision allow→ask/deny or ask→deny; it never
loosens and never touches an incoming `deny`. **Fail-open:** any exception is logged once
(`[shell-style] …`) and the event is left unchanged, so the config rules still govern.
Quoted strings, heredoc bodies and comments are ignored; `$( )`, backticks and `<( )` are
analysed recursively.
```bash
node --test scripts/test-shell-style.mjs                 # unit tests (analyze + wiring with a fake ctx)
SHELL_STYLE_PLUGIN=/abs/dev-copy.js node --test scripts/test-shell-style.mjs   # test a dev copy
node --check plugins/shell-style.js
```
> ⚠ **Every save of a file in `plugins/` hot-reloads the whole OpenCode server and can kill
> running sessions.** Develop and test on a copy under `$TMPDIR` (point the tests at it with
> `SHELL_STYLE_PLUGIN`), then write `plugins/shell-style.js` once. The `edit` permission asks
> for `plugins/**` and bash writes to `plugins/shell-style*` ask, as a speed bump.
> After the save, check `~/.local/share/opencode/log/opencode.log` for a clean reload.

### permission-model plugin (`plugins/permission-model/`)
Successor of `shell-style` (which stays until Task 10 removes it). Dependency-free OpenCode v2
**directory** plugin (`index.js` entrypoint) implementing permission model v2 — spec:
`docs/superpowers/specs/2026-10-22-permission-model-v2-design.md`; module overview and loader
details: `plugins/permission-model/README.md`.

**What it decides.** For every `shell`, `read`, `edit` and `write` permission request it parses the
command (unwraps `sudo`/`env`/`sh -c`/…, resolves variables best-effort), classifies it (read,
local-write, ext-write, irreversible, secret, opaque, …) and the **target** it acts on (kubectl
context, AWS profile, GitHub repo, … → class `dev` / `home` / `prod` / `unknown`, unknown = prod), and
produces `allow` / `ask` / `deny`. It reconciles that with the incoming `effect` (config + saved approvals)
and, in enforce mode, can both tighten and loosen it. Fail-safe: any error or a decision slower than
250 ms yields an `ERROR` log line and, **in enforce mode only**, `ask` (never `allow`); in shadow the
request is left untouched and the error is only logged.

**Modes** (`mode` in the config; default `shadow`):
- `shadow` — only logs what the plugin *would* decide next to what the config decided; `ev.effect` is
  never touched, so today's `opencode.json` rules keep enforcing.
- `enforce` — the plugin's decision is applied (`ev.effect`, plus an explanatory `ev.message`). Switched on
  only together with the slim `opencode.json` in one commit (spec §6).

**Config:** `permission-model.json` (shared, committed) + `permission-model.local.json` (per machine,
gitignored; arrays **replace**, objects deep-merge — e.g. work profiles in `targets.dev|prod`). Reloaded
at most every 10 s. A broken file → `CONFIG_ERROR` log line; with enforce known/configured the plugin
asks for everything until it is fixed. Env overrides for tests/ops: `PM_CONFIG_DIR`, `PM_LOG_FILE`,
`PM_ALIVE_FILE`.

**Log + alive marker** (`~/.local/share/opencode/permission-model/`):
- `decisions.jsonl` — one JSON line per request: `{ ts, sessionID, agent, action, resource, cls,
  target:{kind,name,cls}, incoming, decided, applied, mode, reason, ms }` (heredoc bodies and
  `password|token|secret=` values are redacted, resource ≤ 300 chars). Special `cls`: `ERROR`, `CONFIG_ERROR`.
- `alive` — `{pid, ts, mode}` rewritten at most every 10 s. `node scripts/permission-model/check-alive.mjs`
  prints age / mode / pid and exits 1 when the marker is missing or older than 300 s (use it after any
  plugin edit and in session start checks).
- Report: `node scripts/permission-model/log-report.mjs [file] [--since ISO] [--json]` — counts by
  mode/action/agent, `wouldChange` (allow→ask = new questions, ask→allow = questions that disappear,
  →deny, deny kept), top asks with example commands, errors, active hours (sum of gaps ≤ 5 min) and
  asks/hour for config vs plugin. Review the shadow report before switching to `enforce`.

**"Always" is ineffective for some classes.** The hook only sees the merged `effect` (config + saved
approvals), so the plugin decides per class (`reconcile` in `decide.js`). A saved approval is
**honoured only** for `local-read`, `local-write`, `ext-read`, and `ext-write` on a dev/home target.
For every other class it is **ignored** (the request is evaluated every time): prod/unknown writes,
`irreversible`, `secret-ask`, `own-config`, `opaque` and `local-ask`. The "Always" button is still
shown in the prompt but has no effect there (for secret reads native `read` saves the approval as
`*`, which would otherwise unlock every read). An incoming `deny` is never weakened.

**Develop on a copy** — every save of a file under `plugins/` hot-reloads the plugin and can restart
the server. Work in `$TMPDIR`, point the tests at the copy with `PM_PLUGIN_DIR`, copy over once.
```bash
node --test scripts/permission-model/                      # all unit tests (parser, unwrap, target, classify, decide, paths, config, plugin, replay, log-report)
node --test scripts/permission-model/test-log-report.mjs   # report only
PM_PLUGIN_DIR=$TMPDIR/opencode/pm-dev/permission-model node --test scripts/permission-model/
PM_STRICT=1 node --test scripts/permission-model/test-replay.mjs   # known divergences not tolerated
node scripts/permission-model/replay.mjs                   # replay the audit corpus through decideShell (see fixtures/README.md)
```
Replay fixtures (`fixtures/audit-commands*.json`, `expected-decisions.json`, `known-divergences.json`)
hold real commands and are generated locally / gitignored; tests that need them skip on a fresh clone.

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
- Per-agent shell/edit/skill permission overrides are in `opencode.json` under `agents.<name>.permissions`

### Naming Conventions
- **Skill directories:** Verb-first hyphenated: `using-git-worktrees`, `requesting-code-review`
- **Agent definitions:** `agents/<name>.md`
- **Session files:** `session-<id>.md` — ephemeral, do not commit (gitignored)

## Configuration: opencode.json

- **Models:** not set in `opencode.json` — no model pins at all, per-agent or global. Each machine sets every model in its gitignored `opencode.jsonc` (`agents.title.model` is where v1 `small_model` now lives; private machine uses `kilo/…` models, see `docs/model-selection.md`). A `model` pin in `opencode.json` would win over `opencode.jsonc` and silently stop per-machine control — the old `architect`/`autopilot` pins were removed for exactly that reason. `reviewer` stays on a different model family than the implementing agents (currently `kilo/openai/gpt-6.2-sol` on the private machine)
- **Instructions:** `~/.config/opencode/docs/global-rules.md`, `~/.config/opencode/docs/memory-rules.md`, `~/.config/opencode/docs/design-principles.md` (absolute `~/` paths because v2 resolves relative `instructions` with `globUp` from the session directory up to the project root — `core/src/config/plugin/instruction.ts` — so relative entries silently don't load outside this repo)
- **Compaction:** Auto enabled with a 10k token buffer (`buffer`; v1 key `reserved`)
- **Permissions:** one flat **`permissions` array** of `{"action","resource","effect"}` rules (v2 canonical; the v1 `permission` + `tools` objects are migrated to it at load). `action` is the tool family — `shell` (v1 `bash`), `edit`, `read`, `subagent` (v1 `task`), `skill` — or a tool name such as `webfetch`. **Array order is precedence order** (last match wins), and global rules are prepended to every agent's rules, so `agents.<name>.permissions` overrides global ones. Baseline: `shell` `*` = `ask` (safe/common commands auto-allowed globally); `edit` = `allow` except OpenCode config + secrets (`opencode.json`, `opencode.jsonc*`, `opencode.*.json`, `agents/**`, `secrets/**` — absolute `~/.config/opencode/...` and cwd-relative variants — plus project config dirs `.opencode/**` / `*/.opencode/**`, and `~/.config/opencode/{plugins,scripts}/**` with cwd-relative `plugins/**` / `scripts/**` — the relative forms also ask in other repos with top-level `plugins/` or `scripts/` dirs) which `ask`. Do NOT put `write:`/`edit: true` in `agents/*.md` `tools:` — it becomes a trailing `edit * allow` that overrides those asks (md agent rules load after `opencode.json`; last match wins). Shell writes to the same paths are a `shell` speed-bump: global `ask` rules for `*>*P*`, `tee`/`sed -i`/`perl -i`/`cp`/`mv`/`ln`/`install *P*` with P ∈ `.config/opencode/`, `opencode.json`, `agents/`, `secrets/`, `.opencode/`; agents with their own trailing `shell` allows (debugger, devops, jenkins, ha, writer) repeat the `*>*P*` asks (ha also `scp *P*`) so their allows don't reopen it. The bash resource is the raw command text incl. its redirections and heredoc body (`core/src/shell/parse.ts`). Not catchable: `python3`/`node` writes, `curl -o`, `git checkout`/`restore`. **Sensitive-data guard ("wariant A", 2026-10-19):** global `bash` allows external-change commands (`git push`, `gh pr`, `kubectl apply/delete/exec/…`, `helm upgrade/install`, `flux suspend/resume`) with `ask` exceptions placed after all allows (force/delete/mirror pushes, `kubectl delete` of ns/pvc/pv/crd/`--all`/`-f`, `kubectl get` of `secret`/`secrets`/`secret/…`/comma lists with `-o …` — matched as a whole word so the `secretspec` CRD and `*-secretspec-*` names don't trip it, `.env`/`secrets/`/`*.pem`/`*.key`/`*.token`/kube/aws/gcloud paths) and `deny` for `~/.ssh/id_*` (`.pub` allowed), `opencode/auth.json`, `gcloud … print-*-token`, `aws … get-secret-value|get-session-token`, `aws ecr get-login-password`; `ssh`/`printenv` are no longer globally allowed (default ask). Global `permission.read` has the same sensitive-path asks/denies (`edit` has the deny set). `grep`/`glob` permission resources are the search *pattern*, not the path — they cannot be path-guarded. **Do NOT put `read: true` in `agents/*.md` `tools:`** — it becomes a trailing `read * allow` that overrides these. No agent block re-allows `kubectl get *`, so the global secret-read asks apply to every agent. Shell style rules for all agents: `docs/global-rules.md` "Shell Command Style"
- **Secrets:** Referenced via `{file:...}` syntax — actual values in `secrets/` (gitignored)
- **Silent document rejection:** a value that violates the schema drops the whole document — every MCP server defined in it disappears — with only a `configuration normalization diagnostic` warning (`core/src/config.ts`). `model`/`agents.title.model`/`agents.*.model` must be `provider/model` (optionally `#variant`), so one bad model id silently removes everything defined in the same `opencode.jsonc`; after editing a config file, verify it loaded with `opencode debug config` (prints the raw loaded documents)
- **MCP servers:** defined under `mcp.servers.<name>` (v1 flat `mcp.<name>` and its `enabled` flag are deprecated and migrated at load; use `disabled: true` to turn a server off): context7 (remote), github (npx, disabled), playwright (npx), pdf-reader (npx, disabled), homeassistant (remote), chrome-devtools (npx), firecrawl (npx, self-hosted), browsermcp (npx `@browsermcp/mcp`, pinned 2.5.x — drives the user's real logged-in Chrome through the Browser MCP extension; single `browser` tool; consent is per computer via a 6-digit pairing code plus per-agent tab groups; denied globally in `permissions`, allowed only for `webdebugger`, `webresearcher`, `architect`, `debugger` — see "Browser MCP (real Chrome control)"), dart-mcp-server (disabled), grafana-dev/grafana-test/grafana-stage/grafana-prod (`mcp-grafana` via Homebrew, read-only `--disable-write`; **work machine only — defined in per-machine `opencode.jsonc`**, because the shared file would otherwise spawn servers that cannot authenticate on every other machine and would carry internal hostnames; snippet in `secrets/README.md`); bitbucket (npx `@atlassian-dc-mcp/bitbucket`, Bitbucket Data Center 9.4 via REST 1.0, config by env `BITBUCKET_HOST` + `BITBUCKET_API_TOKEN` — token never in argv; **work machine only — defined in per-machine `opencode.jsonc`**, same reason as grafana-*: the shared file would spawn a server that cannot authenticate elsewhere and carry an internal hostname, snippet in `secrets/README.md`; 27 tools, `BITBUCKET_MERGE_ENABLED`/`BITBUCKET_DECLINE_ENABLED` deliberately unset, so merge/decline tools are never registered); jira (`mcp-atlassian` via Homebrew, Jira Data Center personal access token, config by env `JIRA_URL` + `JIRA_PERSONAL_TOKEN` — token never in argv; **work machine only — defined in per-machine `opencode.jsonc`**, same reason as grafana-*: the shared file would spawn a server that cannot authenticate elsewhere and carry an internal hostname, snippet in `secrets/README.md`)
- **Global tool disables:** `permissions` rules with `effect: "deny"` and `action` = `playwright_*`, `homeassistant_*`, `chrome-devtools_*`, `browsermcp_*`, `firecrawl_*`, `grafana-dev_*`, `grafana-test_*`, `grafana-stage_*`, `grafana-prod_*`, `jira_*`, `bitbucket_*`, `stitch_*`, `webfetch`, `WebFetch` — re-enabled per-agent as needed (the grafana-* tool sets are enabled only on `debugger`; `jira_*` only on `jira` and `bitbucket_*` only on `bitbucket`)

### Browser MCP (real Chrome control)

`browsermcp` gives an agent the user's **real Chrome** — existing logins, cookies, extensions — instead of a fresh browser profile. It is the OpenCode counterpart of Claude for Chrome: Browser MCP is an extension (`bjfgambnhccakkhmkepdoekmckoijdlc`) plus a loopback daemon, and `@browsermcp/mcp` is the thin stdio bridge OpenCode starts. Version is **pinned** to `2.5.0`; the 2.x line is a full rewrite and is young, so do not switch to `@latest` without testing.

One-time user setup (cannot be automated — it needs Chrome UI clicks): install the extension, let the agent trigger the pairing once, match the code in the popup and click **Allow** — the full procedure, including new machines and failure modes, is in "Pairing with the browser" below. Day-to-day: to hand the agent a logged-in page, drag that tab into its coloured tab group; the toolbar badge counts the tabs agents use and **Stop** in the popup revokes access instantly.

#### Pairing with the browser — full procedure

This is the part that cannot be scripted, so it is written out step by step. **Order matters:** the extension must be installed *before* an agent calls the tool, and the popup must be open when the code appears.

**A. First time on a machine**

1. Confirm the server is wired: `opencode mcp list` shows `browsermcp connected`. If not, the npm bridge never started and Chrome is irrelevant — fix the config first.
2. Install the extension:
   - Open `https://chromewebstore.google.com/detail/bjfgambnhccakkhmkepdoekmckoijdlc` in Chrome.
   - Click **Add to Chrome**, then **Add extension** in Chrome's native confirmation dialog.
   - Pin the icon to the toolbar (puzzle-piece icon → pin). The popup is where consent lives, so it must be one click away.
   - Exact ID, check before installing: `bjfgambnhccakkhmkepdoekmckoijdlc` (32 characters, `bjfgambn…`). A different "Browser MCP" exists at `browsermcp.dev` (Agent360, ID `jdehgalffmffhfhmmhaokfbfnafnmgcl`, package `@agent360/browser-mcp`) — installing that one leaves this config broken, because the two projects are unrelated.
3. Connect the extension to the daemon: click the toolbar icon. **"Waiting for the Browser MCP server"** is normal until the first agent call — it means the daemon is not running yet, not that anything is broken. `Connected to the Browser MCP server` means the two halves see each other.
4. Trigger the code: ask an agent that has permission, e.g. `@webdebugger` — "list my open tabs". The tool call returns *"Click Allow in the Browser MCP extension's popup. The code is NNN NNN"* and the toolbar badge turns into **`?`**.
5. Click the icon, compare the popup's code with the one the agent printed, and click **Allow**. **If the codes differ, do not click Allow** — another process may be answering on the port. The code is jointly computed by extension and daemon, so a mismatch is a real red flag, not a glitch.
6. **Repeat the request.** The first call always ends on the pairing prompt; the second one executes.

**B. New machine**

The pair is per computer, stored in `~/.browsermcp/`. Steps 1–6 above are unchanged: install the extension, connect it, trigger, compare, allow. Nothing from this repo needs editing — the server entry is already in the shared `opencode.json`. The allow prompt also returns after `~/.browsermcp` is deleted, which is the supported way to reset it.

**B2. Machine without the extension — this is expected, not broken**

The server entry lives in the shared `opencode.json`, so it reaches every machine. That is deliberate: unlike `grafana-*`, `bitbucket` and `jira` — which sit in the per-machine `opencode.jsonc` because they hold internal hostnames and credentials — Browser MCP carries **no secrets and no internal URLs**, and it is useful wherever someone has Chrome. So it is not "work only"; it just may be unused.

On a machine with no extension installed, the practical behaviour is:

- `opencode mcp list` still reports `browsermcp connected` — the npm bridge starts fine, it simply has no browser to talk to.
- Every tool call fails with the "Click Allow…" prompt, because the extension is what answers.
- Nothing crashes, nothing prompts, no secret is exposed. The cost is one lazily started `npx` process.

Two valid responses, pick per machine:

- **Leave it alone.** If the machine never calls the tool, the cost is effectively zero and the entry is ready the day you install the extension there.
- **Turn it off locally** by adding `"disabled": true` to a `browsermcp` override in the per-machine `opencode.jsonc`, the same way `github`, `pdf-reader` and `dart-mcp-server` are kept dormant in the shared file. Do not delete it from `opencode.json` — that removes it from the machine where it does work.

Either way, do not treat "connected but every call asks for Allow" as a fault to debug: check whether the extension is installed before touching the config.

**C. What success looks like**

A `tab list` returns the user's real tabs (not a clean profile) and `goto` + `get title` work. A fresh agent-opened page lands in a named, coloured tab group per AI app; the toolbar badge counts the tabs agents hold. Tabs release after ~10 idle minutes.

**D. When it does not work**

| Symptom | Meaning | Fix |
|---|---|---|
| `Click Allow…` on every call | Pairing never completed — **or the extension is not installed on this machine at all** | Check the toolbar for the Browser MCP icon first; if it is missing, that is the whole problem (see B2). If present, open popup, compare codes, Allow, retry |
| Popup: "Waiting for the Browser MCP server" | Daemon not running | An agent must have called the tool once; check `opencode mcp list`, restart the MCP server in `/mcps` |
| `opencode mcp list` not `connected` | npm bridge failed | Chrome is irrelevant until this is green — check Node ≥ 20 and the pinned version |
| Works, then dies after a Chrome restart | Extension lost its daemon socket | Reload the extension or restart the app; the pair persists, so no re-Allow should be needed |
| Codes never match | Unexpected listener on 9010–9012 | Stop, inspect what owns the port, do not approve |

**Log trap:** `~/.browsermcp/daemon.log` keeps the line *`Extension … connected … (pairing pending)`* from the moment the extension attaches and **never updates it** after pairing succeeds. Today's session showed `pairing pending` while every tool call worked. Judge the state by an actual tool call, never by that line.

Operational notes:

- **Single tool.** The whole surface is one `browser` tool taking a command string (`goto`, `click`, `fill`, `snapshot`, `tab`, `get`, `eval`, …); `help <command>` inside it documents the rest. That is why it costs almost no context, in contrast to `chrome-devtools` with its ~60 tool schemas.
- **Code Mode.** Like every MCP server here it defaults to `codemode: true`, so agents reach it as `tools.browsermcp.browser(...)` inside `execute`, keyed by the permission action `browsermcp_browser`.
- **Who may use it.** `webdebugger` gets `browsermcp_*`; `webresearcher`, `architect` and `debugger` get exactly `browsermcp_browser`. Everything else is denied globally — an agent can only touch the browser if it is on that list.
- **Raw CDP escape hatch.** Add `--caps cdp` to the command when an agent needs network interception, precise emulation or performance data; leave it off otherwise, because raw CDP is a much wider surface.
- **Scope of the grant.** Once paired, the extension's `<all_urls>` and `debugger` permissions mean agents can read and drive any non-incognito tab that reaches their group. Incognito works only if the user enables it for the extension, and the popup's Stop button is the only per-session brake. Treat this as a powerful, user-supervised capability — the equivalent of running a debugger against the user's browser.
- **Troubleshooting.** `opencode mcp list` should show `browsermcp connected`; the log line `mcp connected ... server=browsermcp tools=1` confirms registration. `connected` with tool calls failing on "Click Allow" means pairing was never completed. Do not confuse the package with the similarly named `@agent360/browser-mcp` (a different product).

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
| General agent prompt | `agents/general.md` (v2 takes the agent id from the filename, not `name:`) |
| Skill writing guide | `superpowers/AGENTS.md` |
| Memory config | Plugin: `plugins/mnemoteca.js` → `opencode-mnemoteca` fork (mnemoteca binary, SQLite + FTS5 + sqlite-vec; DB `~/.local/share/mnemoteca/mnemoteca.db`) |
| Global rules | `docs/global-rules.md` |
| Memory rules | `docs/memory-rules.md` |
| Design principles | `docs/design-principles.md` |

## Superpowers Skills (14 total)

Located in `superpowers/skills/`:
`brainstorming`, `dispatching-parallel-agents`, `executing-plans`, `finishing-a-development-branch`, `receiving-code-review`, `requesting-code-review`, `subagent-driven-development`, `systematic-debugging`, `test-driven-development`, `using-git-worktrees`, `using-superpowers`, `verification-before-completion`, `writing-plans`, `writing-skills`
