# `agent-guard` — autonomiczni agenci z twardymi granicami (OpenCode v2)

- **Data:** 2026-10-19
- **Status:** Odłożone (2026-10-19) — użytkownik wybrał wariant A (sama konfiguracja `opencode.json` + zasada pisania komend w `docs/global-rules.md`). Plan etapu 1: `docs/superpowers/plans/2026-10-19-agent-guard-stage1.md` (nie wykonany; repo `~/Projects/opencode-agent-guard` ma tylko commit startowy).
- **Repo docelowe:** `opencode-agent-guard` (nowe), submoduł w `~/.config/opencode` (§5)
- **Źródło faktów v2:** `~/Projects/opencode-v2.0.22` (tag v2.0.22). Ścieżki kodu poniżej względem
  `packages/` tego worktree.
- **Dane audytu:** `$TMPDIR/opencode/permaudit/` — `evaluated.json`, `classified.json`,
  `remaining.json`, skrypty `eval.mjs`, `classify.py` (na początku prac kopiowane do fixtures
  repo pluginu — §6).
- **Przegląd konstruktora:** 2026-10-19, względem źródeł v2.0.22; wyniki wpisane w treść,
  zestawienie w §9.

## 1. Intencja / dlaczego

### 1.1 Audyt 2026-10-04..18

223 sesje, 4 699 wywołań narzędzi. Przy obecnej konfiguracji i **bez zapisanych zgód** 930 wywołań
pytałoby o zgodę ≈ 37/h aktywnej pracy (co ~1,6 min).

| Kategoria | Pytania |
|---|---|
| READ | 266 |
| BUILD-TEST | 255 |
| WRAPPER/PARSE (styl zapisu: `kubectl --context X get`, `git -C`, `$K`, `bash -c`, `VAR=x cmd`, `timeout`) | 232 |
| SCRATCH | 125 |
| EXTERNAL-MUTATE | 47 |
| PROJECT-WRITE | 34 |
| fałszywe alarmy ochrony konfiguracji | 35 |
| edycje chronionej konfiguracji | 24 |
| reszta (system, poza projektem, wrażliwe) | ~20 |

### 1.2 Problem z „Always”

Użytkownik klika „Always”, bo chce, żeby agent pracował bez przerywania. Skutki uboczne
(potwierdzone w v2.0.22, `core/src/permission.ts:173-178`):

| Skutek | Szczegół |
|---|---|
| Zgody przebijają `ask` z konfiguracji | zapisane zgody doklejane PO regułach konfiguracji (last-match-wins). Nie przebijają `deny` — deny z konfiguracji sprawdzane wcześniej, hook nie jest wtedy wołany |
| Zgoda na cały łańcuch | „Always” zapisuje zgodę na KAŻDĄ podkomendę łańcucha |
| Eskalacja przy edycji chronionej | „Always” na edycji chronionego pliku zapisało `edit *` |
| Śmieciowe zgody | heredoc parsowany jako komendy → `fn *`, `} *` |

2026-10-18 usunięto ~420 takich zgód we wszystkich projektach.

### 1.3 Reguły-wzorce przeciekają w obie strony

- Pytają o niegroźne: `kubectl --context X get`.
- Przepuszczają groźne: `python3`, `node`, `cp`, `mv`, `ssh`, `curl` mogą pisać/kasować wszędzie;
  skrypty `bash $TMPDIR/s5.sh` ukrywały `rm -rf` i zmianę tokena w `~/.hammerspoon`.

**Wniosek:** decydować na podstawie GDZIE agent działa i CZEGO dotyka, a nie dosłownego tekstu
komendy; plus piaskownica systemowa dla skryptów.

## 2. Cele / nie-cele / anty-cele

| Typ | Treść |
|---|---|
| Cel | Agent bez pytania czyta, szuka, zapisuje, buduje, testuje w katalogu sesji i w tmp; wykonuje zlecone zmiany zewnętrzne (lista §3.3) |
| Cel | Pytania tylko w kategoriach z §3. Na korpusie audytu ≤ ~120 pytań (z 930); zero `allow` w kategoriach, które mają pytać/być zabronione |
| Cel | Plugin ma ostatnie słowo nad zapisanymi zgodami „Always” |
| Cel (etap 2) | Skrypty (`python3`, `node`, `bash plik.sh`) objęte tymi samymi granicami przez piaskownicę systemową |
| Nie-cel | Obrona przed agentem celowo próbującym uciec z piaskownicy — to ochrona przed pomyłkami i nadgorliwością, nie przed atakiem |
| Nie-cel | Kontrola ruchu sieciowego (egress) |
| Nie-cel | Zmiana uprawnień agentów z ograniczoną powłoką (`architect`, `plan`, `autopilot`, `webscraper`, `webresearcher`, `webmonitor`, `jira`, `stitch-mcp`) — zostają jak są (§3.8) |
| Nie-cel | Akcje inne niż narzędzia plików, powłoka i `external_directory` (MCP, webfetch, subagent, skill, question) — §3.9 |
| Nie-cel | Wykrywanie zmian zewnętrznych robionych przez nieznane CLI (§3.7) |
| Anty-cel | Więcej pytań niż dziś albo pytania o nieszkodliwe rzeczy |
| Anty-cel | Psucie codziennych narzędzi: git, gh, cargo, rustup, npm/yarn/bun, uv/uvx, podman, kubectl, flux, helm, kubeseal, busted, luacheck, opencode CLI |
| Anty-cel | Decyzje, których nie da się potem prześledzić |
| Anty-cel | Agent zmieniający po cichu własne granice (konfiguracja OpenCode, sam plugin) |

