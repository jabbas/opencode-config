# Model uprawnień v2 — „przedłużenie ręki”: domyślnie wolno, hamulce po skutkach, cel rozpoznawany przez plugin

- **Data:** 2026-10-22
- **Status:** Approved (2026-10-23); poprawka §4.7a (2026-10-25, powłoka tylko do odczytu dla agentów ograniczonych — do zatwierdzenia)
- **Zastępuje:** podejście „wariant A” (ponad 1000 reguł wzorców w `opencode.json`, commity `3480a60…f9822ad`).
  **Odkłada:** `docs/superpowers/specs/2026-10-19-agent-guard-design.md` (piaskownica z jego §4.4 → §8 tego dokumentu).
- **Źródła faktów:** OpenCode v2.0.30 w `~/Projects/opencode`. Ścieżki względem tego repo:

  | Fakt | Źródło |
  |---|---|
  | Domyślne uprawnienia: `* * allow` + `read *.env` ask | `packages/schema/src/agent.ts:46-51` |
  | Role `build` / `plan` / `explore` | `packages/core/src/plugin/agent.ts` |
  | Hook `permission.evaluate` oraz nowe `ctx.permission.assert` | `packages/plugin/src/promise/permission.ts:8-32` |

- **Uwaga o wersji:** zainstalowana binarka to **v2.0.22**, a nie v2.0.30. Konstruktor sprawdza w kodzie
  pluginu, czy `assert` istnieje w zainstalowanej wersji. Jeśli nie, plugin używa `effect` + `message` (§5).
- **Przeglądy skilli z 2026-10-22** (superpowers i pozostałe): wnioski wplecione w §4.7 i §8.
- **Przegląd konstruktora (2026-10-22)** względem źródeł OpenCode: wyniki A1–A8 wpisane w treść,
  zestawienie w §9. Najważniejsze: komunikat hooka **nie jest pokazywany użytkownikowi w pytaniu** (A1);
  decyzja użytkownika z 2026-10-23: zwykłe `ask` + jednolinijkowe oświadczenie celu przez agenta w czacie (§4.6a).
- **Dla kogo:** dokument ma wystarczyć konstruktorowi do zaplanowania i wykonania prac bez dopytywania
  użytkownika. Co zostaje do ustalenia przez konstruktora — §7.

## 1. Intencja / dlaczego

Użytkownik: **„agenci mają być przedłużeniem mojej ręki, ale bezpiecznym”.**

### 1.1 Kontekst

| Aspekt | Opis |
|---|---|
| Maszyny | Ta sama konfiguracja działa na prywatnej (domowy klaster Talos/Flux `admin@k8s`, kind) i służbowej (prawdziwe środowiska AWS: awscli, EKS, S3, VPC) |
| Poświadczenia | Agenci działają z **pełnymi poświadczeniami użytkownika** |
| Ochrona po stronie serwerów | Odpada (admission policies, SCP) — w pracy użytkownik nie ma na nią wpływu |

### 1.2 Problemy dotychczasowego podejścia (wyliczanie bezpiecznych komend wzorcami)

| Problem | Skutek |
|---|---|
| Nieskończony ogon | Każde nowe narzędzie lub styl zapisu = nowa runda dopisywania reguł |
| Skala | Ponad 1000 reguł w `opencode.json` |
| Fałszywe pytania | Użytkownik jest przerywany przy niegroźnych komendach |
| Plugin `shell-style` | Łata na ograniczenia wzorców, sama wymaga utrzymania |

### 1.3 Diagnoza (brainstorm 2026-10-22)

| # | Wniosek |
|---|---|
| 1 | Lista zakazów (blacklist hamulców) też ma ogon, ale **krótszy** niż lista dozwolonych |
| 2 | Dla AWS istnieje dziś dobra reguła odwrotna: odczyty `describe/list/get` wolno, reszta pyta. **Nie wolno jej stracić** |
| 3 | To samo uprawnienie ma dwa znaczenia zależnie od celu: `kubectl delete ns` na kind = rutyna, na `admin@k8s`/EKS = katastrofa |

## 2. Cele / nie-cele / anty-cele

| Typ | Treść |
|---|---|
| Cel | Pytania tylko tam, gdzie użytkownik sam by się zatrzymał |
| Cel | Nowe narzędzie lokalne działa bez dopisywania reguł |
| Cel | Zapis na zewnątrz nieznanym narzędziem domyślnie pyta (zamknięty ogon) |
| Cel | Zapis na prod/nieznany: użytkownik dowiaduje się, jaki jest cel z jednolinijkowego oświadczenia agenta tuż nad natywnym pytaniem (§4.6a — komunikat hooka nie trafia do okna pytania) |
| Cel | Role agentów (autopilot, architect, plan, read-only) zachowane |
| Cel | „Najgorszy dzień” użytkownika (`kubectl delete namespace flux-system\|kube-system`, destrukcja w AWS prod) zatrzymany **niezależnie od narzędzia**, tam gdzie to wykonalne |
| Nie-cel | Ochrona przed agentem działającym w złej wierze |
| Nie-cel | Piaskownica systemowa — osobny, późniejszy krok (§8) |
| Nie-cel | Kontrola sieci |
| Nie-cel | Zmiana skilli superpowers. Błędy skilli (`cd`/`git -C` między wywołaniami, `/tmp`, jawny model przy subagentach) — osobne poprawki w forku (§8) |
| Anty-cel | Więcej pytań niż dziś w pracy lokalnej |
| Anty-cel | Pytania o odczyty |
| Anty-cel | Reguły, które trzeba dopisywać dla każdego nowego narzędzia lokalnego |
| Anty-cel | Autopilot wykonujący pracę sam |

