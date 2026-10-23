# permission-model

OpenCode v2 plugin implementing permission model v2 (spec:
`docs/superpowers/specs/2026-10-22-permission-model-v2-design.md`). Dependency-free ESM.

## Files

| File | Role |
|---|---|
| `index.js` | Plugin entrypoint (`id: "permission-model"`): hooks `tool.execute.before` + `permission.evaluate`, shadow/enforce, fail-safe (error/timeout 250 ms → ask), alive marker. Env overrides: `PM_CONFIG_DIR`, `PM_LOG_FILE`, `PM_ALIVE_FILE` |
| `log.js` | `appendLog(file, entry)` JSONL decision log (heredoc → `<<heredoc>>`, `password|token|secret=` masked, resource ≤ 300), `redactResource`, `expandHome` |
| `session.js` | `createCorrelator(ttl=120s, max=500)` (tool-call id → command), `sessionDir(ctx, sessionID)` (cached 60 s) |
| `parse.js` | Shell parser: `parseCommand(command) -> Simple[]`, `stripQuotes(text)` |
| `unwrap.js` | `unwrap(simples, {cwd, home, tmpRoots, env}) -> Invocation[]`; `expandVars`, `hasUnresolved` |
| `target.js` | `resolveTarget(inv, cfg, {home, tmpRoots, readFile, env}) -> Target`; `matchPattern`, `inTmp` |

## Unwrapper / target contract (Task 3)

- **Check `inv.unresolved` BEFORE trusting `Target.cls`.** A resolvable-looking target (e.g. `kubectl delete $KIND $NS`
  resolves to the current context) says nothing about what the command actually does when the verb/args are
  dynamic, and `xargs`/`eval` set `unresolved` too.
- A `local` invocation can carry `contextSwitch: true` (e.g. `asp x; cargo test`). `resolveTarget` keeps its
  `cls: "local"`; the classifier must still decide what to do with the flag — `Target.cls` is not the whole story.
- **Class order (R7):** `kind-*` → dev; otherwise the user lists in `targets`; a name matching several lists gets the
  stricter class (prod > home > dev); nothing matched → `unknown` (treated like prod). Default prod list includes
  `prod-*` / `prd-*`. There is no built-in "contains prod" heuristic.
  Caveat: with the default `*-prod`, a name such as `work-non-prod` is prod even if listed in `dev`. To make it dev,
  narrow `targets.prod` in `permission-model.local.json` (arrays replace).
- **Tmp kubeconfig (R8):** a `--kubeconfig`/`KUBECONFIG` entirely inside a tmp root is `dev` without reading it, **but** an
  explicit `--context` that classifies as prod still wins (`prod`): a tmp copy of a real kubeconfig can reach real
  clusters.
- **Server `KUBECONFIG` (R9):** if the server process env has `KUBECONFIG` and the command gives no
  `--context`/`--kubeconfig`/literal `KUBECONFIG=`, the kube target is `unknown` (the file in use may not be
  `~/.kube/config`).
- `inTmp(absPath, tmpRoots)` normalises `/var`↔`/private/var` and `/tmp`↔`/private/tmp` and resolves `..`.

Tests: `node --test scripts/permission-model/test-parse.mjs` (finds the plugin via env
`PM_PLUGIN_DIR`, default `../../plugins/permission-model` relative to the test file).

## How OpenCode loads a DIRECTORY under `plugins/` (verified in opencode v2.0.22 sources)

1. **Discovery** — `packages/core/src/plugin/source-directory.ts` lists the entries of
   `<config dir>/plugin` and `<config dir>/plugins`, sorted by path. A `*.ts`/`*.js` **file**, a
   **directory**, or a **symlink** to either is a plugin target. (Hidden/other file types are ignored.)
2. **Entrypoint** — `packages/core/src/plugin/module.ts` `load()` calls
   `Host.resolve({ directory })` (`packages/plugin/src/host.ts`) for a directory target. With no
   package `name`, it tries, in order, `<dir>/server` and then `<dir>/index`, resolved through
   `resolveModule` (Bun/Node resolution **with extension probing**, so `server.js|ts`, `index.js|ts`).
   First hit wins; `tui` (`<dir>/tui`) and `rpc` (`<dir>/rpc`) are separate optional entrypoints.
   If neither `server` nor `index` exists: `LoadError "Plugin entrypoint not found: <dir>"`.
   **`package.json` is NOT required** (and `main`/`exports` are not consulted for a local directory,
   because the specifier is a path, not a package name). So `index.js` is the entrypoint; **do not add
   a `server.*` file**, it would shadow `index.js`.
