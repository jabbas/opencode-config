# agent-guard — etap 1 (plugin uprawnień) Implementation Plan

> **Status: ODŁOŻONY (2026-10-19).** Użytkownik wybrał wariant A (sama konfiguracja). Plan zostaje na wypadek powrotu do pluginu; nic z niego nie zostało zaimplementowane poza pustym repo.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plugin OpenCode v2 `agent-guard`, który przez hook `permission.evaluate` decyduje allow/ask/deny po tym, GDZIE agent zapisuje i CZEGO dotyka, tak by na korpusie audytu z 930 pytań zostało ≤ ~120 — najpierw w trybie `shadow`, potem `enforce`.

**Architecture:** Osobne repo TypeScript `opencode-agent-guard`. Czyste moduły (opcje → strefy ścieżek → analizator komend powłoki na tree-sitter-bash → klasyfikator → silnik decyzji) plus cienka warstwa pluginu (correlator wywołań z `tool.execute.before`, hook `permission.evaluate`, fail-safe, log JSONL). Bundlowane esbuildem do `dist/` (commitowany), dołączone do `~/.config/opencode` jako submoduł i symlink w `plugins/`. Etap 2 (piaskownica) — osobny plan.

**Tech Stack:** TypeScript (ESM), Node ≥ 22, yarn, vitest, esbuild, `web-tree-sitter@0.25.10` + `tree-sitter-bash@0.25.0` (te same wersje co OpenCode v2.0.22), typy z `@opencode/plugin` (tylko `import type`).

**Spec:** `~/.config/opencode/docs/superpowers/specs/2026-10-19-agent-guard-design.md` (dalej „spec”). Wykonawca czyta spec i plan razem; tabele zasad §3 są źródłem prawdy dla wartości domyślnych.

## Global Constraints

- Repo robocze: `~/Projects/opencode-agent-guard`; GitHub `jabbas/opencode-agent-guard` — **prywatne** (fixtures zawierają komendy z realnych sesji).
- Wersje parsera dokładnie: `web-tree-sitter` `0.25.10`, `tree-sitter-bash` `0.25.0`.
- Żadnych hardkodowanych ścieżek domowych: `os.homedir()`, `os.tmpdir()`, `XDG_DATA_HOME` (domyślnie `~/.local/share`), `fs.realpath`. Plugin działa na obu maszynach (prywatna i służbowa) i na systemie bez `sandbox-exec`.
- Plik pluginu nie może wymagać `node_modules` w runtime: `dist/index.js` (jeden plik ESM) + `dist/*.wasm` obok; z `@opencode/plugin` wyłącznie `import type`.
- Plugin **nigdy nie łagodzi** otrzymanego `deny` (spec §4.3). Przy wyjątku/przekroczeniu czasu → `ask` z komunikatem błędu, nigdy cichy `allow` (spec §4.2 Fail-safe). Budżet czasu decyzji: 250 ms na wywołanie, potem fail-safe.
- Komunikaty (`message`) po polsku, prefiks `agent-guard: ` (dokładne szablony w Task 6).
- Log decyzji bez treści heredoców i bez wartości sekretów; zasób przycięty do 300 znaków.
- Tryby: `shadow` (loguj decyzję, nie zmieniaj `event.effect`) i `enforce`. Start zawsze w `shadow`.
- Opcje: `~/.config/opencode/agent-guard.json` (w repo konfiguracji) + `agent-guard.local.json` (gitignored), local nadpisuje (spec §4.2). Brak plików = wartości domyślne z kodu.
- Zakres akcji: plugin decyduje tylko dla `read`, `edit`, `shell` (i nazw akcji grep/glob, jeśli v2 używa osobnych — Task 1 ustala); `external_directory` i wszystko inne → natywny `effect` bez zmian (spec §3.9), z wyjątkiem twardego zakazu z §3.4.
- Commity małe, Conventional Commits, bez `--force`.

## Review Focus

1. **Ścieżka, która jeszcze nie istnieje** (nowy plik w nowym katalogu, `mkdir -p a/b && echo > a/b/c`) — `realpath` rzuca ENOENT; oczekiwane: rozwiązanie po najbliższym istniejącym przodku, poprawna strefa. Test w Task 3.
2. **Aliasowane korzenie** `/tmp`↔`/private/tmp`, `/var/folders`↔`/private/var/folders`, katalog sesji będący symlinkiem — zapis do tmp ma być `SCRATCH`, nie `OUTSIDE-WRITE`. Test w Task 3.
3. **Brak korelacji** (żądanie uprawnienia bez wcześniejszego `tool.execute.before`, np. po restarcie serwera, `!` użytkownika) — oczekiwane: analiza samych `resources` z `cwd` = katalog sesji; nie cichy allow dla zapisów, których nie da się rozwiązać. Test w Task 7.
4. **Ogromna komenda / heredoc 200 KB albo parse error** — oczekiwane: decyzja w budżecie 250 ms albo fail-safe `ask`; brak wycieku treści do logu. Testy w Task 4 i Task 7.
5. **`agent` nieobecny w zdarzeniu albo nieznany** — oczekiwane: profil „diagnoza” (spec §3.8), nie „pełny”. Test w Task 6.

---

### Task 1: Szkielet repo, fixtures korpusu, potwierdzenie API v2

