# Model uprawnień v2 (plugin `permission-model`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plugin OpenCode `permission-model`, który decyduje allow/ask/deny po **skutku** (lokalnie / odczyt na zewnątrz / zapis na zewnątrz / nieodwracalne / sekret / własna konfiguracja) i **celu** (dev / home / prod / nieznany), najpierw w trybie `shadow` na dzisiejszej konfiguracji, potem jako główna linia obrony przy odchudzonym `opencode.json`.

**Architecture:** Katalog `plugins/permission-model/` (plugin katalogowy, `index.js` + moduły ESM, bez zależności). Potok: `parse` (lekki parser powłoki z `shell-style`) → `unwrap` (opakowania, `cd`, zmiana kontekstu) → `target` (cel i klasa celu) → `classify` (klasa skutku) → `decide` (tabela §3 + „Always” per klasa) → `index` (hooki, korelacja, log, shadow/enforce). Osobna ścieżka `paths` dla narzędzi `read`/`edit`/`write`. Testy `node:test`, replay korpusu jako test akceptacyjny.

**Tech Stack:** Node ≥ 22 (runtime OpenCode/bun), plain ESM JS, `node:test` + `node:assert`, bez npm. Konfiguracja `~/.config/opencode/permission-model.json` (+ `permission-model.local.json`, gitignored).

**Spec:** `docs/superpowers/specs/2026-10-22-permission-model-v2-design.md` (dalej „spec”). Wykonawca czyta spec i plan razem; tabele §3, §4.x są źródłem prawdy dla wartości.

## Global Constraints

- **Zapis w `plugins/` przeładowuje serwer OpenCode i może zabić bieżące sesje** (także wykonawcy). Rozwijaj w `$TMPDIR/opencode/pm-dev/permission-model/` (kopia katalogu), testuj przeciw kopii (`PM_PLUGIN_DIR=<kopia> node --test …`), do `plugins/` kopiuj **raz na zadanie**, na końcu, jednym `cp -R`. Po kopii `sleep 15` i sprawdź log `~/.local/share/opencode/log/opencode.log` (brak ERROR z `permission-model`).
- Jedna prosta komenda na wywołanie powłoki (bez długich łańcuchów `&&`/`;`); pliki przez narzędzia write/edit.
- Plugin katalogowy: `plugins/permission-model/index.js` z `export default { id: "permission-model", setup }`; `permission-model.js` jako plik NIE może istnieć obok (loader ładuje i plik, i katalog). Loader (`core/src/plugin/source-directory.ts`) bierze katalogi w `plugins/` — Task 1 potwierdza, jaki plik wejściowy loader wybiera dla katalogu (`index.js`? `package.json` `main`?) i dostosowuje.
- Zero zależności npm; tylko `node:fs`, `node:os`, `node:path`.
- Plugin **nigdy nie łagodzi** `deny` z konfiguracji. Przy własnym błędzie/timeout (budżet 250 ms) → `ask` z komunikatem `permission-model: błąd pluginu (…)` (spec §5.2 Fail-safe), **nie** allow.
- Komunikaty `message` po polsku z prefiksem `permission-model: ` i celem (narzędzie, czasownik, kontekst/profil, klasa) — spec §4.6a.
- Log JSONL `~/.local/share/opencode/permission-model/decisions.jsonl`; bez treści heredoców (zastąp `<<heredoc>>`), bez wartości sekretów; zasób przycięty do 300 znaków.
- Tryb startowy: `shadow`. W `shadow` plugin **nie zmienia** `event.effect`, tylko loguje `decided` vs `incoming`.
- Wszystkie ścieżki domowe przez `os.homedir()`; tmp przez `os.tmpdir()` + `/tmp`, `/private/tmp`, `/private/var/folders/*/*/T`, `/var/folders/*/*/T` (realpath, aliasy `/var`↔`/private/var`).
- Commity: Conventional Commits, opis przez `git commit -F <plik>` (reguły czytają tekst komendy — bez ` -c `, ` -f `, `$`-słów, ścieżek kluczy w opisie).
- Spec §4.1 „Nierozpoznawalne” obowiązuje: znane zewnętrzne CLI z nieznanym czasownikiem/celem → `ext-write` z celem `unknown` → ask.

## Review Focus

1. **Zmiana kontekstu w tej samej komendzie** (`kubectl config use-context prod && kubectl delete ns x`, `export AWS_PROFILE=prod; aws s3 rm …`, `asp prod; aws …`) — oczekiwane: cel `unknown` → ask, nigdy allow z klasy dev. Test w Task 3 i Task 6.
2. **Kierunek S3** (`aws s3 cp s3://b/k ./x` odczyt vs `aws s3 cp ./x s3://b/k` zapis; `sync` analogicznie; `--delete` = nieodwracalne). Test w Task 4.
3. **`kubectl delete` w `flux-system`/`kube-system` przez `-n`, `--namespace=`, `--all-namespaces`, albo w pliku `-f`** — oczekiwane: `irreversible` także na dev. Test w Task 4.
4. **Sekret po rozpakowaniu** (`timeout 5 cat ~/.ssh/id_x`, `env X=1 gcloud auth print-access-token`, `cp $HOME/.ssh/id_rsa /tmp/k`) — oczekiwane: deny. Test w Task 4.
5. **Brak korelacji** (żądanie `shell` bez `execute.before`, np. po restarcie serwera) — oczekiwane: analiza samych `resources` z cwd = katalog sesji; dla znanych CLI z nieznanym celem → ask; nie cichy allow. Test w Task 7.

---

### Task 1: Szkielet pluginu katalogowego, parser, fixtures

**Files:**
- Create: `plugins/permission-model/index.js` (minimalny: `export default { id: "permission-model", setup() {} }`), `plugins/permission-model/parse.js`, `plugins/permission-model/README.md`
- Create: `scripts/permission-model/fixtures/{audit-evaluated.json,audit-remaining.json,session-commands.json,README.md}` (korpus z `$TMPDIR/opencode/permaudit/` + komendy z rozmów 2026-10-19..22 wypisane w `session-commands.json` jako `{ id, agent, cwd, command }`; sekrety zredagowane jak w agent-guard: `ghp_`, `sk-`, `AKIA`, `-----BEGIN`, `eyJ…`)
- Test: `scripts/permission-model/test-parse.mjs`

**Interfaces:**
- Produces (`parse.js`):
  ```js
  // Simple: jedna prosta komenda po rozbiciu na `; && || | & \n` i rekursji w $( ), ` `, <( )
  // { words: string[], assigns: {name, value}[], redirects: {op, target}[], heredoc: boolean,
  //   stdinFrom?: "heredoc"|"herestring"|"pipe", nested?: "shell-c"|"subst", raw: string }
  export function parseCommand(command) // -> Simple[]  (heredoc = dane, nie komendy; teksty w cudzysłowach zachowane w words, ale nie rozbijane)
  export function stripQuotes(text)     // pomocnicze dla testów
  ```
- Konstruktor przenosi parser z `plugins/shell-style.js` (splitter + heredoc + `$( )`), bez reguł `shell-style`.