## 3. Model: trzy obszary z własną domyślnością

**Decyzja użytkownika:** „brzmi jak przedłużenie mojej ręki”.

| Obszar | Domyślnie | Wyjątki |
|---|---|---|
| **Lokalnie** — pliki w projekcie i tmp, build, testy, lintery, git lokalny, podman, kind, skrypty projektu i tmp, dowolne nowe CLI lokalne | **allow** | **deny:** sekrety (§4.2). **ask:** zapis do konfiguracji OpenCode (§4.4), `sudo`, `brew install/uninstall/upgrade`, `softwareupdate`, `defaults write`, `launchctl` (poza `list`/`print`), `kill/pkill/killall` (poza `$!`/`%N`), `ssh/scp/rsync` na inne maszyny (wyjątek per agent: `ha` → `esp.iot`), `hs -c`, `osascript`, `diskutil` (poza `list`/`info`), `tmutil` |
| **Odczyt na zewnątrz** — `get/describe/list/show/status/logs/view/watch/history/diff/explain/top/events/search/search-*`, `gh api` GET, `curl`/`wget` GET/HEAD | **allow** | **ask:** sekrety z klastra (`kubectl get secret -o …` poza `-o name`; `talosctl get *secret*\|osroot*\|*machineconfig*`). **deny:** tokeny (`gcloud print-*-token`, `aws *get-secret-value\|get-session-token\|ecr get-login-password`) |
| **Zapis na zewnątrz** — klaster, AWS, GitHub, Cloudflare, Jenkins, Talos, Stitch, Anthropic `ant`, rejestry obrazów, poczta | **ask** — chyba że cel jest **dev** i skutek **odwracalny** | **dev** (kind, tmp-kubeconfig, konteksty/profile oznaczone jako dev): allow. **prod / nieznany:** ask (cel podaje agent w czacie — §4.6a). **Nieodwracalne** na prod (§4.3): ask zawsze, także na dev, gdy dotyczy `flux-system`/`kube-system` |

### 3.1 Decyzje użytkownika zachowane z wcześniejszych rund

Poniższe = **allow** na domowym klastrze `admin@k8s` i w repo użytkownika (odwracalne przez GitOps/git):

| Narzędzie | Allow |
|---|---|
| git | `git push` (bez force/delete/mirror — te patrz §4.3) |
| gh | `gh pr *`, `gh issue create/comment/edit` |
| kubectl | `apply`, `exec`, `rollout`, `scale`, `patch`, `label`, `annotate` |
| flux | `reconcile`, `suspend`, `resume` |
| helm | `upgrade`, `install`, `rollback` |
| kubectl | `create`, `cp`, `port-forward` — decyzja użytkownika 2026-10-24 (bramka 1, pkt 2) |
| helm | `repo add`, `repo update` — decyzja użytkownika 2026-10-24 (bramka 1, pkt 2) |

- Agent `debugger` ma te same prawa co `devops`/`coder`.
- Operacje nieodwracalne na `admin@k8s` (np. `kubectl delete ns`, `helm uninstall`) nadal pytają — §4.3 i klasa `home` w §4.6.
- Dalsze decyzje użytkownika z bramki 1 (2026-10-24): lista `home` = tylko `admin@k8s` (wzorce `dev`/`prod` bez zmian); lokalnie nadal pytają `brew install/uninstall/upgrade/tap/untap/services` (`brew info` itp. = odczyt), `pip install`, każdy `rsync`; czasowniki działające na plikach lokalnych są odczytem: `talosctl gen config|machineconfig patch|validate|image default|image list`, `gh release download`, `gh run download` (`talosctl gen secrets` i `wrangler deploy --dry-run` nadal pytają); literalny `export AWS_PROFILE=x && aws … describe` = cel możliwy do ustalenia (profil `x`), nie „nieznany” (zob. §4.1, A6); `env | grep WZORZEC` bez kotwicy `^` pyta.

## 4. Reguły

### 4.1 Klasyfikacja po czasowniku, nie po narzędziu (decyzja architekta)

Plugin (nie wzorce w `opencode.json`) rozpoznaje czasownik/podkomendę niezależnie od kolejności flag dla znanych CLI:
`aws`, `kubectl`, `helm`, `flux`, `talosctl`, `gh`, `git`, `jk`, `wrangler`, `cf`, `ant`, `crane`, `docker/podman push`, `curl/wget/http`.

| Reguła | Opis |
|---|---|
| Znane CLI | Odczyty wg listy czasowników odczytu (konfigurowalnej); zapisy = reszta |
| Nieznane CLI z celem zewnętrznym | Cel rozpoznawalny po flagach (`--context`, `--profile`, `--kubeconfig`, `-n <ip>`, URL inny niż localhost) → traktuj jak **zapis na zewnątrz (ask)**, chyba że czasownik jest odczytem |
| Nieznane CLI bez celu zewnętrznego | Lokalne → **allow** |

**AWS** — czasownik = część po usłudze (`aws <svc> <verb>`):

| Klasa | Czasowniki / formy |
|---|---|
| Odczyt | `describe-*`, `list-*`, `get-*`, `head-*`, `search-*`, `lookup-*`, `filter-*`, `scan`, `query`, `select-*` |
| Odczyt (S3) | `aws s3 ls`; `aws s3 cp s3://… → lokalnie`; `aws s3 sync s3://… → lokalnie` |
| Zapis (S3) | `aws s3 cp lokalnie → s3://…`; `aws s3 sync … → s3://…`; `aws s3 rm`; `aws s3 rb`; `aws s3 mb` |
| Zapis | wszystko inne |