## 3. Zasady (uzgodnione z użytkownikiem)

### 3.1 Strefy plików

| Strefa | Odczyt narzędziami `read`/`grep`/`glob` | Odczyt powłoką | Zapis (każdą drogą) |
|---|---|---|---|
| katalog sesji (katalog, z którego uruchomiono sesję) z podkatalogami | allow | allow | allow |
| tmp: `/tmp`, `/private/tmp`, `$TMPDIR` (`/private/var/folders/…/T`) | allow (wymaga reguł `external_directory` z §4.3) | allow | allow |
| reszta dysku, w tym katalogi z natywną zgodą `external_directory` („przyznane”) | natywne pytanie `external_directory` o dostęp; po zgodzie allow | allow | ask — za każdym razem, nigdy nie zapamiętywane |
| dane wrażliwe (§3.4), także wewnątrz katalogu sesji | wg §3.4 | wg §3.4 | wg §3.4 |
| chroniona konfiguracja (§3.5), także gdy jest w katalogu sesji | allow | allow | ask — za każdym razem |

- **Zapis:** zasady dotyczą **wszystkich dróg** — narzędzia `edit`/`write` ORAZ powłoka (`>`, `>>`,
  `tee`, `cp`, `mv`, `ln`, `install`, `rm`, `rmdir`, `mkdir`, `touch`, `chmod`, `sed -i`,
  `perl -i`, `tar -x -C`, `unzip -d`, `curl -o`, `git -C dir <zapis>` itd.).
- **Odczyt powłoką (decyzja użytkownika):** dozwolony wszędzie poza danymi wrażliwymi (§3.4).
- **Natywne `external_directory` (decyzja użytkownika):** zostaje tylko tam, gdzie działa natywnie —
  narzędzia `read`/`grep`/`glob`/`edit`/`write` i `cd`/`workdir` powłoki. Plugin nie prowadzi
  własnego magazynu zgód i **nie zna katalogów przyznanych** (kontekst pluginu nie ma API listy
  zapisanych zgód, §4.1): każdy zapis poza katalogiem sesji i tmp → ask.
- **Decyzja architekta:** wewnątrz katalogu sesji agent może też kasować (`rm`, `git reset`,
  `git clean`) — repo w gicie + migawki OpenCode pozwalają odwrócić.
- **Decyzja architekta — strefa projektu:** strefa projektu = katalog sesji (`location.directory`).
  Jeśli katalog sesji leży w repo gita, strefa obejmuje też worktree root (jak „internal” w
  `core/src/file-access.ts:93-104`) — chyba że worktree root to `$HOME` lub `/` (wtedy tylko katalog
  sesji). Jeśli sam katalog sesji to `$HOME` lub `/`, **strefy projektu nie ma**: zapis bez pytania
  tylko w tmp.

### 3.2 Odczyt i praca lokalna — allow

| Grupa | Przykłady |
|---|---|
| Odczyt / inspekcja / wyszukiwanie | — |
| Budowanie, testy, lintery, formatery, menedżery pakietów w projekcie | cargo, busted, luacheck, yarn, uv … |
| Lokalne kontenery testowe | `podman run` bez `--privileged` i bez montowania ścieżek spoza stref zapisu (**decyzja architekta**) |
| Odczyt stanu systemu | `brew info/list`, `pmset -g`, `system_profiler`, `ioreg`, `ps`, `lsof` |
| OpenCode CLI | `opencode debug …`, `opencode --version` |
| Skrypty | `bash skrypt.sh`, `python3 skrypt.py`, `node x.js` — allow (etap 1 nie widzi wnętrza; etap 2 pilnuje piaskownica) |

**Opakowania i styl zapisu NIE mogą wywoływać pytań:**