**Files:**
- Create: `~/Projects/opencode-agent-guard/{package.json,tsconfig.json,vitest.config.ts,esbuild.config.mjs,.gitignore,README.md}`
- Create: `src/index.ts` (pusty plugin), `src/types.ts`
- Create: `fixtures/audit/{evaluated.json,classified.json,remaining.json}` (kopie z `$TMPDIR/opencode/permaudit/`), `fixtures/audit/README.md` (pochodzenie, data, schemat pól)
- Create: `docs/v2-api-notes.md`
- Test: `test/smoke.test.ts`

**Interfaces:**
- Produces: `src/types.ts`:
  ```ts
  export type Effect = "allow" | "ask" | "deny"
  export type Profile = "full" | "diagnose" | "restricted"
  export type Category = "READ" | "LOCAL-BUILD" | "PROJECT-WRITE" | "SCRATCH" | "EXTERNAL-ALLOWED"
    | "EXTERNAL-ASK" | "SYSTEM" | "SENSITIVE-DENY" | "SENSITIVE-ASK" | "PROTECTED-WRITE" | "OUTSIDE-WRITE" | "UNKNOWN"
  export interface Decision { effect: Effect; category: Category; message?: string; detail?: string }
  ```
- Produces: `docs/v2-api-notes.md` z odpowiedziami (z cytatem plik:linia z `~/Projects/opencode-v2.0.22/packages`) na: (a) czy `tool.execute.before` dla powłoki odpala PRZED `permission.evaluate` tego samego wywołania i czy `event.messageID`/`event.id` == `source.messageID`/`source.id`; (b) nazwy akcji uprawnień dla `grep`, `glob`, `write` (czy `write` używa `edit`); (c) kształt `resources` dla read/edit wewnątrz i poza katalogiem sesji; (d) jak z kontekstu pluginu dostać katalog sesji i worktree (`ctx.session.get({sessionID})` → `location`?); (e) czy loader pluginów przyjmuje zwykły obiekt `{ id, setup }` zamiast `Plugin.define(...)` i jak ładuje `plugins/*.js` z katalogu konfiguracji; (f) czy hook dostaje `agent` dla subagentów.

- [ ] **Step 1:** `git init`, `yarn init`, zależności dokładnie: `web-tree-sitter@0.25.10`, `tree-sitter-bash@0.25.0`; dev: `typescript`, `vitest`, `esbuild`, `@types/node`, `@opencode/plugin` (typy; wersja zgodna z v2.0.22). Skrypty: `build` (esbuild → `dist/index.js` ESM, platform node, bundle, kopiuje `tree-sitter.wasm` i `tree-sitter-bash.wasm` do `dist/`), `test` (vitest run), `typecheck` (tsc --noEmit).
- [ ] **Step 2:** Skopiuj korpus do `fixtures/audit/`. Przeskanuj kopie regexem na wzorce sekretów (`ghp_`, `gho_`, `sk-`, `AKIA`, `-----BEGIN`, `eyJ` z ≥ 40 znakami, `password=`/`token=` z wartością ≥ 12 znaków); trafienia zastąp `<REDACTED>` i wypisz ich liczbę w `fixtures/audit/README.md`.
- [ ] **Step 3:** Napisz `test/smoke.test.ts`: `import plugin from "../src/index"`; `expect(plugin.id).toBe("agent-guard")`; `expect(typeof plugin.setup).toBe("function")`; oraz `fixtures/audit/evaluated.json` parsuje się i ma > 4000 wpisów.
- [ ] **Step 4:** Run `yarn test` → FAIL (brak `src/index.ts`).
- [ ] **Step 5:** `src/index.ts`: domyślny eksport `{ id: "agent-guard", setup(ctx) {} }` typowany przez `import type`.
- [ ] **Step 6:** Run `yarn test && yarn build` → PASS; `dist/index.js` i oba `.wasm` istnieją.
- [ ] **Step 7:** Ustal odpowiedzi (a)–(f) czytając źródła v2.0.22 (`core/src/tool/plugin/shell.ts`, `core/src/permission.ts`, `core/src/file-access.ts`, `core/src/tool/plugin/{read,edit,write,grep,glob}.ts`, `core/src/config/plugin/source.ts`, loader pluginów) i zapisz w `docs/v2-api-notes.md`. Jeśli (a) brzmi „nie” — zatrzymaj się i zgłoś: Task 7 wymaga wtedy innej korelacji (zgłoś propozycję).
- [ ] **Step 8:** Commit `chore: scaffold agent-guard, audit fixtures, v2 API notes`.

### Task 2: Opcje i wartości domyślne

**Files:**
- Create: `src/options.ts`, `src/defaults.ts`
- Test: `test/options.test.ts`

**Interfaces:**
- Consumes: `Profile` z Task 1.
- Produces:
  ```ts
  export interface CliRule { allow?: string[]; ask?: string[]; askAllElse?: boolean } // podkomendy jako "a b" prefiksy
  export interface GuardOptions {
    mode: "shadow" | "enforce"
    profiles: { full: string[]; diagnose: string[]; restricted: string[] }
    agentExceptions: Record<string, string[]>          // agent -> wzorce komend allow (glob jak v2: * = cokolwiek)
    tmpRoots: string[]                                  // dodatkowe, poza os.tmpdir() i /tmp
    sensitiveDeny: string[]; sensitiveAsk: string[]     // globy ścieżek (~ rozwijane)
    protected: string[]                                 // globy ścieżek
    knownCli: Record<string, CliRule>                   // gh, jk, mnemoteca, ... (rozszerzalne)
    logFile: string
  }
  export const DEFAULT_OPTIONS: GuardOptions
  export function loadOptions(configDir: string, env?: NodeJS.ProcessEnv): Promise<GuardOptions>
  export function mergeOptions(base: GuardOptions, override: Partial<GuardOptions>): GuardOptions
  ```