**Nierozpoznawalne (decyzja architekta, A2).** Zasada: czego plugin nie umie rozpoznać przy ZNANYM
zewnętrznym CLI, traktuje jak zapis na zewnątrz.

| Sytuacja | Klasyfikacja | Efekt |
|---|---|---|
| Znane zewnętrzne CLI, a czasownik, kontekst, profil lub cel jest zmienną / podstawieniem / nieznany: `kubectl delete $KIND $NS`, `$K …` | „zapis na zewnątrz, cel nieznany” | ask |
| W tej samej komendzie zmiana kontekstu lub profilu: `kubectl config use-context X && …`, `export AWS_PROFILE=… && …`, `asp …` | „zapis na zewnątrz, cel nieznany” (A6) | ask |
| Skrypty z tmp: `bash $TMPDIR/x.sh`; `sh -c '…'` bez widocznego celu; `xargs kubectl`; `eval` | nie da się ocenić | ask — zachowana reguła „skrypty tmp” z `shell-style`, uogólniona |
| Skrypty projektu: `make deploy`, `./scripts/x.sh`, `npm run …` | lokalne | **allow** — zewnętrzne skutki takich skryptów to świadomie przyjęta cena celu z §2 „nowe narzędzie lokalne działa” |

### 4.2 Twarde zakazy (deny)

Zapisane jako `deny` w `opencode.json` (sprawdzane przed hookiem). Plugin dodatkowo egzekwuje je po ścieżce absolutnej.
Dotyczy odczytu narzędziem `read`, `edit` i `bash`.

| Zasób |
|---|
| `~/.ssh/id_*` (bez `.pub`) |
| `~/.local/share/opencode/auth.json` |
| keychain: `security *` |
| `gcloud … print-access-token\|print-identity-token` |
| `aws … get-secret-value\|get-session-token\|ecr get-login-password` |
| `ant auth print-credentials` |

**Zakres egzekucji pluginu (decyzja architekta, A7):**

| Narzędzie | Egzekucja |
|---|---|
| `shell` | Plugin odtwarza te zakazy **po rozpakowaniu** komendy (`timeout`, `env`, zmienne) i rozwiązuje ścieżki z argumentów best-effort (`cat $HOME/.ssh/id_x`, `cp`, `source .env`) |
| `read`, `edit`, `write` | Po ścieżce absolutnej |
| `grep`, `glob` | Narzędzia asertują tylko wzorzec, **nie ścieżkę** — nie da się ich bramkować po ścieżce. **Znane ograniczenie**, zamknie je dopiero piaskownica (§8) |

### 4.3 Nieodwracalne na infrastrukturze — zawsze ask

- Na celach prod / nieznanych także po zaznaczeniu „Always”: **plugin ignoruje zapisane zgody dla tej klasy**
  (zasada „Always” — niżej).
- Cel: patrz §4.6a (komunikat hooka nie jest pokazywany w oknie pytania; cel podaje agent w czacie).

**„Always” (decyzja architekta, A5).** Hook widzi tylko scalony `effect` (konfiguracja + zapisane zgody), więc
plugin decyduje per klasa:

| Klasa | Zapisane „Always” |
|---|---|
| Zapisy dev / home | **respektowane** |
| Zapisy prod / nieznane | **ignorowane** — ocena za każdym razem (zapisany allow pomijany → ask) |
| Nieodwracalne (ta sekcja) | **ignorowane** — ocena za każdym razem |
| Odczyty sekretów (§4.5) | **ignorowane** — ocena za każdym razem |

W oknie pytania „Always” nadal jest widoczne, ale dla klas „ignorowane” jest **nieskuteczne** (do udokumentowania
w `dev-guide.md`). Uzasadnienie dla §4.5: natywny `read` zapisuje zgodę jako `*`, co bez tej zasady odblokowałoby
wszystkie odczyty po jednym „Always”.

| Narzędzie | Operacje |
|---|---|
| kubectl | `delete namespace\|ns\|pv\|pvc\|crd`, `delete --all`, `delete -f/-k`, `drain`, `cordon`, `taint`; `delete` czegokolwiek w `flux-system`/`kube-system` (także na dev) |
| helm | `uninstall`, `delete` |
| flux | `uninstall`, `delete` |
| talosctl | `reset`, `upgrade`, `upgrade-k8s`, `apply-config`, `patch`, `edit`, `bootstrap`, `reboot`, `shutdown`, `wipe`, `etcd snapshot`, `remove-member`, `leave` |
| git | `push --force\|-f\|--delete\|-d\|--mirror\|+ref\|:ref` (poza `:refs/tags/test-*`); `git push` na `main`/`master` w repo innym niż własne (**decyzja architekta** — konstruktor ocenia, czy da się rozpoznać „własne” po remote; §7) |
| gh | `repo delete\|archive\|edit`, `repo deploy-key *`, `secret *`, `release delete` |
| AWS | `delete-*`, `terminate-*`, `deregister-*`, `disable-*`, `put-bucket-policy`, `s3 rm\|rb`, `s3 sync --delete`, `iam attach-*\|put-*\|create-access-key`, `ec2 authorize-security-group-*\|revoke-*`, `rds modify-db-instance\|delete`, `cloudformation delete-stack`, `eks delete-*` |
| Cloudflare | `wrangler delete\|rollback\|secret delete`, `cf * delete` |
| Jenkins | `jk job delete\|configure`, `jk cred *`, `jk node rm`, `jk plugin *` |
| rejestr | `crane delete` |

### 4.4 Własne granice (ask, każdą drogą)

Plugin wykrywa cel zapisu w powłoce (nie tylko narzędzia `edit`/`write`).

**Decyzja architekta (A4):** plugin sam decyduje o zapisach poza projektem (ta sekcja i §4.5), a nie natywne
pytanie `external_directory` — w `opencode.json` jawnie `"external_directory": {"*": "allow"}` (§4.8).