| Konstrukcja | Obsługa |
|---|---|
| `timeout`/`gtimeout`/`time`/`nice`/`nohup`/`env [-u X] [VAR=…]`/`VAR=… cmd`/`command`/`builtin` | zdjąć opakowanie, klasyfikować komendę w środku |
| `cd X && …` | śledzić `cd`, rozwiązywać ścieżki względne |
| `bash -c '…'` / `sh -c` / `zsh -c` | analizować komendę w środku |
| funkcje i zmienne zdefiniowane w tej samej komendzie: `K="kubectl --context x"; $K get …`, `k(){ kubectl "$@"; }; k get …` | rozwinąć |
| flagi przed podkomendą: `kubectl --context X -n Y get`, `git -C dir log`, `flux -n x get`, `helm --kube-context x status` | pominąć flagi globalne, klasyfikować po podkomendzie |
| heredoc | treść = dane, nie komendy |
| rozwinięcie niemożliwe (np. `$VAR` z zewnątrz) | traktować jak nieznaną komendę (§3.7) |

### 3.3 Zmiany zewnętrzne — allow (decyzja użytkownika), z wyjątkami

| Narzędzie | Allow | Nadal ask |
|---|---|---|
| git | `git push` | `--force`/`--force-with-lease`/`-f` (także łączone `-uf`)/`--delete`/`-d`/`--mirror`/`+refspec`/`:refspec` |
| gh | odczyty (§3.2); `gh pr create`; **decyzja architekta:** także pozostałe `gh pr …`, `gh issue create/comment/edit` | `gh repo delete/edit/rename/archive`, `gh repo deploy-key add/delete`, `gh secret set/delete`, `gh api` z metodą ≠ GET (`-X POST/PUT/PATCH/DELETE`, `-f/-F` bez `-X GET`), `gh auth …`; **decyzja użytkownika:** każda inna zmieniająca podkomenda, np. `release create/delete/edit/upload`, `workflow run/enable/disable`, `run cancel/rerun/delete`, `repo fork/create`, `label …`, `variable …`, `cache delete` |
| jk (Jenkins) — **decyzja użytkownika** | odczyty, które dziś ma dozwolone agent `jenkins` w `opencode.json`: `version`, `auth status`, `context ls`, `search`, `job ls/view/config`, `run ls/view/params/search`, `log`, `artifact ls`, `test report`, `cred ls`, `node ls`, `queue ls`, `plugin ls` | wszystko inne |
| curl / wget / http — **decyzja użytkownika** | GET/HEAD bez danych; dowolne żądania do `localhost`/`127.0.0.1`/`::1` | metoda ≠ GET/HEAD lub dane (`-d`, `--data*`, `-F`, `-T`, `--upload-file`, `-X` ≠ GET/HEAD) do innych hostów. Zapis pliku (`-o`) — wg §3.1 |
| mnemoteca — **decyzja użytkownika** | `stats`, `search`, `list` | `delete`, `import`, inne zapisy |
| kubectl | `apply/exec/delete/rollout/scale/patch/label/annotate/create` | `delete` dla `namespace`/`ns`, `pvc`, `pv`, `crd` (też `delete -f` pliku, który je zawiera — jeśli da się ustalić; inaczej ask), `delete --all`; odczyt sekretów — wg §3.4 |
| flux | `reconcile/suspend/resume` | `flux delete`, `flux uninstall` (**decyzja architekta**) |
| helm | `upgrade/install/rollback` | `helm uninstall` (**decyzja architekta**) |
| chmura | `aws`/`gcloud` `describe/list/get` | wszystko inne (zapisy) |
| rejestry obrazów | — | `crane push/delete/tag/copy`, `podman push`, `docker push` |

- **Decyzja użytkownika:** lista znanych CLI i ich zmieniających podkomend jest **rozszerzalna w
  opcjach pluginu** (§4.2); tabela wyżej to wartości domyślne.
- Agenci `debugger` i `explore`: wszystkie pozycje tej tabeli (także allow) → ask (§3.8).

### 3.4 Dane wrażliwe (decyzja użytkownika)

| Dane | Zachowanie |
|---|---|
| prywatne klucze `~/.ssh/id_*` (i inne klucze prywatne w `~/.ssh`; bez `*.pub`, `config`, `known_hosts`); keychain (`security`, już deny w konfiguracji); `~/.local/share/opencode/auth.json`; `gcloud … print-access-token`/`print-identity-token`; `aws … get-session-token`/`get-secret-value`/`ecr get-login-password` (**decyzja architekta**) | **deny** — twardy zakaz, niezdejmowalny kliknięciem |
| `secrets/`, `*.token`, `*.key`, `*.pem` (**decyzja architekta**), `.env`/`.env.*`, `~/.kube/config`, `~/.aws/credentials`, `~/.config/gcloud/**`; odczyt sekretów z klastra (`kubectl get secret … -o yaml/json/jsonpath/go-template`; `describe secret` jest OK); `env`/`printenv` bez filtra lub z filtrem łapiącym klucze | **ask** za każdym razem; zapisane „Always” ignorowane |
| `kubectl create secret … --dry-run=client -o yaml \| kubeseal` | **allow** (niczego nie ujawnia) |

