# Migracja służbowego MacBooka na OpenCode v2 — plan wykonania

> Status 2026-10-28: done — migration accepted; v2_start 2026-10-28T12:21:37Z; backup ~/opencode-migration-2026-10-28 (keep ≥14 days); gate 2 permission-model after ≥3 days.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Służbowy MacBook działa na OpenCode v2 2.2.0 z tym repo 1:1 (różnice tylko w warstwach per-maszynowych), z historią sesji v1, nienaruszoną mnemoteca i jednokomendowym powrotem do v1.

**Architecture:** Slot v1 zachowany w całości (`mv` konfiguracji, klony APFS danych, przypięty keg + kopia binarki), slot v2 = świeży klon repo + nowa warstwa maszyny. Wszystko wykonywane z prywatnej maszyny przez ssh; bramki [U] wykonuje użytkownik.

**Tech Stack:** zsh, Homebrew (`anomalyco/tap`, `gandazgul/tap`), git, python3 `sqlite3` (tylko `mode=ro` do odczytów), node/npm, OpenCode v2 2.2.0, mnemoteca 0.3.4.

**Spec:** `docs/superpowers/specs/2026-10-27-work-macbook-v2-migration-design.md` (sekcje §N poniżej odnoszą się do niego).

## Global Constraints

- Dostęp: `ssh -A gdziegielewski@10.1.1.10 'zsh -lic "<cmd>"'`; jedna komenda na wywołanie; styl powłoki wg `docs/global-rules.md` (bez zmiennych jako słów komendy, bez funkcji, bez ad-hoc skryptów poza `rollback.sh` z Task 1).
- Wersje docelowe: `opencode-v2` **2.2.0**, mnemoteca **0.3.4** (bez zmian na służbowej). Inna wersja formuły `opencode-v2` w dniu migracji → STOP, [U].
- Na służbowej **nigdy** `brew reinstall`/`install` mnemoteca (formuła błędnie cofnięta do 0.3.3).
- Backup: `~/opencode-migration-<YYYY-MM-DD>/` (data wykonania Task 3), klony `cp -c`; nigdy `$TMPDIR` na służbowej.
- Odczyty `opencode.db`: wyłącznie `python3 -c` z `sqlite3.connect('file:<abs>?mode=ro', uri=True)`; nigdy CLI `sqlite3`.
- Sekrety: nigdy w raportach, logach agentów ani w gicie. Wyniki `opencode debug config`/`debug agents` mogą zawierać rozwiązane sekrety — zapisywać do pliku, raportować tylko diff po maskowaniu (Task 4).
- Nic nie jest commitowane ze służbowej; zmiany repo tylko z prywatnej (`@devops`).
- `opencode -s <id>` zabronione na służbowej do zaliczenia Task 5 Step 2.
- Remote repo na służbowej: `ssh://git@ssh.github.com:443/jabbas/opencode-config.git`.
- Reviewer: `kilo/moonshotai/kimi-k3.1-pro`; brak ID w katalogu → STOP, [U].
- `novomatic`: SDK openai-compatible, `baseURL` `http://llm.ai.novomatic-tech.com/03/v1`, model `default` „Qwen3.6-27B”, tool calling, context 131072, output 4096, env `NOVOMATIC_API_KEY` dopuszczony.

## Review Focus