| Ścieżka |
|---|
| `~/.config/opencode/opencode.json*` |
| `~/.config/opencode/opencode.*.json` |
| `~/.config/opencode/agents/**` |
| `~/.config/opencode/secrets/**` |
| `~/.config/opencode/plugins/**` |
| `~/.config/opencode/scripts/check-skill-whitelists.sh` |
| dowolne `.opencode/**` |
| `~/.zsh/**` (**decyzja architekta:** tak — dotfiles ładują się do każdej powłoki agenta) |

### 4.5 Sekrety do odczytu — ask każdym narzędziem

Zapisane „Always” **ignorowane** (decyzja architekta, A5 — patrz §4.3). Zakres egzekucji (powłoka po
rozpakowaniu komendy, best-effort ścieżki; `grep`/`glob` bez bramkowania po ścieżce) — jak w §4.2
(decyzja architekta, A7).

| Zasób |
|---|
| `.env*` (poza `.env.example`) |
| katalog `secrets/` (o tej nazwie) |
| `*.pem`, `*.key`, `*.token` |
| `~/.kube/config` |
| `~/.aws/credentials` |
| `~/.config/gcloud/**` |
| `~/.claude.json` |
| `~/.gemini/**` |
| `~/.config/anthropic/**` |
| `~/.cf-turnstile-token` |
| `env` / `printenv` bez filtra |

### 4.6 Cel (decyzja użytkownika: kontekst kubectl albo profil awscli)

Plugin ustala cel komendy:

| Narzędzie | Skąd cel |
|---|---|
| kube | `--context` / `--kube-context`; `--kubeconfig` (ścieżka); inaczej bieżący kontekst z `~/.kube/config` (`current-context`). `KUBECONFIG` z env — tylko gdy literalny w komendzie. **Bez cache:** `current-context` z `~/.kube/config` oraz z pliku wskazanego `--kubeconfig` czytany od nowa przy każdej ocenie (tanie; decyzja architekta, A6) |
| AWS | `--profile`; inaczej `AWS_PROFILE` **tylko** z literalnego tekstu komendy albo z env serwera; inaczej `default` (decyzja architekta, A6) |
| Talos | `-n/--nodes`, `--context` |
| git | remote (URL `origin`) |
| Cloudflare / Jenkins / Stitch | zawsze „zewnętrzne, prod” |

**Zmiana celu w tej samej komendzie (decyzja architekta, A6):** komenda, która w tym samym wywołaniu przełącza
kontekst lub profil (`kubectl config use-context`, `export AWS_PROFILE`, `asp`), ma cel **nieznany** →
ask (jak w §4.1 „Nierozpoznawalne”, A2).

**Klasa celu** (konfigurowalne wzorce w `permission-model.json`; decyzja architekta, A8 — jeden plik
konfiguracyjny `permission-model.json` + `permission-model.local.json`, bez `agent-guard.json`):

| Klasa | Kryterium | Wartości startowe |
|---|---|---|
| `dev` | `kind-*`; kubeconfig w tmp; nazwy pasujące do `dev: [...]` | `dev: ["kind-*", "*-dev", "*-test", "*-sandbox"]` |
| `prod` | pasujące do `prod: [...]` **oraz wszystko nierozpoznane** (bezpieczny domyślny) | `prod: ["*-prod", "*-prd", "*-production"]` |
| `home` | domowy `admin@k8s` — osobna klasa: zapisy odwracalne allow wg §3.1, nieodwracalne ask | `home: ["admin@k8s"]` |

- Wartości startowe **do potwierdzenia przez użytkownika** razem z tabelą oczekiwanych decyzji (§6 krok 0).
- Profile służbowe (AWS/EKS) dopisuje się w `permission-model.local.json` na maszynie służbowej; wszystko
  spoza list → `prod`.
- **Bez numeru konta AWS w v1** (decyzja architekta, A6): brak wywołań `sts`; w komunikatach tylko nazwy
  kontekstu / profilu.

### 4.6a Jak użytkownik widzi cel — decyzja użytkownika: ask (2026-10-23; ustalenie A1 — decyzja architekta)

**Ustalenie (zweryfikowane w źródłach OpenCode):** okno pytania o uprawnienie w obu klientach (TUI:
`routes/session/permission.tsx`; desktop: `session/requests/*`) pokazuje wyłącznie akcję, zasoby i wejście
narzędzia. `message` z hooka **nie jest renderowany użytkownikowi** — trafia tylko do modelu (jako powód
odmowy) i do powiadomienia systemowego. `ctx.permission.assert` (tylko 2.0.30) nie ma pola `message` i
ponownie wywołuje hook. **Wniosek:** plugin nie może wstawić celu do treści okna pytania.

**Decyzja użytkownika: ask.** Zapisy prod / nieznane oraz klasa §4.3 → zwykłe natywne pytanie (`effect="ask"`).
Natywne okno pytania jest tym, co użytkownik zatwierdza. Nie ma przełącznika w konfiguracji ani trybu
`deny` z wyjaśnieniem.

| Element | Ustalenie |
|---|---|
| `message` pluginu | Zawiera cel: narzędzie, czasownik, kontekst/profil, klasa. Trafia **tylko do agenta** (i do powiadomienia systemowego), nie do okna pytania |
| Cel dla użytkownika | Agent podaje go w jednej linii w czacie tuż przed komendą — reguła w `docs/global-rules.md` (poniżej); w oknie pytania pojawia się tuż pod tą linią |
| Reguła dla agentów (`docs/global-rules.md`, **do wykonania w kroku 3 wdrożenia, §6**) | „Przed każdym zapisem na cel prod/nieznany (klaster, AWS, GitHub, Cloudflare, Jenkins, Talos) podaj w jednej linii w czacie cel (kontekst/profil/węzeł/repo), a potem uruchom komendę — okno pytania go nie pokazuje.” |