- [ ] **Step 1:** Potwierdź w `~/Projects/opencode-v2.0.22/packages/core/src/plugin/{source-directory,source,module}.ts`, jak loader ładuje **katalog** w `plugins/` (który plik jest entrypointem; czy `package.json` jest wymagany). Zapisz w `plugins/permission-model/README.md`. Jeśli katalog nie jest wspierany bez `package.json`, dodaj minimalny `package.json` (`{"name":"permission-model","type":"module","main":"index.js"}`).
- [ ] **Step 2:** Skopiuj korpus do fixtures (z redakcją sekretów; README z liczbą wpisów i schematem pól). `session-commands.json`: ≥ 40 komend z tej rozmowy (talosctl usage/mounts, syft, ansible-lint z `.venv/bin`, kind create/delete, helm package, git clone, gh api, `kubectl --context admin@k8s …`, `flux --context … reconcile`, `cargo test` z env, `rm -rf $TMPDIR/x`, `bash $TMPDIR/guard.sh`, `sh <(yq …)`, `K="kubectl …"; $K get`, `head_code() {…}`, `cat > f <<EOF`, `kubectl delete ns`, `git push --force`…).
- [ ] **Step 3:** Testy `test-parse.mjs`: `splits on separators` (`a; b && c | d` → 4 Simple); `heredoc body is not commands` (`cat > f <<'EOF'\nfn main() {}\nEOF` → 1 Simple, `heredoc: true`, `stdinFrom: "heredoc"`); `substitution is nested` (`echo $(kubectl get ns)` → 2, drugi `nested: "subst"`); `quotes kept` (`kubectl get pods -o 'jsonpath={.items[?(@.x=="y")]}'` → words[4] zawiera cały jsonpath); `assignments` (`A=1 B=$x cmd` → assigns 2, words[0] `cmd`); `redirects` (`cmd > out 2>&1` → redirects `[{op:">",target:"out"},{op:"2>&1"...}]`); `200 KB heredoc < 250 ms`.
- [ ] **Step 4:** `node --test scripts/permission-model/test-parse.mjs` → FAIL; zaimplementuj; → PASS.
- [ ] **Step 5:** Smoke ładowania: skopiuj katalog do `plugins/permission-model/` (raz), `sleep 15`, grep logu: `loading plugin … permission-model` bez ERROR; `node -e "import('…/plugins/permission-model/index.js').then(m=>console.log(m.default.id))"` → `permission-model`.
- [ ] **Step 6:** Commit `feat(permission-model): plugin skeleton, shell parser, audit fixtures` (nie dodawaj `fixtures/*.json` jeśli > 5 MB — wtedy `.gitignore` + README z instrukcją odtworzenia).

### Task 2: Konfiguracja i wartości startowe

**Files:**
- Create: `plugins/permission-model/config.js`, `permission-model.json` (repo), `.gitignore` += `permission-model.local.json`
- Test: `scripts/permission-model/test-config.mjs`

**Interfaces:**
- Produces:
  ```js
  export const DEFAULTS // obiekt poniżej
  export function loadConfig(configDir, env = process.env) // -> Config (DEFAULTS ⊕ permission-model.json ⊕ permission-model.local.json; obiekty scalane rekurencyjnie, tablice zastępowane; zły JSON → console.error + DEFAULTS)
  ```
- `DEFAULTS` dokładnie:
  ```js
  { mode: "shadow",
    targets: { home: ["admin@k8s"], dev: ["kind-*", "*-dev", "*-test", "*-sandbox"], prod: ["*-prod", "*-prd", "*-production"] },
    protectedNamespaces: ["flux-system", "kube-system"],
    readVerbs: {
      kubectl: ["get","describe","logs","top","events","explain","api-resources","api-versions","version","cluster-info","diff","wait","kustomize","config view","config get-contexts","config current-context","auth can-i","port-forward","rollout status","rollout history"],
      helm: ["list","ls","status","history","get","template","show","search","lint","version","env","dependency list","package","pull","repo list"],
      flux: ["get","logs","trace","stats","version","export","events","check","tree","diff"],
      talosctl: ["usage","mounts","disks","list","ls","logs","dmesg","services","service","containers","processes","ps","stats","memory","netstat","events","time","version","health","get","config info","etcd members","etcd status","cgroups","inspect dependencies"],
      gh: ["pr view","pr list","pr diff","pr checks","pr status","run view","run list","run watch","workflow view","workflow list","issue view","issue list","repo view","repo list","release view","release list","auth status","search","api"],   // "api" = odczyt tylko bez -X/-f/-F/--field/--input
      jk: ["--version","version","auth status","context ls","search","job ls","job view","job config","run ls","run view","run params","run search","log","artifact ls","test report","cred ls","node ls","queue ls","plugin ls"],
      wrangler: ["whoami","versions list","deployments list","tail","dev","kv key get","kv key list","d1 list","r2 bucket list","secret list"],
      cf: ["whoami","list","get","status"],
      ant: ["auth status","--version","help"],
      crane: ["ls","digest","manifest","config","export","validate","version"],
      aws: ["describe-*","list-*","get-*","head-*","search-*","lookup-*","filter-*","scan","query","select-*","sts get-caller-identity","configure list","configure get","s3 ls"] },
    homeAllowedWrites: { git: ["push"], gh: ["pr *","issue create","issue comment","issue edit"], kubectl: ["apply","exec","rollout","scale","patch","label","annotate","create","cp","port-forward"], flux: ["reconcile","suspend","resume"], helm: ["upgrade","install","rollback","repo add","repo update"] },
    irreversible: { kubectl: ["delete namespace","delete ns","delete pv","delete pvc","delete crd","delete --all","delete -f","delete -k","drain","cordon","taint"], helm: ["uninstall","delete"], flux: ["uninstall","delete"], talosctl: ["reset","upgrade","upgrade-k8s","apply-config","patch","edit","bootstrap","reboot","shutdown","wipe","etcd snapshot","etcd remove-member","etcd leave"], git: ["push --force*","push -f*","push * -f*","push -?f*","push --delete*","push -d*","push * -d*","push --mirror*","push *+*","push * :*"], gh: ["repo delete","repo archive","repo edit","repo deploy-key","secret","release delete"], aws: ["delete-*","terminate-*","deregister-*","disable-*","put-bucket-policy","s3 rm","s3 rb","s3 sync*--delete*","iam attach-*","iam put-*","iam create-access-key","ec2 authorize-security-group-*","ec2 revoke-*","rds modify-db-instance","rds delete-*","cloudformation delete-stack","eks delete-*"], wrangler: ["delete","rollback","secret delete"], cf: ["* delete*"], jk: ["job delete","job configure","cred *","node rm","plugin *"], crane: ["delete"] },
    irreversibleExceptions: { git: ["push * :refs/tags/test-*", "push * --delete test-*", "push * -d test-*"] },
    secretDeny: { paths: ["~/.ssh/id_*", "~/.local/share/opencode/auth.json"], pathAllow: ["~/.ssh/id_*.pub"], commands: ["security *", "gcloud * print-access-token*", "gcloud * print-identity-token*", "aws * get-secret-value*", "aws * get-session-token*", "aws ecr get-login-password*", "ant auth print-credentials*"] },
    secretAsk: { paths: ["**/.env", "**/.env.*", "**/secrets/**", "**/*.pem", "**/*.key", "**/*.token", "~/.kube/config", "~/.aws/credentials", "~/.config/gcloud/**", "~/.claude.json", "~/.gemini/**", "~/.config/anthropic/**", "~/.cf-turnstile-token"], pathAllow: ["**/.env.example"], commands: ["env", "printenv", "kubectl * get *secret*-o *", "talosctl * get *secret*", "talosctl * get osroot*", "talosctl * get *machineconfig*"], commandAllow: ["kubectl * get *secret*-o name*", "env | grep *", "kubectl * create secret * --dry-run=client*"] },
    ownConfig: ["~/.config/opencode/opencode.json*", "~/.config/opencode/opencode.*.json", "~/.config/opencode/agents/**", "~/.config/opencode/secrets/**", "~/.config/opencode/plugins/**", "~/.config/opencode/scripts/check-skill-whitelists.sh", "~/.config/opencode/permission-model*.json", "**/.opencode/**", "~/.zsh/**"],
    localAsk: { commands: ["sudo *", "brew install*", "brew uninstall*", "brew upgrade*", "brew tap*", "softwareupdate *", "defaults write*", "defaults delete*", "launchctl *", "pmset -*", "diskutil *", "tmutil *", "networksetup -set*", "scutil --set*", "kill *", "pkill *", "killall *", "ssh *", "scp *", "rsync *", "sftp *", "hs *", "osascript *", "npm install -g*", "npm i -g*", "pip install*", "pipx install*"], commandAllow: ["launchctl list*", "launchctl print*", "pmset -g*", "diskutil list*", "diskutil info*", "kill $!", "kill -* $!", "kill %*", "kill -* %*", "ssh -V*", "ssh -G *"] },
    agentExceptions: { ha: ["ssh esp.iot *", "ssh -o BatchMode=yes esp.iot *", "scp * esp.iot:*", "scp esp.iot:* *"] },
    restrictedAgents: ["architect","plan","autopilot","webscraper","webresearcher","webmonitor","jira","stitch-mcp"],
    logFile: "~/.local/share/opencode/permission-model/decisions.jsonl" }
  ```
  (Wzorce: `*` = dowolny ciąg łącznie ze spacją i `/`, `?` = jeden znak — jak v2 `Wildcard`; dopasowanie do tekstu `narzędzie + " " + reszta` po rozpakowaniu i usunięciu flag globalnych — Task 4.)