- Wartości `DEFAULT_OPTIONS` — dokładnie ze specu: profile §3.8 (full: general, coder, devops, frontend, cloudflare, writer, skill-smith, stitch, build, ha, jenkins; diagnose: debugger, explore; restricted: architect, plan, autopilot, webscraper, webresearcher, webmonitor, jira, stitch-mcp); `agentExceptions.ha = ["ssh esp.iot *", "ssh -o BatchMode=yes esp.iot *", "scp * esp.iot:*", "scp esp.iot:* *"]`; sensitive §3.4; protected §3.5 (w tym `~/.config/opencode/{opencode.json,opencode.jsonc*,opencode.*.json,agents/**,secrets/**,agent-guard*.json,opencode-agent-guard/**,plugins/**}`, `**/.opencode/**`, `<dataDir>/opencode.db*`, `<dataDir>/agent-guard/**`); `knownCli` z §3.3 (jk allow = lista odczytów z §3.3; mnemoteca allow `stats`,`search`,`list`, askAllElse); `logFile = <dataDir>/agent-guard/decisions.jsonl`, `dataDir = $XDG_DATA_HOME/opencode` lub `~/.local/share/opencode`.

- [ ] **Step 1:** Testy w `test/options.test.ts`: `loads defaults when no files` (`mode === "shadow"`, `profiles.diagnose` zawiera `"debugger"`); `local overrides shared` (shared `{mode:"shadow"}`, local `{mode:"enforce"}` → `"enforce"`); `arrays in override replace, objects merge` (`knownCli` z override dodaje `"crane"` i zachowuje `"gh"`); `invalid JSON falls back to defaults and reports` (zwraca defaults, nie rzuca; `console.warn` wywołany); `respects XDG_DATA_HOME for logFile`.
- [ ] **Step 2:** `yarn test test/options.test.ts` → FAIL.
- [ ] **Step 3:** Zaimplementuj `src/defaults.ts` i `src/options.ts` (merge: obiekty rekurencyjnie, tablice zastępują).
- [ ] **Step 4:** `yarn test test/options.test.ts` → PASS.
- [ ] **Step 5:** Commit `feat: guard options with spec defaults`.

### Task 3: Strefy i klasyfikacja ścieżek

**Files:**
- Create: `src/zones.ts`, `src/glob.ts`
- Test: `test/zones.test.ts`

**Interfaces:**
- Consumes: `GuardOptions` (Task 2).
- Produces:
  ```ts
  export interface Zones { project: string[]; tmp: string[]; home: string; configDir: string; dataDir: string }
  export type PathZone = "project" | "tmp" | "outside"
  export interface PathFlags { sensitive: "deny" | "ask" | null; protected: boolean }
  export function resolveZones(i: { sessionDir: string; worktreeRoot?: string; home: string; tmpRoots: string[]; configDir: string; dataDir: string }): Promise<Zones>
  export function canonical(p: string, base: string, home: string): Promise<string>
  export function zoneOf(abs: string, z: Zones): PathZone
  export function flagsOf(abs: string, z: Zones, o: GuardOptions): PathFlags
  export function globMatch(pattern: string, abs: string, home: string): boolean // ~ rozwijane, * i ** = cokolwiek włącznie z "/"
  ```
- Reguły strefy projektu dokładnie wg spec §3.1 (A2): project = [sessionDir] (+ worktreeRoot jeśli ≠ home i ≠ "/"); jeśli sessionDir ∈ {home, "/"} → project = []. tmp = realpath(`/tmp`), realpath(`os.tmpdir()`), realpath(korzeń `$TMPDIR` — katalog `…/T`), + `tmpRoots`.

- [ ] **Step 1:** Testy (używaj katalogów w `os.tmpdir()` tworzonych w `beforeAll`): `project is session dir plus worktree`; `worktree equal to home is ignored`; `session dir equal to home means no project zone` (`project` = `[]`, a zapis do `~/x` → `outside`); `tmp aliases resolve` (`/tmp/x` i `/private/tmp/x` → `tmp`); `nonexistent path resolves via nearest ancestor` (`<session>/new/dir/file` → `project`); `symlinked session dir` (symlink → ten sam wynik co cel); `ssh private key is deny, pub is not` (`~/.ssh/id_ed25519` → `deny`, `~/.ssh/id_ed25519.pub`, `~/.ssh/config`, `~/.ssh/known_hosts` → `null`); `auth.json deny`; `secrets and env ask` (`<session>/secrets/x`, `<session>/.env.local`, `~/.kube/config`, `x.pem` → `ask`); `protected config` (`~/.config/opencode/opencode.json`, `…/agents/coder.md`, `<proj>/.opencode/opencode.json`, `<dataDir>/opencode.db-wal`, `~/.config/opencode/agent-guard.local.json` → `protected: true`; `~/.config/opencode/docs/x.md` → `false`).
- [ ] **Step 2:** `yarn test test/zones.test.ts` → FAIL.
- [ ] **Step 3:** Zaimplementuj (`canonical`: rozwiń `~`, `path.resolve(base, p)`, realpath najbliższego istniejącego przodka + doklej resztę).
- [ ] **Step 4:** → PASS.
- [ ] **Step 5:** Commit `feat: path zones and sensitive/protected flags`.

### Task 4: Analizator komend powłoki