- Brak wymogu odpowiedzi „tak” w czacie: zatwierdzenie to natywne pytanie, więc nie ma problemu ponawiania
  zablokowanej komendy.
- Reguła w `global-rules.md` to tekst dla agenta (bramka miękka); twardą bramką pozostaje samo `ask` pluginu.

### 4.7 Role agentów (zostają jak dziś)

| Agent(-i) | Ograniczenie |
|---|---|
| `autopilot` | powłoka tylko do odczytu (§4.7a); edit tylko `docs/superpowers/**`; zakaz delegowania do siebie |
| `architect`, `plan`, `webscraper`, `webresearcher`, `webmonitor`, `jira`, `stitch-mcp` | powłoka tylko do odczytu (§4.7a) |
| `jenkins`, `ha`, `webdebugger`, `web*` | `edit: false` |
| wszyscy | reguły `task`/`subagent` bez zmian; skille per agent (`permission.skill`) bez zmian |

### 4.7a Powłoka tylko do odczytu dla agentów ograniczonych (poprawka 2026-10-25)

**Problem.** Agenci z §4.7 (`restrictedAgents`) mają dziś blok wzorców
`{"*": deny, echo/ls/test/[/head/cat/printf/mkdir: allow, "*>*": deny}`, a plugin ich tylko przepuszcza
(`passthrough`). To ten sam ogon wzorców, który §1.2 usuwa dla pozostałych agentów. Przypadek z 2026-10-25
(architekt): odrzucone zostało `grep -v '^#' .git/packed-refs` (`grep` nie jest na liście) oraz
`ls x 2>/dev/null` (`*>*` łapie każde przekierowanie). Wzorce nie odróżniają `2>/dev/null` od
`> plik`, a wyjątek `"* 2>/dev/null": allow` przepuściłby `cat secrets/x > docs/leak.md 2>/dev/null`.
Do tego deny z konfiguracji działa przed hookiem, więc shadow **nie widzi** odmów u tych agentów.

**Dlaczego nie wystarczy „restricted = tylko `local-read`”.** Sprawdzone 2026-10-25 na `decideShell`
(DEFAULTS, agent `coder`): klasa `local-read` znaczy „nie dotyka świata zewnętrznego”, a nie „nie
zapisuje”. Jako `local-read` klasyfikowane są m.in.: `find . -delete`, `find … -exec rm {} +`,
`python3 -c "open('f','w').write('x')"`, `node -e "require('fs').writeFileSync(…)"`,
`awk '{print > "out"}'`, `sort -o out f`, `perl -e 'unlink …'`. Dla zwykłych agentów to bez znaczenia
(lokalny zapis i tak jest `allow`), ale dla profilu tylko do odczytu byłaby to dziura.

**Reguła.** Dla agenta z `restrictedAgents` plugin **sam decyduje** (już nie `passthrough`), według
profilu `restrictedShell` w `permission-model.json`:

| Warunek (każde wywołanie po rozpakowaniu, także w potoku, `&&`, `$(…)`, `xargs`) | Efekt |
|---|---|
| klasa `secret-deny` | deny (jak wszędzie, §4.2) |
| klasa `secret-ask` (np. `cat .env`) | ask (jak wszędzie, §4.5) |
| narzędzie spoza `restrictedShell.tools`, czasownik `git` spoza `restrictedShell.git`, argument z `restrictedShell.denyArgs[tool]` | **deny** + `message`: `permission-model: {agent} ma powłokę tylko do odczytu — {tool} {verb} poza profilem; użyj narzędzi read/grep/glob albo deleguj` |
| przekierowanie zapisu (`>`, `>>`, `>|`, `&>`) na cel inny niż `/dev/null` lub deskryptor (`2>&1`, `>&2`) | **deny** (ten sam `message`) |
| wszystko inne (narzędzie z profilu, bez zakazanych argumentów, przekierowania tylko na `/dev/null`/deskryptor) | allow |

Wartości startowe `restrictedShell` (lista **narzędzi**, ~40 pozycji — nie wzorców komend; przekierowania
ocenia parser, więc lista nie rośnie o warianty zapisu):

- `tools`: `cat head tail ls tree wc grep egrep fgrep rg echo printf test [ true false pwd stat file du df
  diff cmp sort uniq cut tr column nl basename dirname realpath readlink which date jq yq find git`
- `git` (czasowniki): `status log show diff branch tag rev-parse ls-files ls-tree cat-file blame describe
  shortlog reflog remote worktree stash config`; z zakazanymi argumentami niżej
- `denyArgs`: `find: -delete -exec* -execdir* -ok* -okdir* -fprint* -fls`; `sort: -o* --output*`;
  `yq: -i* --inplace*`; `tree: -o*`; `rg: --pre*`; `date: -s* --set*`;
  `git branch: -d* -D* -m* -M* -c* -C* -f* --delete* --move* --copy* --force* --set-upstream* -u*`;
  `git tag: -d* -a* -s* -f* -m* --delete*`, a `git tag <nazwa>` bez `-l`/`--list` = deny;
  `git remote: add remove rm rename set-* prune update`; `git worktree: add remove prune move lock unlock repair`;
  `git stash: push pop apply drop clear store create branch save` (zostaje `list`, `show`);
  `git config`: tylko `--get*`, `--list`, `-l` (reszta = deny)
