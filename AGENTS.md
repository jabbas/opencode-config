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

**After updating skill submodules or editing any `permission.skill` whitelist, run
`bash scripts/check-skill-whitelists.sh` and fix every `[FAIL]`.** A whitelist key
that matches no skill ID silently grants nothing (v2 matches the directory name,
not `name:`). Then report new `[INFO]` orphans to the user so they can decide which
agent, if any, gets them.

## Model Layer & Machine Portability

This config is shared verbatim between the private and work machines. The shared
`opencode.json` contains no top-level `model`/`small_model` and no machine-specific
`provider` block. Those live in a per-machine `opencode.jsonc` (gitignored), which
OpenCode **auto-loads and deep-merges on top of `opencode.json`**. No env var needed.

- **Load order** (ascending precedence, v2): `opencode.json` → `opencode.jsonc`
  → project config (`opencode.json[c]` up the tree, then `.opencode/`). All are
  deep-merged; later layers win per-key. v2 no longer reads `config.json`. Full
  order incl. env vars and managed config: README "Side-by-side configs".
- **Defaults:** `opencode.jsonc` sets `model` = sonnet and `small_model` = haiku.
- **Per-agent override:** thinking-role agents can set their own model via
  `agent.<name>.model`. Everyone else inherits the global default. To change a
  model for one agent, edit one line in `opencode.jsonc`. (Note: `opencode.json`
  also pins a few agent models that are meant to be identical everywhere —
  currently `autopilot` and `architect`.)
- **Providers:** machine-specific providers (e.g. a work-only gateway such as
  `kilocode`) go in `opencode.jsonc`'s `provider` block, not in `opencode.json`.
- **Never use `OPENCODE_CONFIG`.** It only applies where the env var is exported
  (GUI/ACP launches and the launchd background service get `model: null`) and is
  merged *after* `opencode.jsonc`, silently overriding it. (`OPENCODE_CONFIG_DIR`
  in v2 *replaces* the config dir — not an extra layer.) The retired `opencode.local.json` layer
  depended on it. `opencode.jsonc` replaces it with no such drawback.
- **Variants:** a machine may keep several gitignored `opencode.*.json` variants
  and make `opencode.jsonc` a symlink to the active one
  (`ln -sfn opencode.kilocode.json opencode.jsonc`). See README "switchable variants".
- **Secrets:** all URLs/keys use `{file:secrets/*}`, which resolves relative to
  the config dir, so the same `opencode.json` reads each machine's own secrets.

## Repository Layout

This is the OpenCode global config repo (`~/.config/opencode`): `opencode.json`
(main config), `agents/` (agent definitions), `docs/` (rules, specs, plans),
`plugins/superpowers.js` (symlink), `skills/` (discovery symlinks), and skill
submodules (`superpowers/`, `anthropics-skills/`, `cloudflare-skills/`,
`stitch-skills/`, `awesome-agent-skills/`, `jenkins-cli/`). Secrets live in
`secrets/` (gitignored), referenced via `{file:PATH}` in `opencode.json`.

**Full directory tree, plugin load details, and secrets setup: see
`docs/dev-guide.md`.**

## Agent Roster

| Agent | Purpose |
|-------|---------|
| `general` | General-purpose fallback; software + DevOps (prompt: `agents/general.md`) |
| `coder` | Polyglot code — Go, Python, TypeScript, Shell |
| `architect` | Software/system architecture, ADRs, design, plans (bash: restricted; delegates) |
| `autopilot` | User-only autonomous orchestrator; subagents execute. `bash: restricted`; `edit` denied except `docs/superpowers/**` (own artifacts only — `write` is gated by the `edit` permission). Not dispatchable by any agent — `mode: primary` (hides it from the `subagent` tool) + `task: {autopilot: deny}` on all agents |
| `debugger` | Full-stack debugging, diagnosis only |
| `devops` | CI/CD, GitHub, Flux, Helm, Kustomize, git ops |
| `jenkins` | Jenkins controller ops via the `jk` CLI — jobs, runs, logs, config.xml, artifacts, credentials, nodes, plugins. Owns the `jk` skill; all other agents delegate Jenkins actions here |
| `ha` | Home Assistant — query entities, control devices, ESPHome via `esp.iot` SSH |
| `webdebugger` | Browser testing, UI verification via Playwright + Chrome DevTools |
| `webscraper` | Extract web content via Firecrawl (bash: restricted) |
| `webresearcher` | Search & synthesize web info via Firecrawl (bash: restricted) |
| `webmonitor` | Web page change tracking via Firecrawl (bash: restricted) |
| `cloudflare` | Cloudflare Workers/wrangler/Durable Objects/Pages |
| `frontend` | UI build, components, visual/graphic work, generative art |
| `stitch` | Google Stitch design→code |
| `writer` | Documentation, specs, internal comms; docx/pptx/pdf |
| `skill-smith` | Create/edit skills, build MCP servers |
| `jira` | Jira issue tracking via `jira_*` MCP (bash: restricted) |
| `stitch-mcp` | Google Stitch UI design via `stitch_*` MCP (bash: restricted; separate from skill-driven `stitch`) |

- `plan` agent is defined in `opencode.json` only (no edit/write tools; bash: restricted — echo/ls/test/head/cat/printf/mkdir, no redirects).
- `websearch` was removed — curl/wget is covered by any bash-enabled agent; readable web content via `@webscraper`.
- Models are intentionally omitted here; they come from `opencode.jsonc` on each machine (plus a few cross-machine pins in `opencode.json`).