3. **Module shape** — the module must `export default` a definition with an `id` and a `setup`
   function (or an `effect`); otherwise `"Plugin must export a default definition with an id and an
   effect or setup function."` The `id` is `permission-model`.
4. **Reload** — `packages/plugin/src/source.ts` (`createPluginSources`) tracks every file of the
   entrypoint's import graph (digest per file, filesystem watch). **Any write to a file in
   `plugins/permission-model/` reloads the plugin and can restart the server** — develop on a copy
   in `$TMPDIR` and copy over once.
5. Sibling `*.js` files inside the directory (like `parse.js`) are plain imports of `index.js`; they
   are not plugin targets themselves because discovery is not recursive.

Because no `package.json` is needed, none is shipped. (Node ≥ 22.7 detects the ESM syntax of `.js`
files without one; tests run on Node 26.)

## Known gaps

- **"git push to main/master of a foreign repo" (spec §4.3) is not implemented.** Telling "own" from
  "foreign" needs the remote URL, which cannot be resolved without I/O. `git push` is `ext-write`
  with target class `home`; force / delete / mirror pushes are `irreversible`. A variable anywhere in
  a `git push` (or as the git verb) is `opaque` → ask.
- `grep`/`glob` do not assert a path (spec §4.2) — unchanged.
- `env | grep ^X` is only allowed when the filter is prefix-anchored (`commandAllow` in `config.js`).

## Parser contract (`parse.js`)

```
Simple = {
  words:     string[],   // quotes removed; expansions keep their source text ("$(kubectl get ns)", "$K")
  dynamic:   boolean[],  // parallel to words: word contains $VAR, ${…}, $( ), `…`, <( )
  assigns:   { name, value, dynamic? }[],  // leading NAME=value
  redirects: { op, target, dynamic? }[],   // ">", "2>", ">>", "&>", "<", "2>&1" (target "1") …
  heredoc:   boolean,    // `<<` heredoc present; its body is DATA and is never parsed as commands
  heredocExpands: boolean, // a heredoc delimiter is unquoted (`<<EOF`) → the body expands $( ) / $VAR at runtime
  stdinFrom?: "heredoc" | "herestring" | "pipe",
  nested?:   "subst" | "shell-c",  // found inside $( ) / `…` / <( ) / ( ) → "subst"; inside sh -c '…' → "shell-c"
  funcDef?:  true,       // `name ( )` — shell function definition
  raw:       string,     // source text of this command (without a heredoc body)
}
```

- Splits on `; && || | & \n`; recursion into `$( )`, backticks, `<( )`, subshells `( )` and
  `sh|bash|zsh|dash|ksh [opts] -c SCRIPT` (also after `env`/`command`/`exec`/`builtin`/`nohup`).
- An outer command is emitted before the commands nested in it.
- Leading grammar words (`if then do ! { time …`) are dropped from `words`.
- Compound headers are NOT modelled: `for f in a b`, `case x in a)`, `while …` headers appear as
  pseudo-commands whose `words[0]` is the keyword (`for`, `case`, …). Callers must not treat them as
  command names; the body commands are separate Simples.
- Substitutions hidden inside text that is not split into words are still found and emitted as
  `nested:"subst"`: `${x:-$(cmd)}`, arithmetic `$((1+$(cmd)))` / `(( … ))`, array assignment
  `A=( $(cmd) )`. This scan is deliberately over-approximate (single quotes inside `${…}` / arrays are
  not honoured), so it can emit an extra nested command, never miss one. The word keeps `dynamic: true`.
- `words` have quotes removed, so quoting is only recoverable from `raw` (e.g. to tell `'$x'` from `$x`
  use `dynamic`; to tell `"a b"` from `a b` use `raw`).
- Never throws; unterminated quotes/brackets run to the end of input; nesting is capped at depth 20.
- Port of the splitter/heredoc/`$( )` handling of `plugins/shell-style.js` **without** its five rules.
- **Heredoc bodies:** an *unquoted* heredoc (`<<EOF`) expands `$( )` in its body at runtime; the parser
  still treats every heredoc body as data (per spec: "heredoc = dane") and does not emit those inner
  commands. It flags the case with `heredocExpands: true`; callers that care decide what to do.