- `permission-model.json` w repo: `{ "mode": "shadow" }` (reszta z DEFAULTS).

- [ ] **Step 1:** Testy: `defaults when no files` (`mode === "shadow"`, `targets.home` zawiera `admin@k8s`); `local overrides repo` (repo `{mode:"shadow"}`, local `{mode:"enforce"}` → enforce); `arrays replace, objects merge` (local `{targets:{prod:["x"]}}` → prod `["x"]`, dev bez zmian); `invalid json → defaults + console.error`.
- [ ] **Step 2:** FAIL → implementacja → PASS. Commit `feat(permission-model): config with spec defaults`.

### Task 3: Unwrapper i resolver celu

**Files:**
- Create: `plugins/permission-model/unwrap.js`, `plugins/permission-model/target.js`
- Test: `scripts/permission-model/test-unwrap.mjs`, `scripts/permission-model/test-target.mjs`

**Interfaces:**
- Consumes: `Simple` (Task 1), `Config` (Task 2).
- Produces (`unwrap.js`):
  ```js
  // Invocation: { tool: string, args: string[], env: Record<string,string>, cwd: string,
  //   unresolved: boolean, wrapped: ("timeout"|"env"|"time"|"nice"|"nohup"|"xargs"|"shell-c"|"eval")[],
  //   contextSwitch: boolean, redirects, heredoc, raw }
  export function unwrap(simples, { cwd, home, tmpRoots, env }) // -> Invocation[]
  ```
  Zasady: zdejmij `timeout N`, `gtimeout N`, `time`, `nice [-n N]`, `nohup`, `env [-i] [-u X] [K=V…]`, `command [-p]`, `builtin`, `exec`; `xargs …` → `wrapped:["xargs"]`, `unresolved:true`; `sh|bash|zsh|dash -c '…'` → parsuj wnętrze jako zagnieżdżone Simple (`wrapped:["shell-c"]`); `eval …` → `unresolved:true`. Przypisania `K=V cmd` → `env`. Śledź `cd <literal>` (rozwijaj `~`, `$HOME`, `$TMPDIR`, `${TMPDIR}`; nieznana zmienna → cwd `null`). `contextSwitch:true` gdy w tej samej komendzie (dowolny Simple przed): `kubectl config use-context|set-context|set-cluster`, `export AWS_PROFILE=`, `AWS_PROFILE=` przypisanie bez komendy, `asp `, `export KUBECONFIG=`, `kubectx `, `kubens `. `unresolved:true` gdy `tool` zaczyna się od `$`/`${`/`$(` lub którykolwiek z pierwszych 3 args zawiera nierozwinięte `$VAR` (poza `$HOME`, `$TMPDIR`, `$PWD`, `$USER`, `$!`, `$?`).
- Produces (`target.js`):
  ```js
  // Target: { kind: "k8s"|"aws"|"talos"|"git"|"cloud"|"local"|"none", name?: string, cls: "local"|"dev"|"home"|"prod"|"unknown", source: string }
  export function resolveTarget(inv, cfg, { home, tmpRoots, readFile, env }) // -> Target
  ```
  Zasady (spec §4.6): kubectl/helm/flux/kubeseal → `--context X`/`--context=X`/`--kube-context X`; `--kubeconfig P` (P w tmp → `dev`, inaczej czytaj `current-context` z P); `KUBECONFIG` w `inv.env` → jak `--kubeconfig`; inaczej `~/.kube/config` `current-context` (czytaj za każdym razem przez `readFile`, bez cache; brak pliku → `unknown`). Klasa: `kind-*` → dev; dopasuj do `targets.dev/home/prod` (wildcard); nic nie pasuje → `unknown` (traktowane jak prod). aws → `--profile X` / `inv.env.AWS_PROFILE` / `env.AWS_PROFILE` / `default`; klasa jak wyżej. talosctl → `-n|--nodes X` lub `--context X` → nazwa; klasa jak wyżej. git (tylko `push`/`fetch`/`pull`/`clone`): `kind:"git"`, `name` = remote arg lub `origin`, cls `home` jeśli remote pasuje do `targets.home`? — **nie**: git → cls `home` zawsze (decyzja: repo użytkownika; spec §3.1), `unknown` tylko gdy `contextSwitch`. gh/wrangler/cf/jk/ant/crane/docker push/podman push/stitch → `kind:"cloud"`, cls `prod`. `contextSwitch` → cls `unknown`. Reszta → `kind:"local"`, cls `local`.

- [ ] **Step 1:** Testy unwrap: `timeout 60 cargo test` → tool `cargo`, wrapped `["timeout"]`; `env -u X FOO=1 opencode serve` → tool `opencode`, env `{FOO:"1"}`; `SECRETSPEC_E2E_KUBECONFIG=$TMPDIR/kc cargo test` → env ma klucz, tool `cargo`; `KUBECONFIG=$TMPDIR/e2e/134.kubeconfig kubectl delete crd x` → env.KUBECONFIG rozwinięte do ścieżki w tmp, tool `kubectl`; `cd $TMPDIR && sh w.sh` → drugi inv cwd = tmp root; `cd "$DIR" && rm -rf x` → cwd `null`; `bash -c 'kubectl delete ns x'` → inv z tool `kubectl`, wrapped `["shell-c"]`; `xargs kubectl delete` → unresolved; `K="kubectl --context a"; $K get pods` → tool `$K`, unresolved; `kubectl delete $KIND $NS` → unresolved; `kubectl config use-context prod && kubectl delete ns x` → drugi inv `contextSwitch:true`; `export AWS_PROFILE=prod; aws s3 rm s3://b --recursive` → contextSwitch; `eval "x"` → unresolved.
- [ ] **Step 2:** Testy target (z `readFile` jako atrapą zwracającą `current-context: admin@k8s`): `kubectl --context kind-x get pods` → dev; `kubectl get pods` → home (`admin@k8s` z pliku); `kubectl --context prod-eu1 get` → prod; `kubectl --context foo get` → unknown; `helm --kube-context admin@k8s history x` → home; `kubectl --kubeconfig $TMPDIR/kc get` → dev; `aws s3 ls` (env bez profilu) → aws `default` → unknown; `aws --profile work-dev ec2 describe-instances` → dev; `AWS_PROFILE=x-prod aws …` → prod; `talosctl -n 10.1.250.11 usage` → talos name `10.1.250.11` → unknown (chyba że w listach); `gh pr create` → cloud prod; `git push origin main` → git home; `cargo test` → local; contextSwitch → unknown.
- [ ] **Step 3:** FAIL → implementacja → PASS. Commit `feat(permission-model): unwrapper and target resolver`.

### Task 4: Klasyfikator skutku

**Files:**
- Create: `plugins/permission-model/classify.js`, `plugins/permission-model/match.js` (wildcard jak v2: `*`→`.*`, `?`→`.`, trailing ` *` opcjonalny, flaga `s`)
- Test: `scripts/permission-model/test-classify.mjs`

