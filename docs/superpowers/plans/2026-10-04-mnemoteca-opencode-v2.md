# opencode-mnemoteca OpenCode v2 Port — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `opencode-mnemoteca` load and expose its 5 `memory_*` tools on OpenCode v2.0.22 while staying fully working on v1, then migrate both machines' memory data to mnemoteca and wire the forked plugin into this config repo.

**Architecture:** One module with a dual default export `{ id, server: MnemotecaPlugin, setup }`. Shared zero-dependency `src/core.ts` holds the CLI runner, tool specs and copy; `src/index.ts` (v1 adapter, unchanged behavior) and new `src/v2.ts` (v2 `setup`) are thin adapters over it. The fork is developed in `~/Projects/opencode-mnemoteca` and consumed by the config repo as a submodule loaded through a relative symlink in `plugins/`.

**Tech Stack:** TypeScript 5.9 (tsc → `dist/`, `moduleResolution: bundler`), npm (`package-lock.json`), tests = `node:test` + `tsx` with a stubbed `globalThis.Bun`, `@opencode-ai/plugin ^1.2.24` (v1 path only), `mnemoteca` Go CLI, `gh` CLI.

**Spec:** `docs/superpowers/specs/2026-10-04-mnemoteca-opencode-v2-design.md`

## Locations

| What | Path |
|---|---|
| Fork working copy (dev) | `~/Projects/opencode-mnemoteca` (origin `git@github.com:jabbas/opencode-mnemoteca.git`, branch `main`) |
| Upstream plugin | `gandazgul/opencode-mnemoteca` |
| mnemoteca CLI source (reference) | `~/Projects/mnemoteca` (migration doc: `docs/migrate-from-mnemosyne.md`) |
| OpenCode source (1.18.34, `dev`) | `~/Projects/opencode` |
| OpenCode v2.0.22 reference | `~/Projects/opencode-v2.0.22` (worktree, created in Task 0) |
| Config repo | `~/.config/opencode` |

## Global Constraints

- Default export: `{ id: "mnemoteca", server: MnemotecaPlugin, setup }`; named export `MnemotecaPlugin` kept.
- v1 path behavior (tool names, args, descriptions, argv, outputs, compaction text, logs) identical to upstream 0.3.0 — existing `src/index.test.ts` passes **unmodified**.
- Tool names: `memory_recall`, `memory_recall_global`, `memory_store`, `memory_store_global`, `memory_delete`.
- v2 tools: `input` = plain JSON Schema (`type: "object"`, `additionalProperties: false`), `options: { codemode: false }`, return `{ content: string }`.
- No new runtime dependency; do NOT add `@opencode/plugin` (v2 SDK); v2 types declared locally in `src/v2.ts`.
- Subprocess: `Bun.spawn` with an args array only (never a shell string).
- Relative imports use the `.js` suffix (`./core.js`) so `dist/` resolves under Bun, Node and tsx.
- Test tooling follows the repo: `npm test` (tsc typecheck + tsx), Bun stubbed via `globalThis.Bun`; new test files are appended to the `test` script.
- `main`/`exports` keep pointing at `dist/index.js`; `npm run ci` must pass.
- Project name semantics identical to v1: basename of the session directory with trailing slashes stripped, `"global"` → `"default"`, empty → `"default"`.
- Missing-binary message identical to v1: `Error: mnemoteca binary not found. Install it: https://github.com/gandazgul/mnemoteca#install`.
- Fork branch: `opencode-v2`. Config repo: submodule `opencode-mnemoteca/`; file symlink `plugins/mnemoteca.js -> ../opencode-mnemoteca/dist/index.js` (Ruling 5).
- `docs/memory-rules.md` is NOT modified.
- Legacy data (`~/.local/share/mnemosyne/`, `~/bin/mnemosyne`) is never modified or deleted by this plan.
- Migration export directory is persistent: `~/.mnemoteca-migration-exports/manual-mnemosyne-export` (never `$TMPDIR`), kept after migration.
- Upstream PR requires explicit human approval of the full diff (hard gate).

## Review Focus