**Files:**
- Create: `src/shell/parser.ts` (ładowanie wasm, lazy, ścieżki względem `import.meta.url` w `dist/`), `src/shell/analyze.ts`, `src/shell/unwrap.ts`, `src/shell/targets.ts`
- Test: `test/analyze.test.ts`

**Interfaces:**
- Consumes: `canonical` (Task 3).
- Produces:
  ```ts
  export interface Invocation {
    argv: string[]            // po zdjęciu opakowań i rozwinięciu zmiennych/funkcji z tej samej komendy
    cwd: string               // absolutny, po śledzeniu cd
    writes: string[]          // absolutne cele zapisu (kanoniczne)
    reads: string[]           // absolutne pliki czytane jawnie (argumenty cat/head/grep/…, przekierowanie <)
    unresolved: boolean       // komenda lub cel zależy od nieznanej zmiennej
    nested?: "shell-c"        // pochodzi z bash/sh/zsh -c
  }
  export function analyzeCommand(command: string, cwd: string, home: string): Promise<Invocation[]>
  ```
- Zachowanie dokładnie wg spec §3.2 (tabela „Opakowania”) i §3.1 (lista dróg zapisu). Opakowania: `timeout`/`gtimeout` (z opcjami i czasem), `time`, `nice [-n N]`, `nohup`, `env [-i] [-u X]… [VAR=…]…`, `VAR=… cmd`, `command [-p]` (ale `command -v` = READ zwykłej komendy `command`), `builtin`, `exec`, `xargs` (argv po opcjach; cele nieznane → `unresolved`). Rozwijanie: przypisania `X=…` i `X="…"` w tej samej komendzie przed użyciem `$X`/`${X}`; funkcje `f(){ … }` / `function f { … }` zdefiniowane w tej samej komendzie → ciało z podstawionymi `"$@"`/`$1..$9`. Cele zapisu: `>`, `>>`, `&>`, `>|` (pomijaj `/dev/null`, `/dev/stdout`, `/dev/stderr`, `&N`), `tee [-a] f…`, ostatni arg `cp`/`mv`/`ln`/`install`/`rsync` (lub `-t DIR`), wszystkie args `rm`/`rmdir`/`mkdir`/`touch`/`chmod`/`chown`/`truncate`, pliki `sed -i`/`sed --in-place`/`perl -i`/`perl -pi`, `tar -x… -C D` (bez `-C` → cwd), `unzip -d D` (bez → cwd), `curl -o/--output F`, `wget -O F`, `git -C D` (dla podkomend zapisujących: `checkout`, `restore`, `reset`, `clean`, `apply`, `am`, `merge`, `rebase`, `pull`, `stash`, `commit`, `add`, `rm`, `mv` → cel = D). Heredoc: treść nie jest analizowana jako komendy.

- [ ] **Step 1:** Testy `test/analyze.test.ts` (asercje na `argv`, `cwd`, `writes`):
  - `timeout 60 opencode debug agents` → argv `["opencode","debug","agents"]`, writes `[]`.
  - `env -u OPENCODE FOO=1 opencode serve` → argv[0] `opencode`.
  - `K="kubectl --context admin@k8s"; $K get pods -n x` → argv `["kubectl","--context","admin@k8s","get","pods","-n","x"]`.
  - `k(){ kubectl --context a "$@"; }; k -n flux-system get ks` → argv zaczyna się `["kubectl","--context","a","-n","flux-system","get","ks"]`.
  - `cd sub && echo hi > out.txt` (cwd = `<S>`) → writes `["<S>/sub/out.txt"]`.
  - `bash -c 'rm -rf /etc/x'` → jedna Invocation z `nested: "shell-c"`, writes `["/etc/x"]`.
  - `cat > src/lib.rs <<'EOF'\nfn main() { } impl X {}\nEOF` → dokładnie jedna Invocation (`cat`), writes `["<S>/src/lib.rs"]`; żadnej Invocation `fn`/`impl`.
  - `cargo test 2>&1 | tail -5` → writes `[]`.
  - `git -C ~/Projects/x checkout main` → writes `["<home>/Projects/x"]`; `git -C ~/Projects/x log -3` → writes `[]`.
  - `sed -i '' s/a/b/ ~/.hammerspoon/localconfig.lua` → writes zawiera ten plik.
  - `$UNKNOWN_CMD --flag` → `unresolved: true`.
  - `cmd > "$OUT"` przy nieznanym `$OUT` → `unresolved: true`.
  - parse 200 KB heredoca kończy się < 250 ms (mierz `performance.now()`).
- [ ] **Step 2:** `yarn test test/analyze.test.ts` → FAIL.
- [ ] **Step 3:** Zaimplementuj (tree-sitter: węzły `command`, `pipeline`, `list`, `redirected_statement`, `heredoc_body` pomijane; `function_definition`; `variable_assignment`).
- [ ] **Step 4:** → PASS. Dodatkowo `yarn build` i test, że `dist/index.js` ładuje wasm (test `test/dist-wasm.test.ts`: import `dist/` + `analyzeCommand("ls", "/tmp", home)` zwraca 1 Invocation).
- [ ] **Step 5:** Commit `feat: shell command analyzer with wrapper/function unwrapping and write targets`.

### Task 5: Klasyfikator komend

**Files:**
- Create: `src/classify/index.ts`, `src/classify/cli/{git,gh,jk,curl,kubectl,flux,helm,cloud,registry,mnemoteca,system,sensitive}.ts`
- Test: `test/classify.test.ts`