- Celowo **poza** profilem: `sed`, `awk`, `perl`, `python*`, `node`, `bun`, `sh/bash/zsh`, `xargs` jako
  narzędzie docelowe spoza listy, `make`, menedżery pakietów, `mkdir` (narzędzie `write` samo tworzy
  katalogi), wszystkie zewnętrzne CLI (`kubectl`, `curl`, `gh`…) — tak jak dziś.

**Konfiguracja (`opencode.json`) dla tych agentów.** Zamiast dzisiejszego bloku:
`bash: {"*": "ask", …ta sama lista deny co globalnie (§4.2)…}`. Uzasadnienie:

- `ask`, nie `deny`, bo plugin nigdy nie łagodzi deny (§5.3) — przy `deny` nie dostałby szansy;
- `ask`, nie `allow`, bo jeśli plugin się nie załaduje, użytkownik **widzi pytanie**, a nie cichy
  `allow` (fail-safe, jak znacznik `alive` z Task 10 Step 0);
- lista deny powtórzona w bloku agenta, bo reguły agenta są doklejane po globalnych (ostatnie
  dopasowanie wygrywa) i samo `"*": "ask"` nadpisałoby globalne deny;
- w `enforce` plugin zamienia `ask` na `allow`/`deny` według tabeli wyżej. Błąd lub timeout pluginu
  u agenta ograniczonego → zostaje `ask` z konfiguracji (nigdy `allow`).

Tę zmianę włącza się dopiero razem z `enforce` (Task 10). W `shadow` `"*": "ask"` pytałoby o każdą komendę.

**Prompty.** `agents/architect.md`, `agents/autopilot.md`, prompt `plan` w `opencode.json`, `AGENTS.md`:
zamiast listy komend jedno zdanie: „Powłoka tylko do odczytu: narzędzia odczytu (cat, ls, grep, rg, git
log/diff/show…), przekierowania tylko do `/dev/null`; zapis, skrypty i zewnętrzne CLI są odrzucane —
deleguj.”

**Wnioski z przeglądu skilli:**

- `autonomous-execution` zakłada powyższe ograniczenia.
- Bramki skilli to tylko tekst, a w subagencie odpowiada koordynator — dlatego hamulce z §4.3 muszą działać
  **niezależnie od skilli**.
- Do `autonomous-execution` → Hard Stops dopisać: merge do main, PR, deploy (wrangler/cf), zapisy Jenkins,
  wysyłka maili/Stitch, `ant apply` (**decyzja architekta**). Edycja lokalnego skilla
  `skill/autonomous-execution/SKILL.md`.

### 4.8 Co znika

| Element | Los |
|---|---|
| Ponad 1000 reguł `bash` w `opencode.json` | **Usunięte.** Zostają: twarde zakazy (§4.2), hamulce lokalne (§3 wiersz „Lokalnie”) w formie prostych wzorców, role (§4.7), jawne `"external_directory": {"*": "allow"}` (patrz niżej) |
| `external_directory` (**decyzja architekta, A4**) | Zachowanie dzisiejszego efektywnego działania: w `opencode.json` jawnie `"external_directory": {"*": "allow"}` globalnie. Zainstalowane v2.0.22 ma domyślnie ask, 2.0.30 — allow; jawna reguła ujednolica. Decyzje o zapisach poza projektem podejmuje plugin (§4.4, §4.5), nie natywne pytanie |
| Plugin `shell-style` | **Usunięty.** Jego 5 reguł (funkcje / zmienne / skrypty tmp / jsonpath / zapis przez heredoc) znika. Zapis tekstu przez heredoc poza projektem/tmp pozostaje jako **ask** w nowym pluginie, bo to „własne granice” / „poza projektem” |
| Sekcja „Shell Command Style” w `docs/global-rules.md` | **Skrócona.** Zostaje: pliki przez write/edit (hygiena diffu); brak ad-hoc skryptów w tmp (czytelność); `$TMPDIR` nie `/tmp`; jedna prosta komenda na wywołanie; `git push` wolno / force pyta; „Permission denied” = reguła, nie brak shella. Usunięte, bo plugin nie zależy od tekstu komendy: kolejność flag, `$K`, `timeout`, apostrofy, narzędzia po nazwie, aliasy `$T` |

## 5. Architektura

Plugin **`permission-model`** (nowy, zastępuje `shell-style`). Dependency-free JS w `plugins/`, jak dziś.
Rozwijany na kopii w tmp, bo zapis w `plugins/*` przeładowuje serwer.

### 5.1 Hooki

| Hook | Zakres |
|---|---|
| `tool.execute.before` | Pełna komenda + workdir; korelacja po `event.id` = `source.id` |
| `permission.evaluate` | Tylko `action === "shell"` oraz `read`/`edit` dla §4.2 / §4.4 / §4.5 — po ścieżce absolutnej |

### 5.2 Komponenty

| Komponent | Odpowiedzialność |
|---|---|
| Parser | tree-sitter-bash jak w v2 — konstruktor decyduje: własny lekki parser jak w `shell-style` czy wasm (§7) |
| Unwrapper | `env X=`, `timeout`, `time`, śledzenie `cd`, `$(…)`; heredoc = dane |
| Classifier | czasownik + cel → klasa: `local-read` / `local-write` / `ext-read` / `ext-write` / `irreversible` / `secret` / `own-config` |
| Target resolver | §4.6; **bez cache** (czytanie `current-context` przy każdej ocenie), bez wywołań sieciowych/`sts` |
| Decision | tabela §3 → allow / ask / deny + `message` po polsku z celem (narzędzie, czasownik, kontekst/profil, klasa) — widoczny tylko dla agenta, nie w oknie pytania (§4.6a); zapisy prod i klasa §4.3 → zawsze `ask` |
| Fail-safe | Błąd pluginu → **ask** z komunikatem (nie allow — inaczej niż `shell-style`, bo tu plugin jest główną linią obrony) |
| Decision log | JSONL: `~/.local/share/opencode/permission-model/decisions.jsonl`; bez treści heredoców i sekretów |
| Tryb | `shadow` / `enforce` w `~/.config/opencode/permission-model.json` (+ `permission-model.local.json` gitignored per maszyna, np. lista profili prod/dev w pracy) |