**Decyzja architekta — egzekucja twardego zakazu:** dla ścieżek wewnątrz katalogu sesji natywny zasób
uprawnienia jest **względny** (`core/src/file-access.ts:93-104`), więc reguły `read`/`edit` deny dla
`~/.ssh/id_*` nie łapią np. sesji uruchomionej w `~`. Plugin MUSI sam egzekwować twardy zakaz po
absolutnej ścieżce po `realpath` — dla wszystkich narzędzi plików i powłoki. Reguły `deny` w
konfiguracji (§4.3) są dodatkową warstwą.

### 3.5 Chroniona konfiguracja

| Ścieżki | Odczyt | Zapis (każdą drogą) |
|---|---|---|
| `~/.config/opencode/{opencode.json, opencode.jsonc*, opencode.*.json, agents/**, secrets/**}`, dowolne `.opencode/**`, `~/.local/share/opencode/opencode.db*` | allow (z wyjątkiem `secrets/**` — §3.4) | ask za każdym razem |
| plugin: źródła (submoduł i symlink w `plugins/`), launcher piaskownicy (§4.4), katalog stanu pluginu (profile, znaczniki jednorazowe), opcje `~/.config/opencode/agent-guard.json` i `agent-guard.local.json` (§4.2) — **decyzja architekta** | allow | ask za każdym razem |

Dzisiejsze reguły `edit` i 40 reguł bash z commita `5bb5157` robią to wzorcami — plugin przejmuje tę
rolę precyzyjnie, po celu zapisu.

### 3.6 Mac i inne maszyny (decyzja użytkownika: pytać)

| Ask | Wyjątki (allow) |
|---|---|
| `brew install/uninstall/upgrade/tap/untap/services` | — |
| `softwareupdate`, `defaults write/delete`, `tmutil` | — |
| `launchctl` | `list`, `print` |
| `pmset` (ustawianie) | `pmset -g` (§3.2) |
| `diskutil` | `list`, `info` |
| `networksetup -set…`, `scutil --set` | — |
| `kill`/`pkill`/`killall` | procesy uruchomione przez agenta w tej sesji (`kill $!`, pid z pliku w tmp, który agent sam zapisał) — jeśli da się to wiarygodnie rozpoznać; inaczej ask (**decyzja architekta**; konstruktor ocenia wykonalność) |
| `ssh`/`scp`/`rsync`/`sftp` na inne maszyny | agent `ha`: `ssh esp.iot …`, `scp … esp.iot:…` (jego zadanie, jest w konfiguracji; wyjątek per agent w opcjach — §3.8) |
| `hs -c`/`hs` (dowolny Lua w Hammerspoon), `osascript` | — |
| `sudo` (cokolwiek) | — |

### 3.7 Nieznane

**Decyzja użytkownika:** komenda, której nie da się sklasyfikować → allow, jeśli wszystkie wykryte cele
zapisu są w strefach zapisu i nie dotyka §3.3–3.6; inaczej ask. Pliki pilnuje piaskownica z etapu 2.

- Znane CLI z listą zmieniających podkomend (§3.3: `gh`, `jk`, `curl`/`wget`/`http`, `mnemoteca`
  itd.) nie są „nieznane” — ich zmiany pytają.
- **Plugin nie wykrywa zmian zewnętrznych robionych przez nieznane CLI** (np. wywołań API przez
  nieznane narzędzie) — świadomie akceptowane.

### 3.8 Profile agentów (decyzja architekta)

| Profil | Agenci | Zachowanie |
|---|---|---|
| pełny | lista w `agent-guard.json` (nie hardkodowana); domyślnie: `general`, `coder`, `devops`, `frontend`, `cloudflare`, `writer`, `skill-smith`, `stitch`, `build`, `ha`, `jenkins` | pełne zasady §3.1–3.7; etap 2 — piaskownica |
| diagnoza | `debugger`, `explore` **oraz każdy agent z pełną powłoką nieznany lub niewymieniony w opcjach** (bezpieczny domyślny) | jak pełny, ale wszystko z §3.3 (także pozycje allow) → ask; zapisy plików jak dla innych |
| ograniczona powłoka | `architect`, `plan`, `autopilot`, `webscraper`, `webresearcher`, `webmonitor`, `jira`, `stitch-mcp` | plugin przepuszcza natywny `effect` bez zmian; obowiązują tylko twarde zakazy (§3.4, egzekucja pluginu) |

Przypisanie profilu pełnego = jedna linia w `agent-guard.json`. Wyjątki per agent w opcjach pluginu,
np. `ha` → `ssh esp.iot …`, `scp … esp.iot:…`.

### 3.9 Zakres akcji (decyzja architekta)

| Akcja uprawnienia | Plugin |
|---|---|
| narzędzia plików (`read`, `grep`, `glob`, `edit`, `write`), powłoka (`shell`), `external_directory` | decyduje wg §3 |
| wszystko inne: MCP, webfetch, subagent, skill, question | przepuszcza natywny `effect` bez zmian (poza zakresem) |

## 4. Architektura

### 4.1 Mechanizmy OpenCode v2 (zweryfikowane w v2.0.22)