1. Model omits optional `core` → v2 argv identical to v1 argv without `--tag core`. Test in Task 3.
2. Tool call aborted (user hits Esc) → v2 passes `tctx.signal` into `Bun.spawn` options and an aborted call rejects instead of hanging. Test in Task 2/3 (stub records `signal`; stub honoring abort rejects).
3. Session directory basename with spaces/unicode or named `global` (`/tmp/my repo ż`, `/x/global/`) → one argv element, same mapping as v1. Test in Task 3.
4. `mnemoteca` exits non-zero / writes stderr → v2 surfaces the same error message as v1 (thrown `Error(stderr)`), OpenCode not crashed. Test in Task 3.
5. Old `opencode-mnemosyne` and new plugin both configured → duplicate tools / double instructions. Prevented by Task 5 config cleanup; verified by Task 5 smoke log (one mnemoteca plugin, no LoadError).

---

### Task 0: Preparation (sources, prior work, baseline)

**Files:** none changed.

- [ ] **Step 1:** `git -C ~/Projects/opencode fetch --tags && git -C ~/Projects/opencode worktree add ../opencode-v2.0.22 v2.0.22`. Expected: `~/Projects/opencode-v2.0.22/packages/plugin/src/promise/tool.ts` exists.
- [ ] **Step 2:** Verify spec §3 in the v2.0.22 worktree: default-export validation (`packages/core/src/plugin/module.ts`), `codemode` option (`packages/schema/src/tool.ts`), `ToolContext.signal`, `Context.location` (`packages/plugin/src/promise/plugin.ts`), `session.hook("context")` + `system` array (`packages/plugin/src/promise/session.ts`). Also record whether `Context` offers a logging facility (for Task 3 logger). Any mismatch → STOP, report to architect.
- [ ] **Step 3:** In `~/Projects/opencode` (1.18.34) find the loader branch handling `default` with `id`/`server` and whether it also calls `default.setup`; record file:line.
- [ ] **Step 4:** Prior work: `gh pr list -R gandazgul/opencode-mnemoteca --state all`, `gh issue list -R gandazgul/opencode-mnemoteca --state all` (and same for `gandazgul/mnemoteca`); search `v2`, `opencode 2`, `setup`, `LoadError`. Open v2 work → STOP, report to human. Record default branch: `gh repo view gandazgul/opencode-mnemoteca --json defaultBranchRef`.
- [ ] **Step 5:** In `~/Projects/opencode-mnemoteca`: `git remote add upstream https://github.com/gandazgul/opencode-mnemoteca.git && git fetch upstream`; confirm `main` == `upstream/<default>` (`git log -1` both); `git checkout -b opencode-v2`.
- [ ] **Step 6:** Baseline: `npm ci && npm test && npm run ci`. Expected: all 4 existing tests pass, `dist/index.js` built.

### Task 1: Extract `src/core.ts` (pure refactor)

**Files:**
- Create: `src/core.ts`, `src/core.test.ts`
- Modify: `src/index.ts`, `package.json` (`test` script appends `&& tsx src/core.test.ts`)

**Interfaces — Produces (exported from `src/core.ts`):**
- `type Logger = { debug(m: string): Promise<void>|void; info(...); warn(...); error(...) }`
- `type RunOpts = { cwd: string; log: Logger; signal?: AbortSignal }`
- `projectName(dir: string): string` — v1 lines 27–30 logic.
- `run(args: string[], opts: RunOpts): Promise<string>` — v1 `mnemoteca()` (lines 38–76) verbatim incl. missing-binary message; passes `signal` to `Bun.spawn` only when defined (so v1 spawn options stay byte-identical).
- `ensureCollection(args: string[], opts: RunOpts): Promise<void>` — v1 init spawns (`stdout:"ignore"`, `stderr:"pipe"`, await `.exited`, errors → `log.warn`), used for `["init","--name",p]` and `["init","--global"]` with the v1 log messages.
- `type ToolSpec = { name: ToolName; description: string; args: Record<string, { type: "string"|"number"|"boolean"; description: string; optional?: true }>; execute(args: any, ctx: { project: string; opts: RunOpts }): Promise<string> }`
- `TOOLS: readonly ToolSpec[]` — the 5 tools in v1 order with v1 descriptions, arg descriptions, query quoting, `--tag core`, global init, `"No memories found."` / `"No global memories found."`, `.trim()`.
- `MEMORY_INSTRUCTIONS: string` — exact v1 compaction text (lines 206–217).