## Delegation Rules (All Agents)

These apply to every agent (this file is injected globally via `Instruction.system`):

- **One level of delegation only.** The coordinator — the agent the user talks to
  directly — dispatches specialists via the `subagent` tool. A subagent does NOT
  dispatch further subagents. This is enforced by OpenCode v2's
  `experimental.subagent_depth` (default `1`, intentionally left unset); a nested
  call fails with "Subagent depth limit reached".
- **Running as a subagent and need another specialist or a skill you lack?** Do not
  try to dispatch. Do what you can within your own tools, then end your reply by
  telling the coordinator exactly what remains and which agent should do it (e.g.
  "needs `@jenkins`: trigger job X"). The coordinator does the hand-off.
- **NEVER delegate to yourself.** If the task falls within your own specialty, DO
  THE WORK DIRECTLY — do not dispatch a subagent of your own type (e.g. `jenkins`
  calling `@jenkins`). Self-dispatch is also hard-blocked: every agent has
  `task: {"<own-name>": "deny"}` in `opencode.json`, so the attempt will fail —
  don't waste a turn trying.
- **Any agent may be dispatched, except `autopilot`.** Every agent carries
  `task: {"*": "allow", "autopilot": "deny", "<own-name>": "deny"}` in
  `opencode.json` (v2 migrates the v1 `task` permission to `subagent`).
  `autopilot` is excluded by that rule AND by `mode: primary`.
- **Dispatchable agents need `"mode": "all"`.** OpenCode v2 defaults agents without
  a `mode` to `primary`, which hides them from the `subagent` tool ("Agent X cannot
  run as a subagent") and makes callers fall back to `general`. Every custom agent
  except `autopilot` and `plan` sets `"mode": "all"` in `opencode.json` — any new
  agent must too. The agent id comes from the markdown **filename**, not the
  frontmatter `name:` (`agents/general.md` → `general`).
- **Jenkins → `@jenkins`.** Any Jenkins controller action — builds/runs, logs, jobs, `config.xml`, artifacts, test reports, credentials, nodes, queues, plugins — goes to `@jenkins`. Do NOT run the `jk` CLI yourself; the `jk` skill is denied to every agent except `jenkins`.

## Periodic Permission Review

- The **coordinator** (never a subagent) checks project memory at session start for
  `PERMISSION REVIEW LAST:`. If missing or older than 7 days, dispatch `@general`
  **in the background** per `docs/permission-review.md` and tell the user in one line.
- Also run it on request: "zrób przegląd uprawnień" / "permission review".
- Report findings to the user; change `opencode.json` or delete saved approvals
  **only with explicit user approval**. Skip the auto-trigger in sessions about permissions.

## Per-Agent Skill Whitelists (token optimization)

Each agent's visible skills are restricted via `permission.skill` in
`opencode.json` (`agent.<name>.permission.skill`), pattern
`{"*": "deny", "<skill>": "allow", ...}`. **Only `deny` saves tokens** — a denied
skill is hidden from `<available_skills>` AND blocked from invocation; `allow`/`ask`
both keep it on the list at full cost (verified on v2.0.29:
`packages/core/src/skill.ts:34` `Skill.available` filters `effect !== "deny"`;
`skill/instructions.ts:74` renders that list; `tool/plugin/skill.ts:51` asserts the
permission on invoke; `permission.ts:87` — last matching rule wins).
**Whitelist keys match the skill ID = its directory name, NOT the frontmatter
`name:`** (e.g. `generate-design`, not `stitch::generate-design`). A key that matches
no ID silently grants nothing. **Missing skill → delegate** to the owning specialist
(`@frontend`, `@stitch`, `@writer`, `@cloudflare`, `@jenkins`, `@skill-smith`) when
you are the coordinator; as a subagent, report the need back instead (see
"Delegation Rules" above — one level only).

Pure MCP operators (`webscraper`, `webresearcher`, `webmonitor`) intentionally
have zero skills (`{"*": "deny"}`) — no `using-superpowers` either. This is
deliberate: they are single-purpose Firecrawl operators that don't code, so any
skill would be dead weight. Do not "fix" this by adding skills. They DO still carry
the standard `task` rule, so when run directly as coordinator they can hand off to
another agent; as subagents they report out-of-scope work back to the caller.

Full rationale, ownership map, and per-agent skill lists:
`docs/superpowers/specs/2026-06-13-agent-skill-optimization-design.md`.

## Skill Resolution & Invocation

Skills are loaded via OpenCode's **native `skill` tool** (v2:
`packages/core/src/tool/plugin/skill.ts`), not the deprecated
`use_skill`/`find_skills` custom tools (removed upstream; see
`superpowers/RELEASE-NOTES.md`). Discovery (`config/plugin/skill.ts`) scans
`{*.md,**/SKILL.md}` under `skill/` and `skills/` of each config directory, plus
paths listed in config `skills`. The skill **ID is the parent directory name** of
`SKILL.md` (or the filename of a top-level `*.md`); the frontmatter `name:` is only a
display name. OpenCode also ships built-in skills (`opencode`, `report`).

ID collisions: sources are loaded in order into a map, so the **later source wins**.
There is no `superpowers:` prefix in v2 — avoid duplicate directory names instead.
Per-agent visibility is then filtered by `permission.skill` (see "Per-Agent Skill Whitelists").