**Interfaces:**
- Consumes: `Invocation`, `Target`, `Config`, `pathClass` (Task 5 — tu użyj prostej atrapy; właściwa w Task 5).
- Produces:
  ```js
  // Classification: { cls: "local-read"|"local-write"|"local-ask"|"ext-read"|"ext-write"|"irreversible"|"secret-ask"|"secret-deny"|"own-config"|"opaque", reason: string, verb?: string, detail?: string }
  export function classify(inv, target, cfg, { home, tmpRoots, sessionDir, agent, pathClass }) // -> Classification
  export function verbOf(tool, args) // -> { verb: string, rest: string[] } — pomija flagi globalne z wartością (kubectl: --context,-n,--namespace,--kubeconfig,--request-timeout; helm: --kube-context,-n,--namespace,--kubeconfig; flux: --context,-n,--namespace,--kubeconfig; git: -C,-c,--git-dir,--work-tree; aws: --profile,--region,--output,--endpoint-url; talosctl: -n,--nodes,-e,--endpoints,--context,--talosconfig; gh: -R,--repo) i zwraca czasownik = pierwsze 1–2 słowa niebędące flagami (dla aws: `<svc> <op>`; dla `s3` dodatkowo kierunek)
  export function matchAny(text, patterns) // wildcard
  ```
  Kolejność (pierwsza pasująca): 1) `secretDeny.commands` na `tool + " " + args` **po rozpakowaniu**, lub ścieżka z args ∈ `secretDeny.paths` (minus `pathAllow`) → `secret-deny`; 2) `agentExceptions[agent]` → `local-read`; 3) zapis (redirect `>`/`>>`, `tee`, `cp/mv/ln/install` cel, `rm`, `sed -i`, `perl -i`, `touch`, `mkdir`, `unzip -d`, `tar -x -C`, `curl -o`, `git -C D <write>`) do ścieżki ∈ `ownConfig` → `own-config`; 4) `secretAsk.commands` (minus `commandAllow`) lub odczyt ścieżki ∈ `secretAsk.paths` (minus `pathAllow`) → `secret-ask`; 5) `inv.unresolved` lub `wrapped` zawiera `xargs|eval`, lub skrypt z tmp (`sh|bash|zsh|dash <ścieżka w tmp>`, `./x` z cwd w tmp, `source`/`.` z tmp) → `opaque` **tylko gdy** tool jest znanym zewnętrznym CLI lub skryptem; dla nieznanych lokalnych narzędzi z nierozwiniętą zmienną → `local-write` (spec §4.1: nieznane lokalne = allow); 6) `localAsk.commands` (minus `commandAllow`) → `local-ask`; 7) znane CLI (`readVerbs` ma klucz): `verb` ∈ `irreversible[tool]` (minus `irreversibleExceptions`) → `irreversible`; kubectl `delete` z `-n|--namespace` ∈ `protectedNamespaces` lub `--all-namespaces`/`-A` → `irreversible`; `verb` ∈ `readVerbs[tool]` → `ext-read` (gh `api` tylko gdy brak `-X`≠GET/`--method`≠GET/`-f`/`-F`/`--field`/`--raw-field`/`--input`); inaczej → `ext-write`; aws s3: `cp|sync` z `s3://` jako **pierwszy** arg i lokalnym drugim → read, odwrotnie → write, `rm|rb|mb` → write, `sync --delete` → irreversible; 8) nieznane narzędzie z celem zewnętrznym (`--context`, `--profile`, `--kubeconfig`, URL nie-localhost w args) → `ext-write` (`reason:"unknown-cli-with-target"`); 9) `curl|wget|http`: metoda ≠ GET/HEAD lub dane (`-d`, `--data*`, `-F`, `-T`, `--upload-file`, `-X` ≠ GET/HEAD) do hosta ≠ localhost/127.0.0.1/::1 → `ext-write`, inaczej `ext-read`; 10) git lokalny (`commit`, `add`, `checkout`, `merge`, `rebase`, `reset`, `stash`, `clone`…) → `local-write`; `git push` → `ext-write`; 11) reszta → `local-read` jeśli brak zapisów (redirect/`rm`/`mv`…), inaczej `local-write`.

- [ ] **Step 1:** Testy tabelaryczne (`it.each`), ≥ 70 przypadków, z Target podanym wprost; m.in.:
  - ext-read: `kubectl --context admin@k8s -n ci get pods -o yaml`, `kubectl get pods --context x`, `helm --kube-context a history x --max 3`, `flux -n x get ks`, `talosctl -n 10.1.250.11 usage -d 2 /var`, `aws ec2 describe-instances --profile p`, `aws s3 ls s3://b`, `aws s3 cp s3://b/k ./x`, `gh api repos/a/b --jq .x`, `gh run watch 1`, `jk run ls job`, `curl -sI https://x`, `kubectl get secret s -o name`, `kubectl describe secret s`.
  - ext-write: `kubectl apply -f x`, `kubectl exec p -- sh`, `flux reconcile ks x`, `helm upgrade x c`, `git push origin main`, `gh pr create`, `aws s3 cp ./x s3://b/k`, `aws ec2 run-instances`, `aws iam create-user`, `jk run start job`, `wrangler deploy`, `gh api repos/a/b -X POST`, `gh api graphql -f q=x`, `curl -X POST https://x -d a`, `crane push`, `kubectl create ns y`, `eksctl --profile p create cluster` (unknown-cli-with-target).
  - irreversible: `kubectl delete ns x`, `kubectl delete namespace x`, `kubectl delete pvc d`, `kubectl delete -f x.yaml`, `kubectl delete pods --all`, `kubectl drain n`, `kubectl delete pod p -n flux-system`, `kubectl delete deploy x --namespace=kube-system`, `kubectl -n kube-system delete cm x`, `helm uninstall x`, `flux uninstall`, `talosctl -n x reset`, `talosctl upgrade --nodes x`, `git push --force`, `git push -uf origin x`, `git push origin :main`, `git push origin --delete feat`, `gh repo delete a/b`, `aws s3 rm s3://b --recursive`, `aws s3 sync . s3://b --delete`, `aws ec2 terminate-instances --instance-ids i`, `aws iam attach-user-policy`, `aws eks delete-cluster`, `wrangler delete`, `jk job delete x`, `crane delete r`.
  - nie-irreversible wyjątek: `git push origin :refs/tags/test-x` → ext-write; `kubectl delete pod p -n homebudget` → ext-write.
  - secret-deny: `cat ~/.ssh/id_ed25519`, `cat $HOME/.ssh/id_rsa`, `cp ~/.ssh/id_x /tmp/k`, `timeout 5 cat ~/.ssh/id_x` (po unwrap), `gcloud auth print-access-token`, `env X=1 aws secretsmanager get-secret-value --secret-id s`, `security find-generic-password`, `ant auth print-credentials`; **nie** deny: `cat ~/.ssh/id_x.pub`, `ssh-keygen -lf ~/.ssh/id_x.pub`.
  - secret-ask: `cat .env`, `cat secrets/x`, `cat ~/.kube/config`, `kubectl get secret s -o yaml`, `talosctl get osrootsecret`, `env`, `printenv`; nie: `cat .env.example`, `env | grep ^XDG`, `cat shared-secrets/x.yaml`, `kubectl create secret generic s --from-literal=a=b --dry-run=client -o yaml`.
  - own-config: `echo x > ~/.config/opencode/opencode.json`, `cat > agents/a.md <<EOF` (sessionDir = `~/.config/opencode`), `sed -i '' s/a/b/ plugins/permission-model/index.js`, `cp x .opencode/opencode.json`, `rm ~/.zsh/zshenv`, `touch secrets/x`; nie: `cat opencode.json`, `jq . opencode.json`.
  - opaque: `bash $TMPDIR/x.sh`, `cd $TMPDIR && sh w.sh`, `. $TMPDIR/env.sh`, `xargs kubectl delete`, `eval "x"`, `$K get pods`, `kubectl delete $KIND $NS` (Target `unknown`), `kubectl config use-context p && kubectl apply -f x`.
  - local-ask: `sudo ls`, `brew install x`, `pkill -f x`, `kill 123`, `ssh host ls`, `hs -c 'x'`, `defaults write a b`, `npm install -g x`; nie: `kill $!`, `pmset -g`, `launchctl list`, `ssh -V`, (agent `ha`) `ssh esp.iot ls`.
  - local-read/local-write: `cargo test`, `busted`, `ls -la`, `git status`, `git commit -m x`, `git merge feat`, `rm -rf node_modules`, `rm -rf /etc/x`?? → **own-config? nie** → `local-write` (plugin nie chroni `/etc`; spec: poza projektem to piaskownica), `make deploy`, `./scripts/x.sh`, `npm run build`, `.venv/bin/ansible-lint`, `syft x -o spdx-json`, `python3 x.py`, `head_code() { curl …; }; head_code x` → **local-write** (funkcje już nie blokowane), `cat > README.md <<EOF` → local-write, `podman run x`, `kind create cluster`, `talosctl config info`? → ext-read.
