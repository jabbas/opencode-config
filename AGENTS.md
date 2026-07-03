# AGENTS.md - OpenCode Configuration Repository

OpenCode configuration directory containing the Superpowers plugin system, skill repositories, custom agents, and MCP configs.

**Repo root is `~/.config/opencode/` — always use `pwd` to confirm location. Never read the filesystem root `/`.**

## Global Hard Rules (All Agents)

- **NEVER reboot, shutdown, or restart** any host, VM, or container without explicit user confirmation in the current conversation. Do not delegate a reboot to a subagent either.
- Commands that are always forbidden unless the user explicitly typed "reboot"/"restart"/"shutdown" in their most recent message: `reboot`, `shutdown`, `poweroff`, `init 6`, `systemctl reboot`, `systemctl poweroff`
- **NEVER run destructive commands** (disk wipe, ZFS destroy, `dd`, network reset) without explicit user confirmation
- When a task requires a reboot to complete: **STOP**, summarize what was done, list what will happen after reboot, and tell the user to reboot manually and confirm when it is back up

## Working in This Repo

Editing files in this repo — `superpowers.js`/plugin code, `agents/*.md`,
`SKILL.md` skill files, or shell scripts? **Read `docs/dev-guide.md` BEFORE making
changes.** It has the code style, naming conventions, build/test commands, full
repo layout, and error-handling patterns. Non-editing tasks (queries, web ops,
home automation) do not need it.

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
- **Providers:** machine-specific providers (e.g. a work-only gateway such as
  `kilocode`) go in the local layer's `provider` block, not in `opencode.json`.
- **Loading:** `.envrc` (direnv) exports
  `OPENCODE_CONFIG="$PWD/opencode.local.json"` on entering the config dir. Run
  `direnv allow .` once per machine. Without direnv, export `OPENCODE_CONFIG`
  manually (absolute path to `opencode.local.json`).
- **Secrets:** all URLs/keys use `{file:secrets/*}`, which resolves relative to
  the config dir, so the same `opencode.json` reads each machine's own secrets.

## Repository Layout

This is the OpenCode global config repo (`~/.config/opencode`): `opencode.json`
(main config), `agents/` (agent definitions), `docs/` (rules, specs, plans),
`plugins/superpowers.js` (symlink), `skills/` (discovery symlinks), and skill
submodules (`superpowers/`, `anthropics-skills/`, `cloudflare-skills/`,
`stitch-skills/`, `awesome-agent-skills/`). Secrets live in `secrets/`
(gitignored), referenced via `{file:PATH}` in `opencode.json`.

**Full directory tree, plugin load details, and secrets setup: see
`docs/dev-guide.md`.**

## Agent Roster

| Agent | Model | Purpose |
|-------|-------|---------|
| `general` | `claude-sonnet-4-6` | General-purpose fallback; software + DevOps (default: `agents/default.md`) |
| `coder` | `claude-sonnet-4-6` | Polyglot code — Go, Python, TypeScript, Shell |
| `architect` | `claude-opus-4-8` | Software/system architecture, ADRs, design, plans (bash: deny; ZLECA → delegates) |
| `autopilot` | `claude-opus-4-8` | User-only autonomous orchestrator; opus thinks, subagents execute. `bash: deny`; `edit` denied except `docs/superpowers/**` (own artifacts only — `write` is gated by the `edit` permission). Not dispatchable by any agent — `mode: primary` (hides it) + `task: {autopilot: deny}` on root & all delegating agents (enforces it) |
| `debugger` | `claude-opus-4-8` | Full-stack debugging, diagnosis only |
| `devops` | `claude-sonnet-4-6` | CI/CD, GitHub, Flux, Helm, Kustomize, git ops |
| `jenkins` | `claude-sonnet-4-6` | Jenkins controller ops via the `jk` CLI — jobs, runs, logs, config.xml, artifacts, credentials, nodes, plugins. Owns the `jk` skill; all other agents delegate Jenkins actions here |
| `ha` | `claude-sonnet-4-6` | Home Assistant — query entities, control devices |
| `webdebugger` | `claude-sonnet-4-6` | Browser testing, UI verification via Playwright + Chrome DevTools |
| `webscraper` | `claude-haiku-4-5` | Extract web content via Firecrawl (bash: deny) |
| `webresearcher` | `claude-sonnet-4-6` | Search & synthesize web info via Firecrawl (bash: deny) |
| `webmonitor` | `claude-haiku-4-5` | Web page change tracking via Firecrawl (bash: deny) |
| `cloudflare` | `claude-sonnet-4-6` | Cloudflare Workers/wrangler/Durable Objects/Pages |
| `frontend` | `claude-sonnet-4-6` | UI build, components, visual/graphic work, generative art |
| `stitch` | `claude-sonnet-4-6` | Google Stitch design→code |
| `writer` | `claude-sonnet-4-6` | Documentation, specs, internal comms; docx/pptx/pdf (ZAPISUJE) |
| `skill-smith` | `claude-sonnet-4-6` | Create/edit skills, build MCP servers |
| `jira` | `claude-sonnet-4-6` | Jira issue tracking via `jira_*` MCP (bash: deny) |
| `stitch-mcp` | `claude-sonnet-4-6` | Google Stitch UI design via `stitch_*` MCP (bash: deny; separate from skill-driven `stitch`) |