**Interfaces:**
- Consumes: `Invocation` (Task 4), `Zones`, `zoneOf`, `flagsOf` (Task 3), `GuardOptions` (Task 2).
- Produces:
  ```ts
  export interface Classification { category: Category; reason: string; target?: string }
  export function classifyInvocation(inv: Invocation, z: Zones, o: GuardOptions, agent?: string): Classification
  export function subcommand(argv: string[], globalFlagsWithValue: string[]): string[] // pomija flagi globalne przed podkomendą
  ```
- Kolejność reguł (pierwsza pasująca wygrywa): 1) twardy zakaz §3.4 (ścieżki w `reads`/`writes` z `flagsOf.sensitive==="deny"`, komendy `security`, `gcloud … print-access-token|print-identity-token`, `aws … get-session-token|get-secret-value|ecr get-login-password`) → `SENSITIVE-DENY`; 2) `agentExceptions[agent]` pasuje → `READ`; 3) cel zapisu `protected` → `PROTECTED-WRITE`; 4) cel zapisu w strefie `outside` → `OUTSIDE-WRITE`; 5) wrażliwy odczyt §3.4 (`flagsOf.sensitive==="ask"` w `reads`, `kubectl get secret(s) … -o yaml|json|jsonpath*|go-template*`, `env`/`printenv` bez argumentów lub z filtrem zawierającym `KEY|TOKEN|SECRET|PASS`) → `SENSITIVE-ASK` (`kubectl create secret … --dry-run=client` → nie); 6) tabele CLI §3.3 i §3.6 → `EXTERNAL-ALLOWED` / `EXTERNAL-ASK` / `SYSTEM`; 7) zapisy w project → `PROJECT-WRITE`, w tmp → `SCRATCH`; 8) znane narzędzia budowania/testów (cargo, rustc, go, npm, yarn, bun, npx, uv, uvx, pip, python3, node, busted, luacheck, make, tsc, vitest, pytest, podman build/run bez `--privileged` i bez `-v` spoza stref) → `LOCAL-BUILD`; 9) `unresolved` lub nieznane → `UNKNOWN`; reszta → `READ`.
- `kill`/`pkill`/`killall` → zawsze SYSTEM (ask). Rozpoznawanie „własnych” PID (spec §3.6) świadomie poza etapem 1 — spec dopuszcza „inaczej ask”; zanotuj w `docs/v2-api-notes.md` jako kandydat na później.
- Flagi globalne przed podkomendą: kubectl `--context,-n,--namespace,--kubeconfig,--request-timeout,-l`; flux `--context,-n,--namespace,--kubeconfig`; helm `--kube-context,-n,--namespace,--kubeconfig`; git `-C,-c,--git-dir,--work-tree`.

- [ ] **Step 1:** Testy tabelaryczne `test/classify.test.ts` (`it.each`, komenda → kategoria), co najmniej:
  - `git push origin main` → EXTERNAL-ALLOWED; `git push -uf origin x`, `git push origin +main`, `git push origin :feat`, `git push --force-with-lease`, `git push -d origin x`, `git push --mirror` → EXTERNAL-ASK.
  - `gh pr create --fill`, `gh issue comment 1 -b x` → EXTERNAL-ALLOWED; `gh release create v1`, `gh repo delete x`, `gh api repos/a/b -X DELETE`, `gh api repos/a/b -f x=1` → EXTERNAL-ASK; `gh api repos/a/b`, `gh pr view 1` → READ.
  - `jk log job/1`, `jk run ls job` → READ; `jk run start job` → EXTERNAL-ASK.
  - `curl https://x.io` → READ; `curl -X POST https://x.io -d a` → EXTERNAL-ASK; `curl -X POST http://localhost:8765/x` → READ.
  - `kubectl --context admin@k8s -n ci get pods -o yaml` → READ; `kubectl apply -f x.yaml` → EXTERNAL-ALLOWED; `kubectl delete ns foo`, `kubectl delete pvc data`, `kubectl delete pods --all` → EXTERNAL-ASK; `kubectl -n x get secret s -o yaml` → SENSITIVE-ASK; `kubectl describe secret s` → READ; `kubectl create secret generic s --from-literal=a=b --dry-run=client -o yaml` → READ.
  - `flux -n x reconcile ks y --with-source` → EXTERNAL-ALLOWED; `flux uninstall` → EXTERNAL-ASK; `helm upgrade x c` → EXTERNAL-ALLOWED; `helm uninstall x` → EXTERNAL-ASK.
  - `aws ec2 describe-instances` → READ; `aws s3 rm s3://b/k` → EXTERNAL-ASK; `aws secretsmanager get-secret-value --secret-id x` → SENSITIVE-DENY; `gcloud auth print-access-token` → SENSITIVE-DENY; `crane push img ref` → EXTERNAL-ASK.
  - `brew install x`, `defaults write a b c`, `pkill -f "opencode serve"`, `ssh host ls`, `hs -c 'x'`, `sudo ls` → SYSTEM; `brew info x`, `launchctl list`, `pmset -g` → READ; z agentem `ha`: `ssh esp.iot ls` → READ.
  - `cat ~/.ssh/id_ed25519` → SENSITIVE-DENY; `cat .env` → SENSITIVE-ASK; `env` → SENSITIVE-ASK; `env | grep -i ^XDG` → READ.
  - `echo x > ~/.config/opencode/opencode.json` → PROTECTED-WRITE; `perl -pi -e s/a/b/ ~/.hammerspoon/localconfig.lua` → OUTSIDE-WRITE; `rm -rf $TMPDIR/x` (TMPDIR z env procesu) → SCRATCH; `rm build/x` → PROJECT-WRITE.
  - `busted`, `luacheck .`, `yarn test`, `cargo test`, `python3 x.py`, `bash ~/.config/opencode/skills/x/review-package` → LOCAL-BUILD; `podman run --privileged x` → SYSTEM; `podman run -v /:/host x` → OUTSIDE-WRITE.
  - `mnemoteca stats` → READ; `mnemoteca delete 3` → EXTERNAL-ASK; `someunknowncli --do` → UNKNOWN.