| Mechanizm | Co daje | Źródło |
|---|---|---|
| Hook `permission.evaluate` | dostaje `sessionID`, `agent`, `action`, `resources`, `metadata`, `source` (identyfikator wywołania narzędzia) i wyliczony `effect` (konfiguracja + zapisane zgody); plugin może ustawić `effect` (allow/ask/deny) i `message`. **Nie jest wołany**, gdy konfiguracja dała `deny` (`permission.ts:175`). **Nie dostaje cwd ani pełnej komendy** — zasoby to podkomendy bez `cd` i przypisań. Akcja dla powłoki: `shell` | `plugin/src/promise/permission.ts`; wołany w `core/src/permission.ts:179` |
| Kontekst pluginu `permission` | tylko `list`/`get`/`reply` (oczekujące żądania) — **brak API listy zapisanych zgód** | `plugin/src/promise/permission.ts` |
| Hook `shell.create.before` | mutowalne `command`, `cwd`, `timeout`, `shell`, `env`. Działa **PRZED** parsowaniem i sprawdzeniem uprawnień, **nie zna sesji ani agenta**, odpala się też dla komend użytkownika `!` | `core/src/shell.ts:254-276`, `core/src/tool/plugin/shell.ts:120-140, 200-212`, `plugin/src/promise/shell.ts` |
| Hooki `tool.execute.before/after` | `before`: dla powłoki pełna komenda i katalog roboczy (`input.command`/`workdir`); `after`: można dopisać wskazówkę do wyniku/błędu | `plugin/src/promise/tool.ts` |
| `experimental.policies` | też implementowane jako hook `permission.evaluate` — **nie** jest sprawdzane przed hookami; nie używamy | `core/src/config/plugin/policy.ts` |
| Natywne `external_directory` | pytanie przy dostępie spoza katalogu sesji/worktree; zgoda zapisywana jako `<root projektu katalogu>/*`; domyślnie dozwolone tylko tmp OpenCode i katalogi OpenCode — **nie** `/tmp` ani korzeń `$TMPDIR` | `core/src/file-access.ts:93-142`, `core/src/agent.ts:60-63` |
| Zasób ścieżki wewnątrz katalogu sesji | względny (nie absolutny) | `core/src/file-access.ts:93-104` |
| Rozbijanie komend | tree-sitter-bash; zasób = pełny tekst podkomendy z przekierowaniami i heredokiem; `~` nierozwijane | `core/src/shell/parse.ts` |
| Lokalne pluginy | `.opencode/plugins/` ładowane automatycznie; pluginy katalogowe dostają `options: {}` | `services/www/src/docs/content/build/plugins/index.mdx`, `core/src/config/plugin/source.ts:131` |

### 4.2 Komponenty pluginu

| Komponent | Odpowiedzialność |
|---|---|
| **Zone resolver** | strefy zapisu: katalog sesji i worktree (z API sesji/lokalizacji; reguły `$HOME`/`/` — §3.1) oraz korzenie tmp (realpath, `/tmp`→`/private/tmp`, korzeń `$TMPDIR`); ścieżki wrażliwe i chronione. Katalogów przyznanych **nie** rozwiązuje (§3.1). Wszystko po `realpath` (symlinki!) |
| **Call correlator** (decyzja architekta) | z `tool.execute.before` bierze pełną komendę i `workdir` (`input.command`/`workdir`) i łączy je z żądaniem uprawnienia po identyfikatorze wywołania (`source`); hook uprawnień sam ich nie dostaje (§4.1) |
| **Command analyzer** | ten sam parser co v2 (tree-sitter-bash) na pełnej komendzie z correlatora; rozwija opakowania i definicje z §3.2; śledzi `cd` od `workdir` dla ścieżek względnych; wyciąga cele zapisu i odczytu; heredoc = dane |
| **Classifier** | kategorie: `READ` / `LOCAL-BUILD` / `PROJECT-WRITE` / `SCRATCH` / `EXTERNAL-ALLOWED` / `EXTERNAL-ASK` / `SYSTEM` / `SENSITIVE-DENY` / `SENSITIVE-ASK` / `PROTECTED-WRITE` / `OUTSIDE-WRITE` / `UNKNOWN` |
| **Decision engine** | profil agenta (§3.8) + zakres akcji (§3.9) + tabele z §3 → allow/ask/deny + `message` po polsku, mówiący DLACZEGO pyta (np. „zapis poza katalogiem sesji: ~/.hammerspoon/localconfig.lua”). Dla ask z §3.1 (zapis poza strefami zapisu), §3.4 i §3.5: ignorować zapisane zgody („za każdym razem”). Twardy zakaz §3.4 egzekwuje sam, po absolutnej ścieżce. **Nigdy nie łagodzi** otrzymanego `deny` |
| **Fail-safe** | wyjątek/timeout w pluginie → `ask` z komunikatem o błędzie pluginu; nigdy cichy `allow` |
| **Decision log** | JSONL: czas, sesja, agent, action, zasób skrócony, kategoria, decyzja, powód. Bez treści heredoców i bez wartości sekretów |
| **Opcje** (decyzja architekta) | pluginy katalogowe dostają `options: {}`, więc plugin czyta własne pliki: `~/.config/opencode/agent-guard.json` (w repo, wspólny) + opcjonalny `agent-guard.local.json` (gitignored, per maszyna, np. `mode`), local nadpisuje. Oba chronione (§3.5). Zawartość: `mode: enforce \| shadow` (shadow = tylko loguje, co by zdecydował; efekt bez zmian); listy wrażliwe/chronione; korzenie tmp; profile agentów i wyjątki per agent (np. `ha` → `ssh esp.iot`); znane CLI z podkomendami zmieniającymi (§3.3, rozszerzalne); allowlista cache narzędzi dla piaskownicy |
| **Launcher + katalog stanu** (etap 2) | skrypt startowy piaskownicy, pliki profili sesji, znaczniki jednorazowe — §4.4 |