- `plan` agent is defined in `opencode.json` only (read-only: no bash/edit/write tools).
- `websearch` was removed — curl/wget is covered by any bash-enabled agent; readable web content via `@webscraper`.

## Delegation Rules (All Agents)

These apply to every agent (this file is injected globally via `Instruction.system`):

- **Any agent may delegate to any other agent, except `autopilot` can never be
  called.** Every agent carries an explicit `task: {"*": "allow", "autopilot":
  "deny"}` in `opencode.json`. The explicit rule is required because of
  `subagent-permissions.ts` (`deriveSubagentSessionPermission`): when an agent runs
  **as a subagent**, opencode injects `task: {"*": "deny"}` UNLESS the agent's own
  ruleset already contains a `task` rule (`canTask`). So the explicit block is what
  keeps delegation working at any nesting depth. `autopilot` stays excluded
  everywhere (it is also `mode: primary`, so it is never dispatchable).
- **Jenkins → `@jenkins`.** Any Jenkins controller action — builds/runs, logs, jobs, `config.xml`, artifacts, test reports, credentials, nodes, queues, plugins — goes to `@jenkins`. Do NOT run the `jk` CLI yourself; the `jk` skill is denied to every agent except `jenkins`.

## Per-Agent Skill Whitelists (token optimization)

Each agent's visible skills are restricted via `permission.skill` in
`opencode.json` (`agent.<name>.permission.skill`), pattern
`{"*": "deny", "<skill>": "allow", ...}`. **Only `deny` saves tokens** — a denied
skill is hidden from `<available_skills>` AND blocked from invocation; `allow`/`ask`
both keep it on the list at full cost (verified: `skill/index.ts:314`,
`permission/index.ts:86`). **Missing skill → delegate** to the owning specialist
(`@frontend`, `@stitch`, `@writer`, `@cloudflare`, `@jenkins`, `@skill-smith`). **Every**
agent carries an explicit `task: {"*": "allow", "autopilot": "deny"}` so delegation
works even when the agent is itself running as a subagent (see "Delegation Rules"
above for the `canTask` mechanism).

Pure MCP operators (`webscraper`, `webresearcher`, `webmonitor`) intentionally
have zero skills (`{"*": "deny"}`) — no `using-superpowers` either. This is
deliberate: they are single-purpose Firecrawl operators that don't code, so any
skill would be dead weight. Do not "fix" this by adding skills. They DO still carry
the standard `task` delegation rule, so they can hand off to another agent if a job
falls outside scraping/research/monitoring.

Full rationale, ownership map, and per-agent skill lists:
`docs/superpowers/specs/2026-06-13-agent-skill-optimization-design.md`.

## Skill Resolution & Invocation

Skills are loaded via OpenCode's **native `skill` tool** (`tool/skill.ts`), not the
deprecated `use_skill`/`find_skills` custom tools (removed upstream; see
`superpowers/RELEASE-NOTES.md`). Discovery scans `**/SKILL.md` under the configured
skill dirs and keys skills by `name`.

Name-collision precedence (first match wins):
1. **Project skills** — current working directory
2. **Personal skills** — user's config dir
3. **Superpowers skills** — from the plugin

Use `superpowers:skill-name` prefix to force the superpowers version and bypass shadowing.
Per-agent visibility is then filtered by `permission.skill` (see "Per-Agent Skill Whitelists").