- [ ] **Step 2:** FAIL → implementacja → PASS. Commit `feat(permission-model): effect classifier with verb tables`.

### Task 5: Ścieżki dla narzędzi read/edit/write i reguły deny w konfiguracji

**Files:**
- Create: `plugins/permission-model/paths.js`
- Test: `scripts/permission-model/test-paths.mjs`

**Interfaces:**
- Produces:
  ```js
  export function canonical(p, base, home)                         // ~, $HOME, relatywne → absolutna, realpath najbliższego istniejącego przodka
  export function pathClass(abs, cfg, { home, sessionDir })        // -> "secret-deny"|"secret-ask"|"own-config"|null
  export function decidePathAction(action, resource, cfg, ctx)     // action read|edit|write; -> { effect:"allow"|"ask"|"deny", cls, message } (allow = nie ingeruj)
  ```
- Zasoby `read`/`edit` są względne wewnątrz katalogu sesji (`file-access.ts:93-104`), absolutne poza nim — zawsze kanonizuj względem `sessionDir`.

- [ ] **Step 1:** Testy: `~/.ssh/id_ed25519` → secret-deny; `.ssh/id_ed25519` (sessionDir = home) → secret-deny; `~/.ssh/id_ed25519.pub` → null; `~/.local/share/opencode/auth.json` → secret-deny; `.env`, `config/.env.local`, `secrets/x`, `a/secrets/x`, `x.pem`, `~/.kube/config`, `~/.claude.json` → secret-ask; `.env.example`, `shared-secrets/x.yaml` → null; `opencode.json` (sessionDir `~/.config/opencode`), `agents/coder.md`, `plugins/permission-model/index.js`, `/Users/x/Projects/p/.opencode/x`, `~/.zsh/zshenv` → own-config; `src/a.ts`, `docs/x.md` → null; `decidePathAction("edit","agents/x.md")` → ask; `("read","src/a.ts")` → allow; `("read","~/.ssh/id_x")` → deny; nieistniejąca ścieżka `new/dir/file` → kanonizacja przez przodka, null.
- [ ] **Step 2:** FAIL → implementacja → PASS. Commit `feat(permission-model): path classes for read/edit/write`.

### Task 6: Silnik decyzji, „Always” per klasa, komunikaty

**Files:**
- Create: `plugins/permission-model/decide.js`, `plugins/permission-model/messages.js`
- Test: `scripts/permission-model/test-decide.mjs`

**Interfaces:**
- Consumes: Task 3–5.
- Produces:
  ```js
  // Decision: { effect: "allow"|"ask"|"deny", cls, target, message?: string, reason }
  export function decide(classification, target, cfg, { agent })   // tabela niżej
  export function reconcile(decision, incomingEffect, cfg)          // -> finalEffect: nigdy nie łagodzi incoming "deny"; dla klas honorujących „Always” (ext-write dev/home, local-*) jeśli incoming==="allow" → allow; dla ext-write prod/unknown, irreversible, secret-ask, opaque, own-config → decision.effect (ignoruj incoming allow); secret-deny → deny
  export function decideShell(command, ctx) // pełny potok: parse→unwrap→target→classify→decide dla każdego Simple; wynik = najsurowszy (deny>ask>allow), message z najsurowszego
  ```
  Tabela `decide`:
  | cls | efekt |
  |---|---|
  | local-read, local-write, ext-read | allow |
  | local-ask | ask |
  | ext-write: target dev → allow; home → allow jeśli `verb` ∈ `homeAllowedWrites[tool]` inaczej ask; prod/unknown → ask; cloud (gh/wrangler/jk/ant/crane…) → `home` dla gh/git (repo użytkownika: `homeAllowedWrites.gh`), prod dla reszty → ask |
  | irreversible: ask zawsze, **wyjątek:** target dev i `detail` nie dotyczy `protectedNamespaces` → allow |
  | secret-ask, own-config, opaque → ask; secret-deny → deny |
  | agent ∈ `restrictedAgents` → zwróć incoming (plugin nie ingeruje), chyba że secret-deny |
- Szablony (`messages.js`, dokładnie): `permission-model: zapis na {cls_celu} ({kind} {name}): {tool} {verb} — wymaga zgody`; `permission-model: operacja nieodwracalna na {kind} {name} ({cls_celu}): {tool} {verb}`; `permission-model: cel nieznany ({powód: zmiana kontekstu w tej samej komendzie | zmienna w komendzie | skrypt z tmp}) — podaj cel dosłownie`; `permission-model: dane wrażliwe: {ścieżka|komenda}`; `permission-model: twardy zakaz — dane wrażliwe: {…}`; `permission-model: zapis własnej konfiguracji: {ścieżka}`; `permission-model: zmiana systemu lub innej maszyny: {tool}`; `permission-model: błąd pluginu ({err}) — pytam dla bezpieczeństwa`. Wszędzie `{cls_celu}` ∈ {dev, home, prod, nieznany}; `{verb}` przycięte do 60 znaków.

- [ ] **Step 1:** Testy: pełny potok `decideShell` z atrapą `readFile` (current-context `admin@k8s`): `kubectl apply -f x` → allow (home, homeAllowedWrites); `kubectl delete ns flux-system` → ask + message zawiera `nieodwracalna` i `admin@k8s`; `kubectl --context kind-x delete ns foo` → allow; `kubectl --context kind-x delete ns kube-system` → ask; `kubectl --context prod-eu1 apply -f x` → ask, message zawiera `prod`; `aws --profile p-dev s3 cp ./x s3://b/k` → allow; `aws s3 rm s3://b --recursive` (profil default/unknown) → ask; `git push origin main` → allow; `git push --force origin main` → ask; `gh pr create --fill` → allow; `gh repo delete a/b` → ask; `cargo test && git commit -m x` → allow; `ls; kubectl delete ns x` → ask (najsurowszy); `cat ~/.ssh/id_x` → deny; `cat .env` → ask; `echo x > ~/.config/opencode/opencode.json` → ask; `bash $TMPDIR/x.sh` → ask; `sudo ls` → ask; `kill $!` → allow; `ssh esp.iot ls` z agent `ha` → allow, z `coder` → ask; `kubectl get pods` z agent `architect` i incoming `deny` → deny (restricted → incoming). `reconcile`: (`ext-write` dev, incoming allow) → allow; (`irreversible`, incoming allow) → ask; (`secret-ask`, incoming allow) → ask; (`local-read`, incoming deny) → deny; (`secret-deny`, incoming allow) → deny.
- [ ] **Step 2:** FAIL → implementacja → PASS. Commit `feat(permission-model): decision engine with per-class Always policy`.

### Task 7: Wiring pluginu (hooki, korelacja, shadow/enforce, log, fail-safe)

**Files:**
- Modify: `plugins/permission-model/index.js`
- Create: `plugins/permission-model/log.js`, `plugins/permission-model/session.js`
- Test: `scripts/permission-model/test-plugin.mjs`