### 5.3 Zasady działania

- Plugin **nigdy nie łagodzi** `deny` z konfiguracji. Dla agentów ograniczonych plugin decyduje według
  profilu `restrictedShell` (§4.7a), a nie w trybie `passthrough`. Konfiguracja daje im `"*": "ask"`,
  żeby plugin w ogóle był pytany.
- Zapisane zgody „Always” wg klas — §4.3 (decyzja architekta, A5): dev/home respektowane; prod, §4.3 i
  odczyty sekretów §4.5 ignorowane (ustawia `ask`/`deny` mimo przychodzącego `allow`).
- Pytanie idzie przez `effect="ask"` (+ `message`). `ctx.permission.assert` (tylko 2.0.30) **nie** ma pola
  `message` i ponownie wywołuje hook, więc nie pomaga w pokazaniu celu (decyzja architekta, A1 — §4.6a).
  Komunikat hooka nie jest renderowany w oknie pytania.
- Pliki konfiguracji: `permission-model.json` + `permission-model.local.json` (A8, §4.6).

## 6. Wdrożenie

| # | Krok | Kryterium przejścia |
|---|---|---|
| 0 | **Korpus:** `permaudit` (930 pytań, `$TMPDIR/opencode/permaudit/`) + komendy z tej rozmowy (talosctl, syft, ansible, kind, helm package, git clone…) jako fixtures; tabela oczekiwanych decyzji (konstruktor proponuje, użytkownik zatwierdza), wraz z wartościami startowymi list `home`/`dev`/`prod` (§4.6) | korpus w repo; tabela gotowa do przeglądu |
| 1 | Plugin w `shadow` **na wierzchu dzisiejszego `opencode.json`** — stare reguły nadal egzekwują, więc nie ma luki w ochronie (decyzja architekta, A3). Shadow loguje, co plugin BY zdecydował vs co zrobiła konfiguracja. Replay korpusu na funkcji decyzyjnej pluginu | lokalne = 0 pytań; odczyty = 0; zapisy prod/nieznane = ask; §4.3 = ask; §4.2 = deny |
| 2 | `shadow` kilka dni w realnych sesjach; przegląd logu (plugin vs konfiguracja). Dopiero po przeglądzie: przełączenie na slim `opencode.json` i plugin `enforce` w **jednym commicie** (łatwy do cofnięcia) | użytkownik zatwierdził tabelę i przegląd logu |
| 3 | Usunięcie `shell-style`; skrócenie `global-rules.md` **oraz dopisanie reguły „cel w jednej linii przed zapisem na prod/nieznany” (§4.6a)**; aktualizacja `AGENTS.md` i `dev-guide.md`; Hard Stops w `autonomous-execution` (§4.7) | brak odwołań do `shell-style`; reguła z §4.6a obecna w `global-rules.md`; `bash scripts/check-skill-whitelists.sh` bez `[FAIL]` |
| 4 | **Smoke** (niżej) | wszystkie przypadki zgodnie z oczekiwaniem |

**Smoke (krok 4):**

| Scenariusz | Oczekiwanie |
|---|---|
| Typowe zadania domowe: homebudget (flux/helm/kubectl na `admin@k8s`), kind e2e, cargo, DisplayKVM busted/luacheck, talosctl usage | bez pytań |
| `kubectl delete ns flux-system` | ask (agent podaje cel w jednej linii w czacie przed komendą — §4.6a) |
| `kubectl delete $KIND $NS`; `kubectl config use-context X && kubectl apply …`; `bash $TMPDIR/x.sh` | ask (§4.1 „Nierozpoznawalne”) |
| `make deploy`, `./scripts/x.sh`, `npm run …` | bez pytań (lokalne) |
| `cat $HOME/.ssh/id_x` (także przez `timeout`/`env`) | deny (§4.2) |
| `aws s3 rm --recursive` z profilem nieznanym | ask |
| `.venv/bin/ansible-lint`, `syft`, nowe CLI lokalne | bez pytań |

## 7. Pozostawione konstruktorowi

- parser (własny lekki vs tree-sitter-bash/wasm);
- lista czasowników odczytu per CLI (startowa — z tego dokumentu i z dzisiejszego `opencode.json`);
- format logu decyzji;
- czy `ctx.permission.assert` jest dostępne w zainstalowanej wersji;
- rozpoznanie „własnego” remote (§4.3);
- format `permission-model.json` (w tym listy `home`/`dev`/`prod`).

Rozstrzygnięte (nie do ponownej decyzji): brak cache celu i brak numeru konta AWS w v1 (A6, §4.6).

## 8. Poza zakresem, na później

| Pozycja | Szczegół |
|---|---|
| Piaskownica macOS | `sandbox-exec` przez launcher — projekt w `2026-10-19-agent-guard-design.md` §4.4 |
| Poprawki skilli superpowers | `cd`/`git -C` między wywołaniami → `workdir`; `/tmp` → `$TMPDIR`; jawny model przy dispatch (osobne poprawki w forku) |
| `.superpowers/` | dodać do gitignore |
| `cloudflare-email-service` | bez bramki — zgłosić upstream lub lokalna nakładka |

## 9. Decyzje architekta do przejrzenia przez użytkownika