- [ ] **Step 1:** Write `src/core.test.ts` (same `installBunBoundary` pattern as `index.test.ts`, extended to record `options.signal`):
  - `projectName maps global and trailing slash`: `projectName("/x/global/") === "default"`, `projectName("/tmp/my repo ż/") === "my repo ż"`, `projectName("/") === "default"`.
  - `run omits signal when undefined`: recorded options have no `signal` key.
  - `run forwards signal`: recorded `options.signal === controller.signal`.
  - `run throws stderr on non-zero exit`: stub `exited: 3`, `stderr: "boom"` → rejects with `Error("boom")`.
  - `run returns install guidance when spawn throws ENOENT`: stub throws `new Error("ENOENT")` → resolves to the exact missing-binary message.
  - `TOOLS order and names`: `TOOLS.map(t => t.name)` equals `["memory_recall","memory_recall_global","memory_store","memory_store_global","memory_delete"]`.
- [ ] **Step 2:** `npm test` → FAIL (module missing).
- [ ] **Step 3:** Implement `src/core.ts`; rewrite `src/index.ts` to build v1 `tool({...})` entries by mapping `TOOLS` (`args` → `tool.schema.string()/number()/boolean()` + `.optional()` + `.describe()`), logger from `client.app.log`, compaction hook pushes `MEMORY_INSTRUCTIONS`.
- [ ] **Step 4:** `npm test && npm run ci` → PASS; `git diff upstream/main -- src/index.test.ts` empty.
- [ ] **Step 5:** `git add src package.json && git commit -m "refactor: extract zero-dependency core shared by adapters"`.

### Task 2: v2 adapter + dual export

**Files:**
- Create: `src/v2.ts`, `src/v2.test.ts`
- Modify: `src/index.ts` (default export), `package.json` (`test` appends `&& tsx src/v2.test.ts`)

**Interfaces:**
- Consumes: Task 1 `TOOLS`, `run`, `ensureCollection`, `projectName`, `MEMORY_INSTRUCTIONS`, `Logger`.
- Produces: `setup(ctx: unknown): Promise<void>` in `src/v2.ts`; `src/index.ts`: `export default { id: "mnemoteca", server: MnemotecaPlugin, setup }`.
- Local types (confirmed in Task 0 Step 2): `V2Context = { location: { directory: string }; tool: { transform(fn: (t: { add(def: V2Tool): void }) => void): Promise<void> }; session: { hook(name: "context", fn: (e: { system: Array<{ type: "text"; text: string }> }) => void|Promise<void>): unknown } }`; `V2Tool = { name: string; description: string; input: object; options: { codemode: false }; execute(input: any, tctx: { signal: AbortSignal }): Promise<{ content: string }> }`.
- `toJsonSchema(spec: ToolSpec): object` — `{ type:"object", properties: {k: {type, description}}, required: <non-optional keys>, additionalProperties:false }`.
- Logger: the v2 logging facility found in Task 0 Step 2, else a no-op logger (never `console.*` — it corrupts the TUI).