- [ ] **Step 2:** → FAIL.
- [ ] **Step 3:** Zaimplementuj (każdy plik `cli/*.ts` eksportuje `classify(inv, o): Classification | undefined`; `knownCli` z opcji rozszerza tabele).
- [ ] **Step 4:** → PASS.
- [ ] **Step 5:** Commit `feat: classifier for known CLIs, sensitive data and write zones`.

### Task 6: Silnik decyzji i komunikaty

**Files:**
- Create: `src/decide.ts`, `src/messages.ts`, `src/profile.ts`
- Test: `test/decide.test.ts`

**Interfaces:**
- Consumes: Task 2–5.
- Produces:
  ```ts
  export interface GuardRequest {
    action: string; resources: readonly string[]; incoming: Effect; agent?: string
    sessionDir: string; worktreeRoot?: string
    call?: { tool: string; command?: string; workdir?: string; filePath?: string }
  }
  export function profileOf(agent: string | undefined, o: GuardOptions): Profile
  export function decide(req: GuardRequest, o: GuardOptions, env: { home: string; configDir: string; dataDir: string }): Promise<Decision>
  ```
- Mapowanie kategoria → efekt: READ, LOCAL-BUILD, PROJECT-WRITE, SCRATCH, EXTERNAL-ALLOWED, UNKNOWN → allow; EXTERNAL-ASK, SYSTEM, SENSITIVE-ASK, PROTECTED-WRITE, OUTSIDE-WRITE → ask; SENSITIVE-DENY → deny. Profil `diagnose`: EXTERNAL-ALLOWED → ask. Profil `restricted`: zwróć `incoming`, chyba że SENSITIVE-DENY → deny. `incoming === "deny"` → zawsze deny. Akcje spoza zakresu (§3.9) i `external_directory` → `incoming`, chyba że zasób ścieżki ma `sensitive === "deny"` → deny. Shell: analizuj `call.command` z `call.workdir ?? sessionDir`; bez `call` — każdy element `resources` osobno z `cwd = sessionDir`; wynik = najsurowszy (deny > ask > allow), `category` i `message` z najsurowszej Invocation. Read/edit: zasób względny → względem `sessionDir`; edit/write → klasyfikuj jako zapis, read → jako odczyt.
- Szablony (`src/messages.ts`, dokładnie):
  - OUTSIDE-WRITE: `agent-guard: zapis poza katalogiem sesji: {target}`
  - PROTECTED-WRITE: `agent-guard: zapis chronionej konfiguracji: {target}`
  - SENSITIVE-ASK: `agent-guard: dostęp do danych wrażliwych: {target}`
  - SENSITIVE-DENY: `agent-guard: twardy zakaz — dane wrażliwe: {target}`
  - EXTERNAL-ASK: `agent-guard: zmiana zewnętrzna wymagająca zgody: {cmd}`
  - SYSTEM: `agent-guard: zmiana systemu lub innej maszyny: {cmd}`
  - diagnoza: `agent-guard: agent {agent} ma profil „diagnoza” — zmiany zewnętrzne wymagają zgody: {cmd}`
  - błąd: `agent-guard: błąd pluginu ({error}) — pytam dla bezpieczeństwa`
  (`{cmd}` przycięte do 160 znaków, bez treści heredoca.)

- [ ] **Step 1:** Testy `test/decide.test.ts`: `profileOf(undefined)` i `profileOf("newagent")` → `"diagnose"`; `profileOf("coder")` → `"full"`; `incoming deny is never weakened` (action shell, `ls`, incoming deny → deny); `restricted passes incoming through` (architect, `cat x`, incoming ask → ask) ale `cat ~/.ssh/id_rsa` → deny; `debugger push asks` (`git push origin main`, agent debugger → ask, message z „diagnoza”); `coder push allows`; `compound picks strictest` (`ls && echo x > ~/x.txt` → ask, message zawiera `~/x.txt` w postaci absolutnej); `edit relative inside session allows` (action edit, resource `src/a.ts` → allow); `edit absolute outside asks`; `edit protected asks` (`/…/.config/opencode/opencode.json`); `read auth.json denies`; `external_directory passes through` (incoming ask → ask); `webfetch passes through`; `no call info falls back to resources` (resources `["echo x > /etc/y"]`, bez `call` → ask).
- [ ] **Step 2:** → FAIL.
- [ ] **Step 3:** Zaimplementuj.
- [ ] **Step 4:** → PASS.
- [ ] **Step 5:** Commit `feat: decision engine with profiles and Polish messages`.

### Task 7: Warstwa pluginu — correlator, hook, fail-safe, log, shadow

**Files:**
- Modify: `src/index.ts`
- Create: `src/correlate.ts`, `src/log.ts`, `src/session-info.ts`
- Test: `test/plugin.test.ts`, `test/correlate.test.ts`, `test/log.test.ts`