**Interfaces:**
- Consumes: Task 2–6; API: `ctx.tool.hook("execute.before", e)` (`e.tool`, `e.sessionID`, `e.id`, `e.input.command`, `e.input.workdir`), `ctx.permission.hook("evaluate", ev)` (`ev.action`, `ev.resources`, `ev.source.id`, `ev.agent`, `ev.sessionID`, `ev.effect`, `ev.message` mutowalne), `ctx.session.get({sessionID})` → `.location.directory`.
- Produces: `createCorrelator(ttlMs=120000, max=500)`; `appendLog(file, entry)` z `entry = { ts, sessionID, agent, action, resource(≤300, heredoc→"<<heredoc>>"), cls, target:{kind,name,cls}, incoming, decided, applied, mode, reason, ms }`; `sessionDir(ctx, sessionID)` (cache 60 s).
- Zachowanie `evaluate`: `action==="shell"`: komenda z korelatora (po `ev.source.id`) lub, przy braku, każdy element `ev.resources` osobno z cwd = sessionDir (`reason:"uncorrelated"`); `decideShell` z budżetem 250 ms (`Promise.race`); `reconcile`; w `enforce` ustaw `ev.effect`/`ev.message`; w `shadow` tylko log (`applied = incoming`). `action` ∈ {`read`,`edit`} (i `write` jeśli osobna akcja): `decidePathAction` dla każdego zasobu; ask/deny jak wyżej. Inne akcje (w tym `external_directory`): nie ruszaj, nie loguj. Wyjątek/timeout → `ask` + komunikat błędu (`enforce`), log `cls:"ERROR"`. Agent ∈ `restrictedAgents` → tylko secret-deny.

- [ ] **Step 1:** Testy z atrapą `ctx` (rejestruje callbacki; `session.get` → `{location:{directory:S}}`): `shadow leaves effect, logs decided` (`kubectl delete ns flux-system`, incoming allow → effect allow, log decided ask); `enforce applies` (→ ask + message); `incoming deny untouched` (enforce, `ls`, incoming deny → deny); `correlated beats fragments` (`before` z `cd sub && echo > a.txt`, evaluate resources `["echo > a.txt"]` → cel `S/sub/a.txt`, allow); `uncorrelated analyzes resources` (brak before, resources `["kubectl delete ns x"]` → ask, reason uncorrelated); `read .env asks` (action read, resource `.env` → ask); `edit agents/x.md asks`; `read ~/.ssh/id_x denies`; `restricted agent passes through` (architect, `cat x`, incoming ask → ask; `cat ~/.ssh/id_x` → deny); `error → ask` (wstrzyknięty wyjątek); `timeout → ask` (decide zawieszony > 250 ms); `log redacts heredoc and truncates`; correlator `ttl` i `cap`.
- [ ] **Step 2:** FAIL → implementacja → PASS; `node --check` wszystkich plików; jednorazowa kopia do `plugins/permission-model/`, `sleep 15`, log bez ERROR. Commit `feat(permission-model): plugin wiring, shadow mode, decision log`.

### Task 8: Replay korpusu i tabela oczekiwanych decyzji (bramka użytkownika)

**Files:**
- Create: `scripts/permission-model/replay.mjs`, `scripts/permission-model/fixtures/expected-decisions.json`, `docs/permission-model-expected-decisions.md`
- Test: `scripts/permission-model/test-replay.mjs`

**Interfaces:**
- Consumes: `decideShell`, `decidePathAction`, fixtures (Task 1).
- Produces: `replay(corpus, cfg, { readFile })` → `{ total, asks, denies, byCls, byTargetCls, entries:[{id, decision}] }`; CLI `node scripts/permission-model/replay.mjs [--mode shadow] [--out $TMPDIR/opencode/pm-replay.json]`. Atrapa `readFile` zwraca `current-context: admin@k8s` (dom) — korpus pochodzi z maszyny prywatnej.

- [ ] **Step 1:** `replay.mjs` liczy decyzje dla `audit-evaluated.json` + `session-commands.json`; wypisuje podsumowanie i top 20 `ask`.
- [ ] **Step 2:** `expected-decisions.json`: wszystkie wpisy `audit-remaining.json` + wszystkie `session-commands.json` + losowe 80 z reszty (ziarno `20261023`): `{ id, command|path, agent, expected: effect, why: "§3|§4.x" }` — etykiety ręcznie wg spec, **nie** z wyjścia replay. `docs/permission-model-expected-decisions.md` = ta sama tabela pogrupowana po paragrafach.
- [ ] **Step 3:** Testy: `local commands never ask` (wszystkie wpisy z `cls` local-* → allow; ≥ 95% korpusu, bo reszta to zewnętrzne); `reads never ask`; `every expected matches` (lista niezgodności w komunikacie); `secret and own-config never allow`; `irreversible on home/prod never allow`.
- [ ] **Step 4:** Dopasowuj **kod** (nie etykiety) do PASS; etykietę wolno zmienić tylko z cytatem paragrafu w `why`.
- [ ] **Step 5:** Commit `test(permission-model): corpus replay and expected decisions`.
- [ ] **Step 6: BRAMKA.** Pokaż użytkownikowi `docs/permission-model-expected-decisions.md`, podsumowanie replay (asks/denies, top 20 pozostałych pytań) oraz wartości startowe `targets` (home/dev/prod) do potwierdzenia. Dalej dopiero po zatwierdzeniu (spec §6 krok 0–1).

### Task 9: Shadow w realnych sesjach i raport

**Files:**
- Create: `scripts/permission-model/log-report.mjs`
- Modify: `docs/dev-guide.md` (sekcja o pluginie: co robi, tryby, log, „Always” nieskuteczne dla klas…, rozwijanie na kopii), `AGENTS.md` (3 linie: plugin, shadow, reguły bez zmian do czasu enforce)
- Test: `scripts/permission-model/test-log-report.mjs`

**Interfaces:**
- Produces: `report(entries)` → `{ total, byMode, wouldChange: { allowToAsk, askToAllow, toDeny }, topAsks:[{key,count}], errors }`; CLI `node scripts/permission-model/log-report.mjs [plik]`.

- [ ] **Step 1:** Test na syntetycznym logu (6 wpisów) — liczby, `wouldChange`, sortowanie.
- [ ] **Step 2:** FAIL → implementacja → PASS. Docs. Commit `feat(permission-model): shadow log report; docs`.
- [ ] **Step 3: BRAMKA.** Po ≥ 3 dniach pracy w `shadow` (plugin działa na dzisiejszej konfiguracji — stare reguły nadal egzekwują): `log-report` → użytkownikowi: ile razy plugin zdecydowałby inaczej niż konfiguracja (szczególnie `askToAllow` = pytania, które znikną, i `allowToAsk` = nowe pytania, każde z komendą i celem). Poprawki zasad → wróć do Task 4/6 z testem. Dalej po zgodzie użytkownika.

### Task 9b: Profil tylko do odczytu dla agentów ograniczonych (poprawka 2026-10-25, spec §4.7a)

Zmienia zachowanie z Task 6 (wiersz tabeli „agent ∈ `restrictedAgents` → zwróć incoming”) i Task 7
(„Agent ∈ `restrictedAgents` → tylko secret-deny”). Rozwijać na kopii (`$TMPDIR/opencode/pm-dev/permission-model`,
`PM_PLUGIN_DIR`), skopiować raz na końcu.

**Files:**
- Modify: `plugins/permission-model/config.js` (DEFAULTS `restrictedShell`), `plugins/permission-model/decide.js` (`decide` + `reconcile` dla agentów ograniczonych), `plugins/permission-model/index.js` (bez `passthrough` w `evalShell`; `evalPath` bez zmian — read/edit u agentów ograniczonych dalej rozstrzyga konfiguracja), `plugins/permission-model/messages.js` (`restrictedShell(agent, tool, verb)`), `plugins/permission-model/README.md`
- Test: `scripts/permission-model/test-decide.mjs`, `scripts/permission-model/test-plugin.mjs`, `scripts/permission-model/test-config.mjs`