- [ ] **Step 1:** Write `src/v2.test.ts` with `fakeV2Ctx(dir)` recording `tools.add` and `session.hook` calls, plus the Bun boundary stub:
  - `registers five tools with codemode false`: names equal `TOOLS` names; every `options.codemode === false`, `input.type === "object"`, `input.additionalProperties === false`.
  - `schemas mirror v1 args`: `memory_store.input.required` = `["content"]`, properties `content`(string), `core`(boolean); `memory_delete.input.properties.id.type === "number"`.
  - `execute returns content and uses location cwd`: `memory_recall.execute({query:"x"}, {signal})` → `{ content: "ok" }`; spawn `command` = `["mnemoteca","search","--name","acme","--format","plain","\"x\""]`, `options.cwd === "/tmp/acme"`, `options.signal === signal`.
  - `omitted core matches v1 argv` (RF1): `memory_store.execute({content:"c"})` → `["mnemoteca","add","--name","acme","c"]`.
  - `init uses mapped project name as one argv` (RF3): dir `/tmp/my repo ż` → first spawn `["mnemoteca","init","--name","my repo ż"]`; dir `/x/global` → `--name default`.
  - `non-zero exit surfaces stderr` (RF4): stub `exited 1`, `stderr "bad"` → `execute` rejects `Error("bad")`.
  - `abort rejects` (RF2): stub whose `exited` rejects when `options.signal` aborts → aborted `execute` rejects within 100 ms.
  - `context hook pushes instructions`: registered hook given `{system: []}` → `[{type:"text", text: MEMORY_INSTRUCTIONS}]`.
  - `guard: v1-shaped ctx does nothing`: `setup({directory:"/tmp/a", client:{}})` resolves; zero spawns, no throws.
  - `missing binary`: stub spawn throws `ENOENT` → `setup` resolves; `execute` → `{ content: <exact v1 missing-binary message> }`.
  - `default export shape`: `id === "mnemoteca"`, `server === MnemotecaPlugin`, `typeof setup === "function"`.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implement `src/v2.ts`: guard (`typeof ctx?.tool?.transform !== "function" || typeof ctx?.session?.hook !== "function"` → return) → `dir = ctx.location.directory` → `ensureCollection(["init","--name",projectName(dir)])` → `ctx.tool.transform(t => TOOLS.forEach(s => t.add({...})))` with `execute: async (input, tctx) => ({ content: await s.execute(input, { project, opts: { cwd: dir, log, signal: tctx?.signal } }) })` → `ctx.session.hook("context", e => { e.system.push({ type:"text", text: MEMORY_INSTRUCTIONS }) })`. Add default export to `src/index.ts`.
- [ ] **Step 4:** `npm test && npm run ci` → PASS; `grep -n "export default" dist/index.js` present; `dist/v2.js`, `dist/core.js` exist; `index.test.ts` still unmodified.
- [ ] **Step 5:** README: "OpenCode v2" section — install (submodule/path or npm once published; v2 key `plugins`, legacy `plugin` also read), `codemode:false`, instructions injected each turn (v2 has no compaction-context equivalent that survives summary), v1 unchanged.
- [ ] **Step 6:** `git add src package.json README.md && git commit -m "feat: support OpenCode v2 plugin API (dual export, v1 unchanged)" && git push -u origin opencode-v2`.

### Task 3: Data migration — private machine

Follows `~/Projects/mnemoteca/docs/migrate-from-mnemosyne.md` Path 2. **Human runs or explicitly approves each command.** Close all OpenCode sessions first (execute from a plain terminal or with the human driving).

- [ ] **Step 1:** Record old state: `~/bin/mnemosyne stats` → single `Database Path:` line + counts (expected 219 documents / 63 collections).
- [ ] **Step 2:** Backup: `tar czf ~/mnemosyne-backup-2026-10-04.tgz -C ~/.local/share mnemosyne`; `tar tzf ~/mnemosyne-backup-2026-10-04.tgz | grep mnemosyne.db` non-empty.
- [ ] **Step 3:** Install: `brew install gandazgul/tap/mnemoteca` (not `install.sh`); `mnemoteca --version`; `mnemoteca setup` if `stats` reports missing models/ONNX runtime.
- [ ] **Step 4:** `mkdir -p ~/.mnemoteca-migration-exports/manual-mnemosyne-export` (must be empty); `~/bin/mnemosyne export --all --yes --output ~/.mnemoteca-migration-exports/manual-mnemosyne-export`.
- [ ] **Step 5:** Count export: number of `*.jsonl` = collections; sum of (lines − 1) = documents. Must equal Step 1.
- [ ] **Step 6:** `mnemoteca stats --format json` → `collection_count: 0`, `document_count: 0`, `database_path` ≠ old `Database Path:` (after resolving symlinks). Else STOP.
- [ ] **Step 7:** `mnemoteca import --dir ~/.mnemoteca-migration-exports/manual-mnemosyne-export` — exactly once.
- [ ] **Step 8:** `mnemoteca stats --format json` counts equal Step 5; `mnemoteca search --fts-only --no-rerank --limit 5 "<known global memory>"` and one project memory return the expected text. Mismatch → STOP: destination is partial, do not re-import, report to human.

### Task 4: Wire plugin into config repo + live smoke (private machine)

**Files (config repo):** `.gitmodules`, `opencode-mnemoteca/` (submodule), `plugins/mnemoteca.js` (file symlink), `opencode.json`, `package.json` (gitignored), `docs/dev-guide.md`.