**Interfaces:**
- Consumes: `decide`, `loadOptions` i ustalenia z `docs/v2-api-notes.md` (Task 1).
- Produces:
  ```ts
  export interface CallInfo { tool: string; command?: string; workdir?: string; filePath?: string; at: number }
  export function createCorrelator(ttlMs?: number): { remember(messageID: string, callID: string, tool: string, input: unknown): void; take(source?: { messageID: string; id: string }): CallInfo | undefined }
  export interface LogEntry { ts: string; sessionID: string; agent?: string; action: string; resource: string; category: string; incoming: Effect; decided: Effect; applied: Effect; mode: "shadow" | "enforce"; reason?: string }
  export function appendLog(file: string, e: LogEntry): Promise<void>
  export function sessionInfo(ctx: unknown, sessionID: string): Promise<{ sessionDir: string; worktreeRoot?: string }> // cache per sessionID
  ```
- `setup(ctx)`: `loadOptions(configDir)`; `ctx.tool.hook("execute.before", …)` → `correlator.remember(event.messageID, event.id, event.tool, event.input)`; `ctx.permission.hook("evaluate", …)` → `decide(...)` z budżetem 250 ms (`Promise.race`); w `enforce` ustaw `event.effect`/`event.message`; w `shadow` tylko loguj; zawsze `appendLog`. Wyjątek → decyzja `ask` + komunikat „błąd”, log `category: "ERROR"`. Correlator: TTL 120 s, max 1000 wpisów. `resource` w logu = pierwsze 300 znaków, heredoc zastąpiony `<<heredoc>>`. `configDir` = katalog konfiguracji OpenCode (z ctx wg notatek Task 1, fallback `~/.config/opencode`).

- [ ] **Step 1:** Testy z atrapą `ctx` (rejestruje callbacki hooków, `session.get` zwraca `location.directory`): `shadow never changes effect` (komenda `echo > /etc/x`, incoming allow → effect pozostaje allow, log `decided: "ask"`); `enforce applies decision`; `correlated command beats resource fragments` (`before` z `cd sub && echo > a.txt`, potem evaluate z resources `["echo > a.txt"]` → wpis `<S>/sub/a.txt`, allow); `uncorrelated request falls back to resources` (bez `before` → analiza resources z cwd sesji); `decide throwing yields ask with error message` (wstrzyknięty wyjątek); `timeout yields ask` (decide zawiesza się > 250 ms); `log redacts heredoc and truncates` (wpis nie zawiera treści heredoca, `resource.length <= 300`); correlator `expires after ttl` i `caps at 1000 entries`.
- [ ] **Step 2:** → FAIL.
- [ ] **Step 3:** Zaimplementuj.
- [ ] **Step 4:** → PASS; `yarn typecheck && yarn build` → PASS.
- [ ] **Step 5:** Commit `feat: plugin wiring with correlator, fail-safe, shadow mode and decision log`.

### Task 8: Odtworzenie korpusu i tabela oczekiwanych decyzji (bramka użytkownika)

**Files:**
- Create: `scripts/replay.ts`, `fixtures/expected-decisions.json`, `docs/expected-decisions.md`
- Test: `test/replay.test.ts`

**Interfaces:**
- Consumes: `decide` (Task 6), fixtures (Task 1).
- Produces: `replay(corpus: CorpusEntry[], o: GuardOptions): ReplayResult` gdzie `ReplayResult = { total: number; asks: number; denies: number; byCategory: Record<string, number>; entries: { id: string; decision: Decision }[] }`; `CorpusEntry` = pola z `fixtures/audit/README.md` (agent, sessionDir, tool, command/filePath, action, resources).

- [ ] **Step 1:** `scripts/replay.ts` (uruchamiany `yarn replay`) wypisuje podsumowanie i zapisuje `fixtures/replay-output.json` (gitignored).
- [ ] **Step 2:** Zbuduj `fixtures/expected-decisions.json`: wszystkie wpisy `remaining.json` + losowa próbka 80 pozostałych (ziarno `20261019`), każdy `{ id, command|path, agent, expected: Effect, why: "§3.x" }` — etykiety ustalane ręcznie wg spec §3, **nie** z wyjścia replay; `EXTERNAL-MUTATE` ze starej taksonomii nie oznacza ask. `docs/expected-decisions.md` = ta sama tabela czytelnie, pogrupowana po §3.x.
- [ ] **Step 3:** Testy `test/replay.test.ts`: `asks on corpus <= 120`; `every expected decision matches` (lista niezgodności w komunikacie); `no allow for sensitive or protected` (wszystkie wpisy z kategoriami SENSITIVE-* i PROTECTED-WRITE ≠ allow); `debugger/explore never allow external mutation`.
- [ ] **Step 4:** Uruchom; dopasowuj **kod** (nie etykiety) do PASS. Etykietę wolno zmienić tylko z cytatem paragrafu specu w `why`.
- [ ] **Step 5:** Commit `test: corpus replay and expected decisions table`.
- [ ] **Step 6: BRAMKA.** Zatrzymaj się. Pokaż użytkownikowi `docs/expected-decisions.md` i podsumowanie replay (asks, denies, top 15 pozostałych pytań). Dalej dopiero po zatwierdzeniu tabeli (spec §6 krok 2).

### Task 9: Integracja z `~/.config/opencode` w trybie shadow