**Interfaces:**
- `restrictedShell: { tools: string[], git: string[], denyArgs: Record<string, string[]> }` — wartości startowe dokładnie jak w spec §4.7a; klucze `denyArgs` dla git: `"git branch"`, `"git tag"`, `"git remote"`, `"git worktree"`, `"git stash"`, `"git config"` (dla `git config` lista **dozwolonych** jako `allowArgs: { "git config": ["--get*","--list","-l"] }`; `git tag <nazwa>` bez `-l`/`--list` = deny).
- `decide(classification, target, cfg, { agent, inv })` dla agenta ograniczonego: `secret-deny` → deny; `secret-ask` → ask; inaczej `inRestrictedProfile(inv, cfg)` && brak przekierowania zapisu poza `/dev/null`/deskryptor → allow, w przeciwnym razie deny + `msg.restrictedShell(...)`. Bez `passthrough`.
- `reconcile`: bez zmian semantyki „nigdy nie łagodzi incoming deny”; dla agenta ograniczonego ignoruje incoming `allow`/`ask` i zwraca `decision.effect` (zapisane „Always” nie poszerzają profilu).
- `index.js`: błąd/timeout u agenta ograniczonego → zostaje incoming (z konfiguracji to `ask`), jak dziś.

- [x] **Step 1:** (zrobione 2026-10-26: `scripts/permission-model/test-restricted.mjs`, 99 przypadków, plus dodatkowe deny dla `GIT_PAGER=… git`, `git -c core.pager=…`, `>&plik`, `<>plik`, `./docs/cat`, `sudo`, `$(rm …)`, `xargs find`, `git log --output=`, `git grep -O`; agent `reviewer` z samym `restrictedAgents` zostaje passthrough) Testy (`decideShell`, agent `architect`, cwd = repo): **allow:** komenda z incydentu 2026-10-25 (`cat .git/FETCH_HEAD .git/ORIG_HEAD; grep -v '^#' .git/packed-refs | head -30; ls .git/refs/remotes/origin 2>/dev/null; cat .git/refs/remotes/origin/main 2>/dev/null; ls -la .tekton .github/workflows`), `echo x 2>/dev/null`, `ls x 2>&1 | head`, `rg foo`, `jq . opencode.json`, `git status`, `git log --oneline -5`, `git -C x log`, `git diff HEAD~1`, `git branch -a`, `git tag -l`, `git remote -v`, `git config --get user.name`, `find . -name '*.md'`, `sort f | uniq -c`. **deny:** `cat a > b`, `echo x >> f`, `printf x | tee f`, `mkdir -p d`, `sed -i s/a/b/ f`, `sed -n 1p f`, `find . -name x -delete`, `find . -exec rm {} +`, `python3 -c "open('f','w').write('x')"`, `node -e x`, `awk '{print > "out"}' f`, `sort -o out f`, `perl -e 1`, `rm -rf d`, `cp a b`, `git commit -m x`, `git checkout main`, `git branch -D x`, `git tag v1`, `git remote add o u`, `git stash pop`, `git config user.name x`, `make test`, `npm test`, `kubectl get pods`, `curl https://example.com`, `bash $TMPDIR/x.sh`, `xargs rm < list`, `rg --pre cat x`; **ask:** `cat .env`; **deny (secret):** `cat ~/.ssh/id_ed25519`. Każdy deny z `message` zawierającym `tylko do odczytu`. Agent `coder` dla tych samych komend — decyzje jak przed zmianą (regresja: cały dotychczasowy zestaw testów + `PM_STRICT=1` replay bez nowych rozbieżności).
- [x] **Step 2:** `reconcile`: (architect, `local-read` w profilu, incoming `ask`) → allow; (architect, poza profilem, incoming `allow` z zapisanej zgody) → deny; (architect, cokolwiek, incoming `deny`) → deny. `test-plugin.mjs`: zamień `restricted agent passes through` na `restricted agent uses profile` (enforce: `ls x 2>/dev/null` incoming ask → allow; `cat a > b` incoming ask → deny + message; shadow: effect bez zmian, log `decided` jak w enforce; wyjątek w decide → effect = incoming).
- [x] **Step 3:** FAIL → implementacja → PASS; `node --check`; kopia do `plugins/permission-model/`; `sleep 15`; `node scripts/permission-model/check-alive.mjs`; log bez ERROR. Commit `feat(permission-model): read-only shell profile for restricted agents`. (2026-10-26: 829/829 testów, `PM_STRICT=1` replay czysty; korpus: architekt 74 komendy powłoki → 73 allow, 1 deny = uruchomienie skryptów skilla SDD, nadpisanie etykiety `QFtpwy` §4.7a.)
- [ ] **Step 4:** Uwaga do bramki Task 9: do czasu Task 10 shadow **nie widzi** odmów u agentów ograniczonych (deny z konfiguracji działa przed hookiem); w raporcie gate 2 zaznaczyć, że ich profil zweryfikują wyłącznie testy z Step 1 i smoke z Task 10 Step 4.

### Task 10: Przełączenie — odchudzony `opencode.json`, `enforce`, sprzątanie (jeden commit)

**Files:**
- Modify: `opencode.json` (w tym prompt `plan`), `permission-model.json` (`mode: "enforce"`), `docs/global-rules.md`, `AGENTS.md` (Agent Roster: `plan`/`autopilot`/`architect` — opis powłoki wg spec §4.7a), `docs/dev-guide.md`, `skill/autonomous-execution/SKILL.md`, `agents/architect.md` i `agents/autopilot.md` (zdanie o powłoce wg spec §4.7a „Prompty”)
- Delete: `plugins/shell-style.js`, `scripts/test-shell-style.mjs`
- Test: `scripts/permission-model/test-config-slim.mjs` (ocena nowego `opencode.json` przez `opencode debug agents` + harness z `$TMPDIR/permharness` lub własny evaluator)

**Interfaces:**
- Nowy `opencode.json` (`permission` globalne), dokładnie:
  - `edit`: `{"*": "allow"}` + ask dla ścieżek z spec §4.4 (absolutne `~/…` i względne jak dziś) + deny `~/.ssh/id_*`, `.ssh/id_*`, `~/.local/share/opencode/auth.json` + allow `*.pub`;
  - `read`: `{"*": "allow"}` + ask `*.env`, `*.env.*`, `*/secrets/*`, `secrets/*`, `*.pem`, `*.key`, `*.token`, `~/.kube/config`, `~/.aws/credentials`, `~/.config/gcloud/*`, `~/.claude.json`, `~/.gemini/*`, `~/.config/anthropic/*` + allow `*.env.example` + deny jak w edit;
  - `external_directory`: `{"*": "allow"}`;
  - `bash`: `{"*": "allow"}` + **tylko**: deny `security *`, `/usr/bin/security *`, `sudo security *`, `*.ssh/id_*` (+ allow `*.ssh/id_*.pub*`), `*opencode/auth.json*`, `gcloud * print-access-token*`, `gcloud * print-identity-token*`, `aws * get-secret-value*`, `aws * get-session-token*`, `aws ecr get-login-password*`, `ant auth print-credentials*`; **żadnych** ask w bash (o ask decyduje plugin). Agenci: `autopilot`/`architect`/`plan`/web*/`jira`/`stitch-mcp` — **(poprawka 2026-10-25, spec §4.7a)** bash `{"*": "ask"}` + ta sama lista deny co globalnie (powtórzona, bo reguły agenta są po globalnych); bez listy echo/ls/… i bez `*>*` (o allow/deny decyduje profil `restrictedShell` w pluginie); `autopilot` edit jak dziś; `debugger`/`devops`/`coder`/`general`/`jenkins`/`ha` — **bez** własnych bloków bash (wyjątek `ha` przeniesiony do `permission-model.json` `agentExceptions`); `task` i `skill` bez zmian; `tools` (MCP) bez zmian.
  - `agents/*.md`: frontmatter bez `tools: bash/edit/write` (jak dziś) + `permission.bash` `security` deny bez zmian.
- `docs/global-rules.md` „Shell Command Style” → zostaje: pliki przez write/edit; brak ad-hoc skryptów w tmp; `$TMPDIR` nie `/tmp`; jedna prosta komenda; `git push` wolno/force pyta; „Permission denied” = reguła; **nowe:** „Przed każdym zapisem na cel prod/nieznany (klaster, AWS, GitHub, Cloudflare, Jenkins, Talos) podaj w jednej linii w czacie cel (kontekst/profil/węzeł/repo), a potem uruchom komendę — okno pytania go nie pokazuje.” Usunięte: kolejność flag, `$K`, `timeout`/`env`, apostrofy jsonpath, narzędzia po nazwie, aliasy `$T`, funkcje, `kubectl describe secret`, `git -c user.*`, `--kubeconfig` dla kind, `sh <(yq …)`.
- `skill/autonomous-execution/SKILL.md` Hard Stops += merge do main, PR, deploy (wrangler/cf), zapisy Jenkins, wysyłka maili/Stitch, `ant apply`.