### 4.3 Podział ról konfiguracja ↔ plugin (decyzja architekta)

| Warstwa | Rola |
|---|---|
| Konfiguracja — `deny` w `opencode.json` | jedyne miejsce twardych zakazów w konfiguracji; sprawdzane przed hookami (`permission.ts:175`), niezdejmowalne: `security *`, ograniczone powłoki agentów jak dziś, plus nowe `read`/`edit` deny dla ścieżek z twardego zakazu (§3.4; natywne reguły ścieżek z rozwijaniem `~`). Dodatkowa warstwa — nie łapią ścieżek względnych w katalogu sesji (§3.4). `experimental.policies` nie używamy (to też hook, §4.1) |
| Konfiguracja — `external_directory` allow | nowe reguły dla `/tmp/*`, `/private/tmp/*` i korzenia `$TMPDIR` (realpath) — natywnie dozwolone jest tylko tmp OpenCode (§4.1) |
| Plugin | wszystko poza twardymi zakazami — nadpisuje `effect`; sam egzekwuje też twardy zakaz §3.4 po absolutnej ścieżce; nigdy nie łagodzi otrzymanego `deny` |
| Konfiguracja — obecne wzorce bash w `opencode.json` | zostają jako fallback, gdy plugin jest wyłączony/niezaładowany. Uproszczenie po ustabilizowaniu etapu 1 = osobna decyzja, poza tym projektem |
| Zapisane zgody „Always” (poza `external_directory`) | przy włączonym pluginie bez znaczenia; nie trzeba ich czyścić |

### 4.4 Etap 2 — piaskownica (macOS `sandbox-exec`)

| Aspekt | Projekt |
|---|---|
| Opakowanie (decyzja architekta) | `shell.create.before` działa przed uprawnieniami i nie zna sesji/agenta (§4.1), więc plugin **NIE przepisuje `command`** — podmienia `shell` na launcher z pluginu, który uruchamia `sandbox-exec -p <profil> <prawdziwa powłoka> -c <command>` |
| Rozpoznanie sesji/agenta | launcher czyta zmienne środowiskowe ustawiane przez OpenCode przed spawn (np. `AGENT`, `OPENCODE_SESSION_ID` — nazwy potwierdza konstruktor); opakowuje tylko agentów z profilem pełnym/diagnoza (§3.8); komendy użytkownika `!` — bez piaskownicy |
| Profil sesji | plugin zapisuje go do pliku w swoim katalogu stanu; launcher go wczytuje |
| Profil — baza | `(allow default)` |
| Profil — zapis | `deny file-write*` poza: katalog sesji, korzenie tmp, allowlista cache narzędzi (np. `~/.cargo`, `~/.rustup`, `~/.npm`, `~/.yarn`, `~/.bun`, `~/.cache`, `~/.local/share/uv`, `~/Library/Caches`, `~/.kube/cache`, gniazdo/katalogi podmana, `/dev/null`, `/dev/tty*`, `/dev/fd`). Ostateczna lista — empirycznie |
| Profil — odczyt | `deny file-read*` dla twardego zakazu z §3.4 |
| Sieć, mach-lookup | dozwolone (gh/git używają keychain przez framework; `security` CLI i tak zablokowane) |
| Reszta dysku (w tym katalogi przyznane) | w piaskownicy z natury read-only (poza allowlistą cache) |
| Zapis poza strefę wykryty przez analizator i zatwierdzony przez użytkownika (decyzja architekta) | ta jedna komenda uruchamia się **BEZ piaskownicy**: plugin po decyzji zapisuje jednorazowy znacznik (sesja + hash komendy) w katalogu stanu, launcher go zużywa |
| Ochrona | launcher i katalog stanu pluginu — chronione (§3.5) |
| Zapis niewykryty (wnętrze skryptu) | `Operation not permitted`; plugin dopisuje do wyniku wskazówkę, że to piaskownica. Agent może ponowić z jawną prośbą o uruchomienie poza piaskownicą (mechanizm do wyboru przez konstruktora, np. znacznik w komendzie lub osobne narzędzie). Taka prośba **ZAWSZE** kończy się pytaniem do użytkownika z pokazaną komendą, nigdy cicho |
| Brak `sandbox-exec` (inny system) | etap 2 wyłączony z ostrzeżeniem w logu; działa etap 1 |
| Poza zakresem etapu 2 | agenci z ograniczoną powłoką oraz narzędzia `edit`/`write` (działają w procesie serwera) — pilnuje ich etap 1 |