1. **`-s` przed końcem importu sesji** → pusta sesja i utracona historia. Test: Task 5 Step 2 jest bramką i — zanim cokolwiek dopuści `-s` — sprawdza, że żadne ID z v1 `session` nie ma w `session_v2` wersji 2.x (kolizja = sesja utworzona przez v2 zamiast zaimportowanej).
2. **Proces `opencode` żyjący w trakcie kopii** (usługa `serve --service` ma ppid 1 i przeżywa zamknięcie TUI) → niespójna kopia bazy. Test: Task 3 Step 1 `pgrep -x opencode` pusty bezpośrednio przed `cp`, Step 4 `quick_check` + liczniki kopii = oryginał.
3. **Sekrety w porównaniu parzystości** → wyciek do transkryptu. Test: Task 4 Step 9 maskuje i wypisuje tylko liczby różnic + ścieżki kluczy.
4. **`XDG_CONFIG_HOME="${HOME}/.config/"`** (końcowy `/`) → inna ścieżka globalnego configu. Test: Task 4 Step 9 — `opencode debug paths` na służbowej pokazuje config `…/.config/opencode` (bez `//` w znormalizowanej ścieżce) i `debug config` listuje `opencode.json` + `opencode.jsonc` z tego katalogu.
5. **Utrata kegu v1** (brew cleanup po instalacji v2) → rollback bez binarki. Test: Task 3 Step 6 `brew list --pinned` zawiera `opencode`, `bin-v1/bin/opencode --version` = 1.18.35; Task 1 test `--dry-run` dla wariantu „brak kegu”.

---

### Task 1: Artefakty migracji (na prywatnej, bez zmian na służbowej)

**Files (scratch, nie repo):**
- Create: `$TMPDIR/opencode/work-migration/opencode.kilocode.json`
- Create: `$TMPDIR/opencode/work-migration/rollback.sh`
- Create: `$TMPDIR/opencode/work-migration/README.md`
- Źródła: `$TMPDIR/opencode/work-models.json` (katalog modeli ze służbowej), stary `opencode.kilocode.json` (odczyt przez ssh: `cat ~/.config/opencode/opencode.kilocode.json`), `secrets/README.md` (blok grafana), `~/Projects/opencode/packages/schema/src/config/provider.ts` + `packages/core/src/v1/config/migrate.ts`

**Interfaces:**
- Produces: `rollback.sh [--dry-run]` — uruchamiany na służbowej z katalogu backupu; argumenty: tylko `--dry-run`; exit 0 = sukces, ≠0 = zatrzymanie z komunikatem; ścieżkę backupu bierze z własnej lokalizacji (`dirname "$0"`), nie z argumentu.
- Produces: `opencode.kilocode.json` gotowy do skopiowania 1:1 (Task 4).

- [x] **Step 1: Ustal format `novomatic` dla v2 2.2.0.** Przeczytaj schemat providera w źródłach v2 (checkout `~/Projects/opencode` jest na 2.0.31 — `git fetch --tags` i porównaj `packages/schema/src/config/provider.ts` z tagiem `v2.2.0`, jeśli istnieje) oraz `migrate.ts:111-133`. Wybierz zapis spełniający Global Constraints (`novomatic`); zapisz krótkie uzasadnienie w `README.md`.
- [x] **Step 2: Potwierdź ID reviewera.** `python3 -c` na `$TMPDIR/opencode/work-models.json`: istnieje model `moonshotai/kimi-k3.1-pro` pod providerem `kilo`. Brak → STOP, [U].
- [x] **Step 3: Złóż `opencode.kilocode.json`:** `$schema`, `model`, `small_model` i 17 nadpisań agentów skopiowane bez zmian ze starego pliku; `agent.reviewer.model = "kilo/moonshotai/kimi-k3.1-pro"`; provider `novomatic` (Step 1); `mcp.grafana-dev|test|stage|prod` z `secrets/README.md` (tokeny `{file:~/.config/mcp-secrets/grafana-<env>.token}`). Walidacja: `node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' <plik>` → bez błędu; `grep -c '"anthropic/' <plik>` → 0.
- [x] **Step 4: Napisz test `--dry-run` rollbacku** jako oczekiwany wydruk w `README.md` (sekcja „Expected dry-run”): kolejno — stop usługi v2, `pgrep -x opencode` pusty, (warunkowo) przywrócenie kegu z `bin-v1/`, `brew unlink opencode-v2`, `brew link opencode`, `mv ~/.config/opencode ~/.config/opencode.v2-<ts>`, `mv ~/.config/opencode.v1 ~/.config/opencode`, `mv ~/.local/share/opencode ~/.local/share/opencode.v2-<ts>`, `cp -c -R <bak>/share ~/.local/share/opencode`, to samo dla `state` (`~/.local/state/opencode`) i `cache` (`~/.cache/opencode`), `cp -c -R <bak>/dot-opencode ~/.opencode`, komunikat o ewentualnym `opencode auth login`, instrukcja powrotu do v2.
- [x] **Step 5: Zaimplementuj `rollback.sh`** zgodnie z §7 spec i Step 4: `set -euo pipefail`; każdy krok sprawdza warunek wstępny (np. istnieje `~/.config/opencode.v1`, nie istnieje cel `mv`) i jest pomijany z komunikatem, jeśli już wykonany (idempotencja); w `--dry-run` tylko wypisuje komendy; nigdy nie kopiuje sekretów z v2; nie dotyka `~/.local/share/mnemoteca`.
- [x] **Step 6: Weryfikacja statyczna:** `bash -n rollback.sh` → OK; `shellcheck rollback.sh` → 0 ostrzeżeń (jeśli shellcheck jest dostępny; inaczej zanotuj).
- [x] **Step 7: Test w piaskownicy (prywatna):** utwórz `$TMPDIR/opencode/rb-sandbox/` z pustą strukturą backupu (`share/`, `state/`, `cache/`, `dot-opencode/`, `bin-v1/`) i skopiuj tam `rollback.sh`; uruchom `bash $TMPDIR/opencode/rb-sandbox/rollback.sh --dry-run` → wydruk zgodny z „Expected dry-run” (ścieżki backupu = katalog piaskownicy). Drugi przebieg z usuniętym `bin-v1/` → skrypt kończy się ≠0 z komunikatem o braku kegu i kopii, gdy keg 1.18.35 nie istnieje.
- [x] **Step 8: Przekaż artefakty do review** (bez commitu — pliki nie należą do repo).