- [ ] **Step 0a (blokuje Task 10, znalezione 2026-10-26):** klasyfikator traktuje `>&plik` i `<>plik` jako `local-read` (`classify.js`: `isWriteRedirect` pomija każde `>&`, `redirectWords` pomija operatory z `>&`, `<>` nie jest zapisem). Skutek w `enforce` dla zwykłych agentów: `echo x >&opencode.json`, `echo x >&agents/coder.md` → allow zamiast ask (§4.4), `echo x >&~/.ssh/id_x` → allow zamiast deny (§4.2). Poprawka: `>&` z celem innym niż deskryptor (`\d+-?` lub `-`) oraz `<>` = przekierowanie zapisu; testy w `test-classify.mjs` + replay `PM_STRICT=1`. Dziś nie do wykorzystania (shadow + reguła konfiguracji `*>*opencode.json*`).
- [ ] **Step 0:** Ryzyko: po odchudzeniu `opencode.json` bash ma `"*": allow`, więc **jeśli plugin się nie załaduje, nic nie pyta**. Zabezpieczenie: plugin w `setup()` zapisuje znacznik `~/.local/share/opencode/permission-model/alive` (`{ pid, ts, mode }`, odświeżany przy każdej ocenie); dodaj to do Task 7 jeśli brak. `scripts/permission-model/check-alive.mjs` wypisuje wiek znacznika i tryb; `check-skill-whitelists.sh`-podobny krok w `docs/dev-guide.md`: po każdej zmianie w `plugins/` uruchom `check-alive`. Dopóki znacznik nie ma `mode:"enforce"` i wieku < 5 min, **nie commituj** odchudzonego `opencode.json`.
- [ ] **Step 1:** Napisz nowy `opencode.json` (edit tool; plik chroniony → użytkownik zatwierdza). `jq empty`; `bash scripts/check-skill-whitelists.sh` 0 FAIL.
- [ ] **Step 2:** `test-config-slim.mjs`: z `opencode debug agents` sprawdź dla coder/general/devops/debugger: `kubectl delete ns x` → **allow w konfiguracji** (bo decyduje plugin), `cat ~/.ssh/id_x` → deny, `security x` → deny, `gcloud auth print-access-token` → deny; architect: w konfiguracji `ls`/`git status`/`cat a > b` → ask (decyduje plugin), `cat ~/.ssh/id_x` → deny, `security x` → deny; autopilot edit `docs/superpowers/x.md` allow, `src/x` deny; read `.env` ask, `src/a.ts` allow; edit `opencode.json` ask.
- [ ] **Step 3:** `permission-model.json` → `enforce`; usuń `shell-style` (plugin + test + wzmianki w docs/AGENTS.md); skróć `global-rules.md`; Hard Stops; `dev-guide.md`. Jeden commit `feat(permissions): permission model v2 — plugin enforces, slim config` (+ push po zgodzie użytkownika).
- [ ] **Step 4:** Smoke (spec §6 krok 4) w realnej sesji coder/devops: `kubectl --context admin@k8s get pods -A`, `flux reconcile ks x --context admin@k8s`, `cargo test`, `busted`, `talosctl -n 10.1.250.11 usage -d 1 /var`, `.venv/bin/ansible-lint`, `syft x` → bez pytań; `kubectl delete ns flux-system --context admin@k8s` → pytanie (bez wykonania — odrzuć); `kubectl config use-context admin@k8s && kubectl get pods` → pytanie; `bash $TMPDIR/x.sh` → pytanie; `cat ~/.ssh/id_ed25519` → odmowa; `echo x > ~/.config/opencode/opencode.json` → pytanie; w realnej sesji `architect`: `grep -v '^#' .git/packed-refs | head`, `ls .git/refs/remotes/origin 2>/dev/null`, `git log --oneline -3` → bez pytań; `cat a > $TMPDIR/opencode/x`, `git commit -m x` → odmowa z komunikatem „tylko do odczytu”. Wynik do `docs/permission-model-smoke.md`.
- [ ] **Step 5:** Zapisz w pamięci projektu: nowy model, tryb enforce, data; usuń stare notatki o wariancie A jako nieaktualne.
- [ ] **Step 6:** `docs/permission-review.md` + sekcja „Periodic Permission Review” w `AGENTS.md`: przegląd czyta **log pluginu** (`decisions.jsonl` przez `log-report.mjs`), nie bazę `opencode.db`; zapisane zgody „Always” nie są już przedmiotem przeglądu (plugin ignoruje je dla klas prod/sekrety/nieodwracalne; dla dev/home są nieszkodliwe); zakres raportu: pytania/h, `allowToAsk`/`askToAllow`, błędy pluginu, wiek znacznika `alive`.

### Task 11: Sprzątanie po poprzednich podejściach (po `enforce`)

**Files:**
- Modify: `docs/superpowers/specs/2026-10-19-agent-guard-design.md` (status: „Zastąpione przez permission-model v2 (2026-10-23); §4.4 piaskownica pozostaje planem na później”), `docs/superpowers/plans/2026-10-19-agent-guard-stage1.md` (status: „Zastąpiony — nie wykonywać”), `.gitignore`
- Delete: `scripts/audit-bash-permissions.py` (zastąpiony przez `scripts/permission-model/replay.mjs` i `log-report.mjs`; usuń też wzmiankę w `docs/permission-review.md`), `~/Projects/opencode-agent-guard` (cały katalog; decyzja użytkownika 2026-10-23), kopie bazy `$TMPDIR/opencode/opencode.db.bak-perm-cleanup-*` (+ `-shm`/`-wal`; decyzja użytkownika 2026-10-23), katalogi robocze `$TMPDIR/opencode/{permharness,permaudit,dbreview,review2,sesaudit,verify-ss,shell-style-dev,pm-dev,commit-msg.txt}` (po upewnieniu się, że korpus jest w fixtures — Task 1)
- Keep (świadomie): 47 zapisanych zgód w `opencode.db` (plugin ignoruje je dla klas prod/sekrety/nieodwracalne); bloki w `~/.zsh/zshenv` (rustup, kind, cargo-zigbuild, syft — to środowisko, nie uprawnienia; czekają na commit użytkownika w jego dotfiles)

- [ ] **Step 1:** Potwierdź `git -C ~/Projects/opencode-agent-guard log --oneline` = 1 commit (`chore: init repository`) i brak remote; dopiero wtedy `rm -rf ~/Projects/opencode-agent-guard` (ścieżka absolutna → prośba o zgodę jest oczekiwana).
- [ ] **Step 2:** `ls -la $TMPDIR/opencode/` → usuń kopie bazy i katalogi robocze wymienione wyżej, każdy jednym `rm -rf` na katalog/plik; zostaw `$TMPDIR/opencode` (katalog OpenCode) i cokolwiek spoza listy.
- [ ] **Step 3:** Statusy w obu dokumentach agent-guard; usuń `audit-bash-permissions.py` i wzmianki; `bash scripts/check-skill-whitelists.sh` 0 FAIL.
- [ ] **Step 4:** Pamięć projektu (`memory_recall "wariant A"`, `"shell-style"`, `"Always"`, `"agent-guard"`, `"permission review"`): usuń wpisy opisujące stare reguły, plugin `shell-style`, sprzątanie bazy i odłożony agent-guard; zostaw/aktualizuj jedną notatkę o modelu v2 (spec, plan, tryb, data) i przypomnienie o przeglądzie (nowa treść z Task 10 Step 6).
- [ ] **Step 5:** Commit `chore(permissions): remove leftovers of the pattern-based model` (+ push po zgodzie użytkownika). Raport dla użytkownika: co usunięte, ile miejsca odzyskane, co zostało świadomie.