## 5. Umiejscowienie (decyzja architekta)

- Osobne repozytorium `opencode-agent-guard` (TypeScript, testy), dołączone do `~/.config/opencode`
  jako submoduł (wzór: `opencode-mnemoteca`), ładowane z `plugins/` (symlink do submodułu, jak
  mnemoteca). Źródła leżą pod `~/.config/opencode` → podlegają §3.5.
- Opcje: `~/.config/opencode/agent-guard.json` (w repo) + `agent-guard.local.json` (gitignored) —
  §4.2; nie wpis w `opencode.json` (pluginy katalogowe dostają `options: {}`).
- Brak pluginu/submodułu → działają reguły z `opencode.json` (fallback, §4.3).
- Konfiguracja współdzielona z komputerem służbowym (ten sam `opencode.json`): plugin musi działać na
  obu maszynach. Ścieżek domowych nie hardkodować — `$HOME`, `os.tmpdir()`, realpath.

## 6. Wdrożenie i akceptacja

| # | Krok | Kryterium przejścia |
|---|---|---|
| 0 | Przygotowanie (decyzja architekta): skopiować korpus z `$TMPDIR/opencode/permaudit/` do fixtures repo pluginu (tmp może zostać wyczyszczony); dodać w `opencode.json` reguły `external_directory` allow dla `/tmp/*`, `/private/tmp/*`, korzenia `$TMPDIR` (§4.3); konstruktor przygotowuje tabelę oczekiwanych decyzji dla `remaining.json` (i próbki pozostałych) wg nowych zasad. `EXTERNAL-MUTATE` ze starej taksonomii **nie** oznacza automatycznie ask | korpus w repo; tabela oczekiwanych decyzji gotowa do przeglądu |
| 1 | Etap 1 w `shadow` na korpusie audytu (odtworzenie decyzji dla `evaluated.json` z fixtures) | ≤ ~120 ask; decyzje zgodne z tabelą oczekiwanych decyzji (0 allow tam, gdzie tabela mówi ask/deny); wszystkie przypadki z §3.4 i §3.5 poprawne. Testy jednostkowe analizatora z przykładami z audytu: opakowania, `$K`, `k()`, heredoc z kodem Rust, `bash -c`, `cd &&`, `git -C`, przekierowania w środku łańcucha |
| 2 | Etap 1 `shadow` w realnych sesjach przez kilka dni | użytkownik zatwierdził tabelę oczekiwanych decyzji; przegląd logu decyzji z użytkownikiem → przełączenie na `enforce` |
| 3 | Etap 2 najpierw w trybie „tylko loguj naruszenia” (jeśli wykonalne, np. profil z `(allow … (with report))` albo analiza logu sandboxd) | dopracowana allowlista cache → włączenie blokowania |
| 4 | Smoke test | typowe zadania (Rust/cargo, Lua busted/luacheck, yarn, uv, podman, devops kubectl/flux/helm/kubeseal, `gh pr create`, `git push`) bez żadnego pytania; zapis do `~/.hammerspoon` z `python3` → zablokowany w etapie 2 i pytanie po prośbie o wyjście |

## 7. Pozostawione konstruktorowi

- wersje i sposób dołączenia tree-sitter-bash;
- layout paczki;
- dokładna składnia profilu `sandbox-exec` i lista cache;
- wykonalność śledzenia „własnych” PID (§3.6);
- format logu decyzji;
- mechanizm prośby o wyjście z piaskownicy;
- nazwy zmiennych środowiskowych sesji/agenta dla launchera i sposób rozpoznania komend `!` (§4.4);
- format znacznika jednorazowego i katalogu stanu;
- tabela oczekiwanych decyzji dla korpusu (do zatwierdzenia przez użytkownika, §6).

## 8. Decyzje architekta do przejrzenia przez użytkownika