### Task 2: Skan nadpisań projektowych na służbowej (F0.3, tylko odczyt)

**Files:** Create: `$TMPDIR/opencode/work-migration/project-overrides.md`

- [x] **Step 1:** Przez ssh: `find ~ -maxdepth 4 \( -name .opencode -o -name opencode.json -o -name opencode.jsonc -o -name .agents \) -not -path '*/node_modules/*' -not -path '*/Library/*' -not -path '*/.config/opencode/*' 2>/dev/null` oraz `find ~/Projects -maxdepth 4 -path '*/.claude/skills' 2>/dev/null`.
- [x] **Step 2:** Dla każdego trafienia: ścieżka, czy zawiera `permission`/`agent`/`plugin`/`instructions` (grep kluczy, bez wartości), rozmiar. Zapisz tabelę w `project-overrides.md`.
- [x] **Step 3:** [U] Użytkownik decyduje per wpis: zostaje / do backupu. Bez decyzji → nic nie zmieniać. Oczekiwany co najmniej wpis `~/.opencode` (przeniesiony w Task 3).

### Task 3: Okno serwisowe i backup (F1, F2)

**Files (służbowa):** Create: `~/opencode-migration-<YYYY-MM-DD>/{share,state,cache,dot-opencode,mnemoteca,bin-v1}/`, `manifest.md`, `rollback.sh`, `README.md`; Move: `~/.config/opencode` → `~/.config/opencode.v1`, `~/.opencode` → `dot-opencode/`

**Interfaces:**
- Consumes: `rollback.sh`, `README.md` z Task 1.
- Produces: `manifest.md` z polami: `date`, `opencode_v1_version`, `v1_counts: {session, message, part}`, `opencode_db_sha256`, `mnemoteca_stats` (JSON), `backup_root`.