> Ruling 5 (final review, verified live): v2.0.22 silently skips a **directory** plugin whose entry is only in `package.json#main` (`Host.resolve` tries `<dir>/server`, `<dir>/index` only). Use a **file** symlink to `dist/index.js`.

- [ ] **Step 1:** `git submodule add -b opencode-v2 https://github.com/jabbas/opencode-mnemoteca.git opencode-mnemoteca`; `(cd opencode-mnemoteca && npm ci && npm run build)`; `ln -s ../opencode-mnemoteca/dist/index.js plugins/mnemoteca.js` (dangling until built — dev-guide must say so).
- [ ] **Step 2:** Remove `"opencode-mnemosyne"` from `plugin` in `opencode.json` and from `package.json`; `jq . opencode.json` parses.
- [ ] **Step 3:** `docs/dev-guide.md` (read it first, follow its conventions): replace the `opencode-mnemosyne` bullet with the mnemoteca fork entry (submodule + symlink, rebuild `npm ci && npm run build` after every submodule update, binary `brew install gandazgul/tap/mnemoteca`, data `~/.local/share/mnemoteca/mnemoteca.db`); add `opencode-mnemoteca/` to the layout tree; update the "Memory config" row; fix the `package.json` deps note.
- [ ] **Step 4:** Smoke in a fresh `opencode` session in `~/.config/opencode`: log shows mnemoteca plugin loaded once, no `LoadError`; agent calls `memory_recall_global` (returns a migrated memory), `memory_store` ("smoke test 2026-10-04"), `memory_recall` (finds it), `memory_delete` (removes it). Save transcript excerpt + log lines to `~/Projects/opencode-mnemoteca/.pr-evidence.md` (not committed) for the PR.
- [ ] **Step 5:** `git add .gitmodules opencode-mnemoteca plugins/mnemoteca.js opencode.json docs/dev-guide.md && git commit -m "feat: switch memory plugin to mnemoteca v2 fork"`.

### Task 5: Upstream PR (HARD GATE)

- [ ] **Step 1:** In `~/Projects/opencode-mnemoteca`: `git fetch upstream && git rebase upstream/<default>`; `npm test && npm run ci` green; `git push --force-with-lease`.
- [ ] **Step 2:** Draft PR body in `$TMPDIR/pr-body.md`: problem (exact `Plugin must export a default definition…` error on OpenCode v2.0.22), change (core extraction, `src/v2.ts`, dual export; v1 behavior unchanged — existing tests untouched and green), testing (`npm test`, live v2.0.22 smoke from `.pr-evidence.md`; v1 not run live), prior-work search result (Task 0 Step 4), disclosure (model, harness OpenCode v2.0.22, plugins from `opencode.json`).
- [ ] **Step 3:** Show the human the full `git diff upstream/<default>...opencode-v2` and the PR body. **Wait for explicit approval.**
- [ ] **Step 4:** After approval only: `gh pr create -R gandazgul/opencode-mnemoteca --base <default> --head jabbas:opencode-v2 --title "Add OpenCode v2 support (dual export, v1 unchanged)" --body-file "$TMPDIR/pr-body.md"`. Report URL.

### Task 6: Work machine rollout (on the work machine)

- [ ] **Step 1:** `cd ~/.config/opencode && git pull && git submodule update --init opencode-mnemoteca && (cd opencode-mnemoteca && npm ci && npm run build)`.
- [ ] **Step 2:** Inventory: `which mnemosyne`, `mnemosyne stats` (path + counts). No legacy DB → skip to Step 4 after `brew install gandazgul/tap/mnemoteca`.
- [ ] **Step 3:** Repeat Task 3 Steps 2–8 with this machine's binary path and counts.
- [ ] **Step 4:** Repeat Task 4 Step 4 smoke (no evidence file needed). If `opencode.jsonc` there references `opencode-mnemosyne`, remove it (local, gitignored).

### After merge (not part of this execution)

Replace submodule + symlink with pinned `"opencode-mnemoteca@<version>"` in `plugin`; remove backup, `~/bin/mnemosyne` and legacy paths (per migration doc "Cleanup") after ~2 weeks stable — on human instruction.