**Files:**
- Create (GitHub): prywatne repo `jabbas/opencode-agent-guard`, push `main` (z `dist/`).
- Modify (repo konfiguracji `~/.config/opencode`): `.gitmodules` (submoduł `opencode-agent-guard`), `plugins/agent-guard.js` (symlink → `../opencode-agent-guard/dist/index.js`), `agent-guard.json`, `.gitignore`, `opencode.json`, `docs/dev-guide.md`, `AGENTS.md`
- Test: weryfikacja `opencode debug agents` + sesja próbna

**Interfaces:**
- Consumes: zbudowany `dist/` (Task 7), `GuardOptions` (Task 2).

- [ ] **Step 1:** `gh repo create jabbas/opencode-agent-guard --private --source ~/Projects/opencode-agent-guard --push`. `dist/` jest commitowany (Global Constraints).
- [ ] **Step 2:** W `~/.config/opencode`: `git submodule add git@github.com:jabbas/opencode-agent-guard.git opencode-agent-guard`; symlink `plugins/agent-guard.js`; `agent-guard.json` = `{ "mode": "shadow" }` (resztę biorą wartości domyślne); `.gitignore` += `agent-guard.local.json`.
- [ ] **Step 3:** `opencode.json` (edytuj narzędziem edit — plik chroniony; użytkownik zatwierdza): w globalnym `permission` dodaj `external_directory`: `{"/tmp/*": "allow", "/private/tmp/*": "allow", "/private/var/folders/*/*/T/*": "allow"}`; w globalnym `permission.read` i `permission.edit` (zachowując istniejące reguły edit): `"~/.ssh/id_*": "deny"`, `"~/.ssh/id_*.pub": "allow"` (dla read; po deny), `"~/.local/share/opencode/auth.json": "deny"`; w `permission.edit` dodaj `ask` dla `~/.config/opencode/agent-guard*.json`, `~/.config/opencode/opencode-agent-guard/**`, `~/.config/opencode/plugins/**` (oraz względne odpowiedniki jak dla istniejących reguł).
- [ ] **Step 4:** Weryfikacja: `cd ~ && opencode debug agents` → reguły widoczne; ocena (jak w poprzednich audytach, last-match-wins) dla coder: read `~/.ssh/id_ed25519` → deny, read `~/.ssh/id_ed25519.pub` → allow, external_directory `/tmp/x/*` → allow.
- [ ] **Step 5:** Sesja próbna: utwórz `$TMPDIR/guard-smoke` z `git init`; uruchom `opencode run --agent coder "…"` (krótkie zadanie: utwórz plik, uruchom `ls`, `cat`, `echo > ~/guard-smoke-outside.txt`) — jedno uruchomienie modelu, za zgodą użytkownika. Sprawdź `~/.local/share/opencode/agent-guard/decisions.jsonl`: są wpisy, `mode: "shadow"`, zapis do `~/guard-smoke-outside.txt` ma `decided: "ask"`, reszta `allow`; zachowanie OpenCode bez zmian. Usuń pliki próbne.
- [ ] **Step 6:** `docs/dev-guide.md`: punkt o agent-guard (gdzie kod, opcje, log, tryby, fallback). `AGENTS.md`: 3–4 linie w sekcji uprawnień (plugin ma ostatnie słowo; „Always” nie omija jego decyzji; log decyzji).
- [ ] **Step 7:** Commit w `~/.config/opencode` `feat(permissions): add agent-guard plugin in shadow mode` i push (bez force); w `docs/dev-guide.md` dopisz krok dla drugiej maszyny: `git pull && git submodule update --init opencode-agent-guard`.

### Task 10: Przegląd shadow i przełączenie na enforce (bramka użytkownika)

**Files:**
- Create: `~/Projects/opencode-agent-guard/scripts/log-report.ts`
- Modify: `~/.config/opencode/agent-guard.json`
- Test: `test/log-report.test.ts`

**Interfaces:**
- Consumes: format `LogEntry` (Task 7).
- Produces: `report(entries: LogEntry[]): { total; asks; denies; changedVsIncoming: number; topAsks: { key: string; count: number }[] }` (klucz = kategoria + pierwsze 2 słowa argv).

- [ ] **Step 1:** Test `log-report.test.ts` na syntetycznym logu (5 wpisów) — liczby i sortowanie `topAsks`.
- [ ] **Step 2:** → FAIL; zaimplementuj; → PASS; commit `feat: shadow log report`.
- [ ] **Step 3: BRAMKA.** Po kilku dniach pracy w shadow uruchom `yarn log-report ~/.local/share/opencode/agent-guard/decisions.jsonl`; pokaż użytkownikowi: pytania/h, top pytań, wszystkie `deny`, wszystkie przypadki `incoming: ask → decided: allow` z kategorią PROJECT-WRITE/SCRATCH/UNKNOWN (próbka 30). Poprawki zasad → wróć do Task 5/6 z testem.
- [ ] **Step 4:** Po zgodzie użytkownika: `agent-guard.json` `"mode": "enforce"`; commit + push w `~/.config/opencode` (`feat(permissions): agent-guard enforce`).
- [ ] **Step 5:** Smoke (spec §6 krok 4, część etapu 1) w realnej sesji: cargo/busted/luacheck/yarn/uv/podman, devops `kubectl get/apply`, `flux reconcile`, `helm upgrade --dry-run`, `gh pr create --draft` (repo testowe), `git push` na gałąź testową — **bez pytań**; `echo x > ~/.hammerspoon/x` → pytanie z komunikatem „zapis poza katalogiem sesji”; `cat ~/.ssh/id_ed25519` → odmowa. Wynik do `docs/stage1-smoke.md` w repo pluginu.