- [x] **Step 1:** [U] Użytkownik zamyka wszystkie sesje OpenCode na służbowej. Sprawdź `pgrep -x opencode` → pusto (jeśli nie: lista PID + komendy dla użytkownika; nie zabijać).
- [x] **Step 2:** `mkdir -p ~/opencode-migration-<data>/mnemoteca`; `mnemoteca stats --format json` → do manifestu; `cp ~/.local/share/mnemoteca/mnemoteca.db ~/.config/mnemoteca/config.yaml ~/opencode-migration-<data>/mnemoteca/`.
- [x] **Step 3:** `cp -c -R ~/.local/share/opencode ~/opencode-migration-<data>/share`; analogicznie `~/.local/state/opencode` → `state`, `~/.cache/opencode` → `cache`. Bezpośrednio przed pierwszym `cp` ponownie `pgrep -x opencode` → pusto.
- [x] **Step 4:** Weryfikacja kopii: python3 ro na `share/opencode.db`: `PRAGMA quick_check` = `ok`; `count(*)` z `session`, `message`, `part` = te same liczby na oryginale. `shasum -a 256` obu plików `opencode.db` równe. Wyniki → manifest.
- [x] **Step 5:** `mv ~/.opencode ~/opencode-migration-<data>/dot-opencode`; `mv ~/.config/opencode ~/.config/opencode.v1`. Sprawdź: `test ! -e ~/.config/opencode`, `test -d ~/.config/opencode.v1/.git`.
- [x] **Step 6:** `brew pin opencode`; `cp -c -R /opt/homebrew/Cellar/opencode/1.18.35 ~/opencode-migration-<data>/bin-v1`. Sprawdź: `brew list --pinned` zawiera `opencode`; `~/opencode-migration-<data>/bin-v1/bin/opencode --version` = `1.18.35`.
- [x] **Step 7:** `scp` artefaktów z Task 1 (`rollback.sh`, `README.md`) do katalogu backupu; zapisz `manifest.md`. `bash ~/opencode-migration-<data>/rollback.sh --dry-run` → wydruk zgodny z „Expected dry-run” z prawdziwymi ścieżkami.

### Task 4: Instalacja v2 i konfiguracja (F3, F4)

**Files (służbowa):** Create: `~/.config/opencode` (klon), `opencode.kilocode.json`, symlink `opencode.jsonc`, `secrets/*` (kopie); Modify: brew linki.

**Interfaces:**
- Consumes: `opencode.kilocode.json` z Task 1; slot `~/.config/opencode.v1` z Task 3.
- Produces: `$TMPDIR/opencode/parity/agents-{private,work}.norm.json` (prywatna) — znormalizowane wyniki `debug agents` (bez pól modeli i sekretów).