| # | Sekcja | Decyzja |
|---|---|---|
| 1 | §4.1 | Klasyfikacja po czasowniku/podkomendzie (plugin), nie po narzędziu i wzorcach tekstu |
| 2 | §4.3 | `git push` na `main`/`master` w repo innym niż własne → ask; konstruktor ocenia, czy „własne” da się rozpoznać po remote |
| 3 | §4.4 | `~/.zsh/**` wśród własnych granic (ask) — dotfiles ładują się do każdej powłoki agenta |
| 4 | §4.7 | Do Hard Stops w `autonomous-execution` dopisać: merge do main, PR, deploy (wrangler/cf), zapisy Jenkins, wysyłka maili/Stitch, `ant apply` (edycja lokalnego `skill/autonomous-execution/SKILL.md`) |
| 5 | §4.6a, §5 (A1) | Komunikat hooka nie jest pokazywany w oknie pytania (TUI i desktop); `ctx.permission.assert` nie ma `message` i wywołuje hook ponownie. Cel nie może trafić do okna. **Decyzja użytkownika (2026-10-23): ask** — zapisy prod/nieznane i §4.3 → zwykłe natywne pytanie; `message` pluginu (narzędzie, czasownik, kontekst/profil, klasa) idzie tylko do agenta; w `docs/global-rules.md` (krok 3 wdrożenia) reguła: przed zapisem na prod/nieznany agent podaje cel w jednej linii w czacie, potem uruchamia komendę. Bez przełącznika `prodWrites` |
| 6 | §4.1 (A2) | „Nierozpoznawalne”: znane zewnętrzne CLI ze zmienną/podstawieniem/nieznanym czasownikiem, kontekstem lub celem, zmiana kontekstu/profilu w tej samej komendzie → „zapis na zewnątrz, cel nieznany” = ask. Skrypty tmp, `sh -c` bez widocznego celu, `xargs kubectl`, `eval` → ask (uogólniona reguła `shell-style`). Skrypty projektu (`make deploy`, `./scripts/x.sh`, `npm run …`) → allow, zewnętrzne skutki to przyjęta cena celu z §2 |
| 7 | §6 (A3) | Brak luki w ochronie: krok 1 uruchamia plugin w `shadow` **na wierzchu dzisiejszego** `opencode.json` (stare reguły nadal egzekwują); dopiero po przeglądzie shadow (krok 2) w **jednym commicie** slim config + `enforce`. Shadow loguje, co plugin BY zdecydował vs co zrobiła konfiguracja |
| 8 | §4.4, §4.8 (A4) | Jawne `"external_directory": {"*": "allow"}` globalnie (zainstalowane v2.0.22: ask, 2.0.30: allow); o zapisach poza projektem decyduje plugin, nie natywne pytanie |
| 9 | §4.3, §4.5 (A5) | „Always” wg klas (hook widzi tylko scalony `effect`): zapisy dev/home — respektowane; zapisy prod i §4.3 — ocena za każdym razem; odczyty sekretów §4.5 — ocena za każdym razem (natywny `read` zapisuje `*`). „Always” jest widoczne w oknie, ale dla tych klas nieskuteczne — udokumentować |
| 10 | §4.6 (A6) | Cel bez cache: `current-context` z `~/.kube/config` i z pliku `--kubeconfig` czytany od nowa przy każdej ocenie; `AWS_PROFILE` tylko z literalnej komendy lub env serwera; zmiana kontekstu/profilu w tej samej komendzie → cel nieznany → ask; brak numeru konta AWS w v1 (bez `sts`), w komunikatach tylko nazwy kontekstu/profilu |
| 11 | §4.2, §4.5 (A7) | Plugin odtwarza zakazy §4.2 po rozpakowaniu komendy (`timeout`, `env`, zmienne) i rozwiązuje ścieżki z argumentów best-effort (`cat $HOME/.ssh/id_x`, `cp`, `source .env`). `grep`/`glob` asertują tylko wzorzec, nie ścieżkę — udokumentowane ograniczenie, zamknie je piaskownica (§8) |
| 12 | §4.6, §5 (A8) | Jedna nazwa pliku konfiguracji: `permission-model.json` + `permission-model.local.json` (bez `agent-guard.json`). Wartości startowe (do potwierdzenia z tabelą oczekiwanych decyzji, §6 krok 0): `home: ["admin@k8s"]`, `dev: ["kind-*", "*-dev", "*-test", "*-sandbox"]`, `prod: ["*-prod", "*-prd", "*-production"]`, reszta → prod; profile służbowe w `permission-model.local.json` |

| 13 | §4.7, §4.7a (poprawka 2026-10-25) | Agenci ograniczeni: plugin decyduje według profilu narzędzi tylko do odczytu (`restrictedShell`), przekierowania ocenia parser (`/dev/null` i deskryptory dozwolone), reszta deny. W konfiguracji `"*": "ask"` + powtórzone deny §4.2 zamiast bloku wzorców `*>*`. Powód: `local-read` ≠ „bez zapisu” (`find -delete`, `python -c`, `sort -o`…), więc sama klasa nie wystarcza |

Dla porządku — **decyzje użytkownika** użyte w tym dokumencie:

| Sekcja | Decyzja |
|---|---|
| §3 | Model trzech obszarów („brzmi jak przedłużenie mojej ręki”) |
| §3.1 | Allow dla odwracalnych zapisów na `admin@k8s` i w repo użytkownika (lista w §3.1) |
| §4.6 | Cel = kontekst kubectl albo profil awscli |
| §4.6a | Zapisy prod/nieznane i §4.3 → natywne `ask` (2026-10-23); cel podaje agent w jednej linii w czacie, bez przełącznika `prodWrites` |