1. §3.1 — kasowanie (`rm`, `git reset`, `git clean`) w katalogu sesji = allow (odwracalne: git + migawki OpenCode).
2. §3.1 — strefa projektu = katalog sesji + jego git worktree root (jak „internal” w `file-access.ts`); worktree root = `$HOME`/`/` → tylko katalog sesji.
3. §3.1 — sam katalog sesji = `$HOME` albo `/` → brak strefy projektu; zapis bez pytania tylko w tmp.
4. §3.2 — `podman run` allow tylko bez `--privileged` i bez montowania ścieżek spoza stref zapisu.
5. §3.3 — poza `gh pr create` także pozostałe `gh pr …` oraz `gh issue create/comment/edit` = allow.
6. §3.3 — `flux delete`, `flux uninstall`, `helm uninstall` = ask.
7. §3.4 — `aws … get-session-token`/`get-secret-value`/`ecr get-login-password` = deny.
8. §3.4 — `*.token`, `*.key`, `*.pem` = ask za każdym razem.
9. §3.4 — plugin sam egzekwuje twardy zakaz po absolutnej ścieżce (realpath) dla wszystkich narzędzi i powłoki; reguły `deny` w konfiguracji to dodatkowa warstwa.
10. §3.5 — launcher, katalog stanu i pliki opcji pluginu (`agent-guard.json`, `agent-guard.local.json`) = chronione.
11. §3.6 — `kill` własnych procesów sesji = allow, jeśli wiarygodnie rozpoznawalne; inaczej ask.
12. §3.8 — profile agentów: pełny (lista w `agent-guard.json`) / diagnoza (`debugger`, `explore` i każdy nieznany/niewymieniony agent z pełną powłoką: całe §3.3 → ask) / ograniczona powłoka (natywny `effect` bez zmian, tylko twarde zakazy).
13. §3.9 — MCP, webfetch, subagent, skill, question: natywny `effect` bez zmian (poza zakresem).
14. §4.2 — pełna komenda i `workdir` z `tool.execute.before`, łączone z żądaniem uprawnienia po `source`.
15. §4.2/§5 — opcje z własnych plików `agent-guard.json` + `agent-guard.local.json` (nie z `opencode.json`); brak pluginu → fallback na reguły `opencode.json`.
16. §4.3 — twarde zakazy wyłącznie jako `deny` w `opencode.json` (bez `experimental.policies`); plugin nigdy nie łagodzi `deny`; wzorce bash zostają jako fallback.
17. §4.3/§6 — reguły `external_directory` allow dla `/tmp/*`, `/private/tmp/*`, korzenia `$TMPDIR`.
18. §4.4 — piaskownica przez podmianę `shell` na launcher (bez przepisywania `command`); sesja/agent ze zmiennych środowiskowych; `!` bez piaskownicy; zatwierdzony zapis poza strefę → ta komenda bez piaskownicy przez jednorazowy znacznik.
19. §5 — osobne repo `opencode-agent-guard` jako submoduł `~/.config/opencode`, ładowane z `plugins/` (symlink).
20. §6 — korpus audytu do fixtures na start; tabela oczekiwanych decyzji zatwierdzana przez użytkownika przed `enforce`; `EXTERNAL-MUTATE` ≠ automatycznie ask.

## 9. Wyniki przeglądu konstruktora (2026-10-19)

| ID | Ustalenie (źródła v2.0.22) | Skutek | Sekcje |
|---|---|---|---|
| U1 | — (decyzja użytkownika) | znane CLI ze zmieniającymi podkomendami pytają (`jk`, reszta `gh`, `curl`/`wget`/`http`, `mnemoteca`); lista rozszerzalna; nieznane CLI — bez wykrywania zmian zewnętrznych | §3.3, §3.7 |
| U2 | kontekst pluginu `permission` ma tylko `list/get/reply` | odczyt powłoką allow poza §3.4; `external_directory` tylko natywnie; plugin nie zna katalogów przyznanych — zapis poza sesją/tmp → ask | §3.1, §4.2 |
| A1 | `shell.create.before` przed uprawnieniami, bez sesji/agenta, także dla `!` | launcher zamiast przepisywania `command`; znacznik jednorazowy | §4.1, §4.4 |
| A2 | — | worktree root `$HOME`/`/` → tylko katalog sesji; katalog sesji `$HOME`/`/` → brak strefy projektu | §3.1 |
| A3 | `experimental.policies` = hook `permission.evaluate` | twarde zakazy tylko jako `deny` w `opencode.json` | §4.1, §4.3 |
| A4 | zasób w katalogu sesji jest względny | plugin egzekwuje twardy zakaz po absolutnej ścieżce | §3.4, §4.3 |
| A5 | — | profile agentów; nieznany agent z pełną powłoką → „diagnoza”; lista pełnych w `agent-guard.json` | §3.8 |
| A6 | — | zakres akcji | §3.9 |
| A7 | pluginy katalogowe: `options: {}` | własne pliki opcji, chronione | §3.5, §4.2, §5 |
| A8 | hook uprawnień bez cwd i pełnej komendy; akcja `shell` | correlator po `source` | §4.1, §4.2 |
| A9 | natywnie dozwolone tylko tmp OpenCode | reguły `external_directory` dla `/tmp`, `$TMPDIR` | §4.3, §6 |
| A10 | — | fixtures + tabela oczekiwanych decyzji | §6 |