- [x] **Step 1:** `brew unlink opencode`; `brew info anomalyco/tap/opencode-v2` → stable 2.2.0 (inaczej STOP, [U]); `brew install anomalyco/tap/opencode-v2`; `opencode --version` = `v2.2.0`; `brew list --pinned` nadal zawiera `opencode`. Nie uruchamiać TUI.
- [x] **Step 2:** `git clone --recurse-submodules ssh://git@ssh.github.com:443/jabbas/opencode-config.git ~/.config/opencode`; w klonie `git log -1 --format=%H` = HEAD `origin/main` na prywatnej; `git submodule status` bez `-`/`+`; `opencode-mnemoteca` na `57230ea`.
- [x] **Step 3:** W `~/.config/opencode/opencode-mnemoteca`: `npm ci`, `npm run build`; `test -f ~/.config/opencode/plugins/mnemoteca.js` (symlink rozwiązany). Pozostałe kroki z README „Setup on a new machine” i `docs/dev-guide.md` wykonać tak jak na prywatnej (np. gitignored `package.json`/`node_modules` w korzeniu — porównaj z prywatną: `cat ~/.config/opencode/package.json` na obu).
- [x] **Step 4:** Sekrety: skopiuj z `~/.config/opencode.v1/secrets/` pliki `alibaba-cloud.key context7.key firecrawl.key firecrawl.url github.pat grafana-dev.token grafana-stage.token grafana-test.token homeassistant.token homeassistant.url jira.token jira.url stitch.key` (`cp -p`) oraz `~/.config/opencode.v1/alibaba-cloud.apikey` → korzeń klonu; `bash scripts/init-secret-placeholders.sh`. Sprawdź `git status --short` w klonie → wynik pusty (wszystkie skopiowane pliki są gitignored).
- [x] **Step 5:** `scp` `opencode.kilocode.json` z Task 1 → `~/.config/opencode/opencode.kilocode.json`; `ln -s opencode.kilocode.json opencode.jsonc` (w katalogu klonu); `ls -l opencode.jsonc` → symlink. Nie tworzyć `permission-model.local.json`.
- [x] **Step 6:** `bash scripts/check-skill-whitelists.sh` → 0 × `[FAIL]` (raport `[INFO]` dla użytkownika).
- [x] **Step 7:** `opencode debug paths` → katalog configu = `/Users/gdziegielewski/.config/opencode` (Review Focus 4); `opencode debug config > ~/opencode-migration-<data>/debug-config-work.json` (plik poza repo; nie wypisywać) i sprawdź python3: provider `novomatic` ma `baseURL` = `http://llm.ai.novomatic-tech.com/03/v1`, pakiet openai-compatible, model `default` z limitami 131072/4096; `agent.reviewer` model = `kilo/moonshotai/kimi-k3.1-pro`; MCP `grafana-*` obecne.
- [x] **Step 8:** Z katalogu `~` na obu maszynach: `opencode debug agents` → plik (`~/opencode-migration-<data>/debug-agents-work.json` na służbowej, `$TMPDIR/opencode/parity/agents-private.json` na prywatnej); przenieś plik służbowy na prywatną (`scp`).
- [x] **Step 9: Test parzystości (A1).** Na prywatnej znormalizuj oba pliki: usuń pola modeli (`model`, `modelID`, `providerID`, `variant` i pokrewne), zamaskuj wartości w polach `env`/`headers`/`apiKey`/`token` (zastąp `"<masked>"`), posortuj klucze; zapisz `*.norm.json`. `diff` znormalizowanych → **pusty**. Raportuj wyłącznie liczbę różnic i ścieżki kluczy. Dodatkowo w surowym pliku służbowym: liczba wystąpień `"anthropic/` w polach modeli agentów = 0.

### Task 5: Pierwszy start (F5)

- [x] **Step 1:** [U] Użytkownik w kitty, katalog `~`: `opencode`; czeka na koniec nakładki „Migrating sessions n/N”; nie przerywa; nie używa `-s`.
- [x] **Step 2: Bramka importu.** python3 ro na `~/.local/share/opencode/opencode.db`: `SELECT value FROM kv WHERE key='migration.v1-v2'` = `{"phase":"completed"}`; `SELECT count(*) FROM session_v2 WHERE version NOT LIKE '2.%'` = `v1_counts.session` z manifestu; `SELECT count(*) FROM session s WHERE EXISTS (SELECT 1 FROM message m WHERE m.session_id=s.id) AND NOT EXISTS (SELECT 1 FROM session_message sm WHERE sm.session_id=s.id)` = 0; `SELECT count(*) FROM session_v2 v JOIN session s ON s.id=v.id WHERE v.version LIKE '2.%'` = 0 (Review Focus 1). Dopiero teraz komunikat dla użytkownika: „`-s` dozwolone”.
- [x] **Step 3:** Credentials: lista połączeń v2 (komenda `opencode auth list` lub odpowiednik 2.2.0) zawiera `kilo`. [U] `opencode auth login` → Novomatic → klucz (agent nie odczytuje klucza).
- [x] **Step 4:** `pgrep -fl 'serve --service'` → proces z `Cellar/opencode-v2/2.2.0`; `node ~/.config/opencode/scripts/permission-model/check-alive.mjs` → `mode=shadow`, wiek < 60 s. Zapisz godzinę startu (UTC ISO) w manifeście jako `v2_start` (początek okna gate 2).

### Task 6: Akceptacja (F6)

- [x] **Step 1 (A2):** W `~/.local/share/opencode/log/` od `v2_start`: po jednym `loading plugin` dla superpowers, mnemoteca, kilo-gateway, anthropic-auth, shell-style, permission-model; 0 × `LoadError`/`PluginModule`/`level=ERROR`. — PASS for plugin loading (spec A2); 4 × level=ERROR were Kilo QuotaExceeded model errors, tracked separately
- [x] **Step 2 (A3):** [U] krótka sesja w `~/Projects/<dowolny projekt>`; potem python3 ro: `instruction_state`/`instruction_blob` tej sesji zawierają ścieżki `…/docs/global-rules.md`, `…/docs/memory-rules.md`, `…/docs/design-principles.md`.
- [x] **Step 3 (A4):** `opencode run -m kilo/deepseek/deepseek-v4.1-flash-1017` w `$TMPDIR` służbowej z poleceniem użycia `memory_recall_global` dla frazy znanej z pamięci służbowej → wynik niepusty; `mnemoteca stats --format json` → `document_count` ≥ manifest.
- [x] **Step 4 (A5):** jedna stara sesja v1 (ID z `session`, najnowsza sprzed migracji): `opencode session export <id>` → zawiera wiadomości; [U] ta sama sesja widoczna na liście sesji w TUI.
- [x] **Step 5 (A6):** `opencode run -m <model> "Reply with exactly: OK"` dla `kilo/deepseek/deepseek-v4.1-flash-1017`, `kilo/moonshotai/kimi-k3.1-pro`, `novomatic/default` → każde `OK` (dopuszczalne drobne różnice formatowania).
- [x] **Step 6 (A7):** log od `v2_start`: MCP `grafana-dev/test/stage/prod`, `context7`, `firecrawl`, `jira` — `connected`; `jira` z liczbą narzędzi (0 narzędzi = znany problem z prywatnej, zanotować, nie blokuje); `stitch` — failed (poza zakresem).
- [x] **Step 7 (A8, A9):** `check-alive.mjs` OK i przyrost `~/.local/share/opencode/permission-model/decisions.jsonl` od `v2_start`; `node scripts/test-shell-style.mjs` (w `~/.config/opencode`) → PASS.
- [x] **Step 8 (A10):** `bash ~/opencode-migration-<data>/rollback.sh --dry-run` → zgodny z „Expected dry-run”.
- [x] **Step 9:** Raport akceptacji (tabela A1–A10) → [U] decyzja: przyjąć / naprawić / rollback.

### Task 7: Domknięcie w repo (prywatna)

**Files:**
- Modify: `docs/superpowers/plans/2026-10-04-mnemoteca-opencode-v2.md` (Task 6 — kroki zaznaczone, notka „zrobione 2026-10-08 (dane) / <data> (v2)”)
- Modify: `docs/superpowers/plans/2026-10-09-kilo-gateway-opencode-v2.md` (Task 7 — „zastąpione testem v2, plan migracji Task 6 Step 5”)
- Modify: `docs/superpowers/plans/2026-10-25-cross-model-reviewer.md` (reviewer służbowy = `kilo/moonshotai/kimi-k3.1-pro`)
- Modify: ten plan (checkboxy)

- [x] **Step 1:** Wprowadź powyższe notki (edit tool).
- [x] **Step 2:** Pamięć projektu: `memory_delete` [359] (stan „design in progress”), `memory_store`: wynik migracji, `v2_start`, ścieżka backupu, termin gate 2 (`v2_start` + 3 dni) i termin sprzątania (`v2_start` + 14 dni, [U]).
- [x] **Step 3:** `@devops`: `git add` czterech plików → `git commit -m "docs(plans): work MacBook migrated to OpenCode v2"` → `git push`.

### Poza wykonaniem (terminy w pamięci)

- `v2_start` + ≥3 dni: gate 2 permission-model (`log-report.mjs --since <v2_start>` na służbowej).
- `v2_start` + ≥14 dni: [U] sprzątanie wg spec F7.4.
- Issue w `gandazgul/homebrew-tap` o cofaniu `mnemoteca.rb` przez bota RunWield — tylko po zatwierdzeniu treści przez użytkownika.
