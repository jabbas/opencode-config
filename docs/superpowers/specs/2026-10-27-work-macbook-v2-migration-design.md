# Migracja służbowego MacBooka: OpenCode v1 → v2 z tym repo konfiguracji

- **Data:** 2026-10-27
- **Status:** projekt (do akceptacji użytkownika)
- **Maszyna docelowa:** służbowy MacBook, `ssh -A gdziegielewski@10.1.1.10`, komendy przez `zsh -lic "…"`
- **Źródło prawdy:** to repo (`jabbas/opencode-config`, `main` ≥ `9eed2d7`) na prywatnym Mac mini
- **Rekonesans (surowe dane):** `$TMPDIR/opencode/work-mac-inventory.md`, `$TMPDIR/opencode/work-md/` na prywatnej maszynie

## 1. Intencja

Na służbowym MacBooku ma działać **dokładnie ten setup** co na prywatnym — w szczególności
uprawnienia i sposób zarządzania nimi — a nie dotychczasowy setup służbowy „przerobiony
na podobny”. Zmiany konfiguracji (w tym uprawnień) powstają w tym repo i trafiają na
służbową przez `git pull`, nigdy przez lokalną edycję.

Jednocześnie użytkownik musi móc **szybko wrócić do działającego v1** (jedna komenda),
nie tracąc pamięci (mnemoteca).

## 2. Cele, nie-cele, anty-cele

**Cele**
1. OpenCode v2 (ta sama wersja co na prywatnej) + świeży klon tego repo jako `~/.config/opencode`.
2. Różnice między maszynami wyłącznie w warstwach per-maszynowych, które ten setup przewiduje:
   `opencode.jsonc` (modele, provider `novomatic`, MCP grafana), `secrets/*`, później
   `permission-model.local.json`.
3. Historia sesji v1 widoczna i kontynuowalna w v2; pamięć mnemoteca nienaruszona.
4. Powrót do v1 jednym skryptem, z pamięcią; backup kompletny i zweryfikowany.
5. Start ≥3-dniowego zbierania logu `permission-model` (shadow) na służbowej — dane do gate 2.

**Nie-cele**
- Naprawa stitch MCP (`scripts/stitch-mcp-proxy.mjs`, ścieżka `/Users/jabbas/…` w `opencode.json`) —
  nie działa na żadnej maszynie; osobny projekt. Przechodzi „as is”.
- Profile AWS/EKS w `permission-model.local.json` i decyzja o zaufanych hostach SSH —
  odłożone do analizy danych z gate 2.
- Sprzątanie pozostałości (mnemosyne, `~/.opencode-mem`, globalne pakiety npm, stary
  `~/.config/opencode-backup.tar.gz`) — dopiero po okresie próbnym i za zgodą użytkownika.
- Przenoszenie nieaktywnego wariantu `opencode.anthropic.json` (zostaje w backupie).

**Anty-cele** (porażka, nawet jeśli „działa”)
- Jakakolwiek reguła uprawnień, agent, plugin lub instrukcja na służbowej różna od prywatnej
  poza warstwami per-maszynowymi.
- Utrata choćby jednej sesji v1 lub wspomnienia w mnemoteca.
- Rollback, który wymaga ręcznego odtwarzania czegokolwiek poza uruchomieniem skryptu.
  Jedyny dopuszczalny wyjątek: ponowne `opencode auth login` w v1 dla providerów OAuth,
  których refresh token v2 zdążył zrotować (anthropic; kilo ma tokeny roczne) — §7.
- Sekrety w gicie lub w logach/raportach agentów.

## 3. Stan wyjściowy (rekonesans 2026-10-27)

| Obszar | Służbowy | Prywatny (wzorzec) |
|---|---|---|
| Binarka | `anomalyco/tap/opencode` 1.18.35 (brew) | `anomalyco/tap/opencode-v2` **2.2.0** (od 2026-10-27; formuła `conflicts_with "opencode"`) |
| Config | `~/.config/opencode` = to samo repo, 40+ commitów w tyle, lokalne zmiany, stash | `main` |
| Warstwa maszyny | `opencode.jsonc → opencode.kilocode.json` (modele `kilo/…`, provider `novomatic`) | `opencode.jsonc` (anthropic, reviewer kimi) |
| Pamięć | mnemoteca 0.3.4 (brew), 62 kolekcje / 542 dok.; mnemosyne zamrożona od 2026-10-08 + eksport JSONL | mnemoteca **0.3.4** (od 2026-10-27, ta sama formuła `ad23e83`) |
| Dane | `~/.local/share/opencode` 3.8 GB (`opencode.db` 2.8 GB: 3968 sesji, 93 695 wiadomości, 358 042 części), cache 1.0 GB | — |
| Zapisane zgody „Always” | 0 (tabela `permission` pusta) | — |
| Inne | `~/.opencode` (stary katalog v1), `XDG_CONFIG_HOME="${HOME}/.config/"` (końcowy `/`), `~/.claude` bez `skills/`, 134 GiB wolne | — |

Rozstrzygnięte przed migracją (już w repo / na GitHubie):
- jenkins-cli `v0.0.42` na obu (`d251c7d`); lokalny `92b9c2c` na służbowej jest zbędny.
- Fix mnemoteca ze służbowej (`eb94d2e`) przeniesiony jako `57230ea` na `opencode-v2` forka,
  bez `console.*` w adapterze v2; submoduł podbity (`3559899`).
- `instructions` jako ścieżki absolutne `~/.config/opencode/docs/…` + `docs/design-principles.md`
  (`9eed2d7`). Względne ścieżki w v2 nie ładowały się poza repo (0 z 409 sesji).
- Stash służbowy (22 pliki) w całości zawarty w nowszej postaci w repo → tylko backup.

## 4. Decyzje użytkownika

| # | Decyzja |
|---|---|
| U1 | Setup = to repo 1:1; świeży klon, nie `git pull` w starym katalogu. Nic ze starego katalogu nie jest kopiowane do nowego poza `secrets/*` i `alibaba-cloud.apikey`. |
| U2 | Szybki powrót do v1 z pamięcią; pamięć zostaje w mnemoteca (v1 obsługuje fork przez dual export). |
| U3 | Historia sesji v1 przechodzi do v2. |
| U4 | `novomatic` = firmowy serwer LLM on-prem (`http://llm.ai.novomatic-tech.com/03/v1`, Qwen3.6-27B) — ma być dostępny w v2 (warstwa maszyny). |
| U5 | Reviewer na służbowej przez **firmowe kilo**: `kilo/moonshotai/kimi-k3.1-pro` (ta sama rodzina co reviewer prywatny). |
| U6 | Oba maile (`gdziegielewski@novomatic-tech.com`, `jabbas@jabbas.eu`) = użytkownik; publiczne repo `jabbas/*` → autor `jabbas@jabbas.eu`. Kontekst — migracja nie commituje niczego ze służbowej i nie zmienia tam tożsamości git. |
| U7 | stitch MCP poza zakresem. |

## 5. Architektura: sloty i przełączanie

Stan v1 jest zachowany jako kompletny „slot”: konfiguracja przeniesiona w całości (`mv`),
dane skopiowane klonem APFS (`cp -c`, natychmiastowo, bez zajmowania miejsca), binarka v1
zostaje w Cellarze przypięta. Przełączenie slotu = `brew unlink/link` + zamiana katalogów.
Mnemoteca jest wspólna dla obu slotów.

```d2
direction: right

brew: Homebrew (anomalyco/tap) {
  v1: "opencode 1.18.35\n(pinned, keg zostaje)"
  v2: "opencode-v2 = wersja z prywatnej"
  link: "/opt/homebrew/bin/opencode\n(link: jedna aktywna)" {shape: diamond}
  v1 -> link: rollback
  v2 -> link: migracja
}

v1slot: Slot v1 (zachowany) {
  cfg: "~/.config/opencode.v1\n(mv starego katalogu:\nstash, commity, dist mnemoteca)"
  bak: "~/opencode-migration-<data>/\nshare/ state/ cache/ (cp -c)\ndot-opencode/ (mv ~/.opencode)\nmnemoteca/ (kopia db)\nmanifest.md, rollback.sh"
}

v2slot: Slot v2 (aktywny) {
  cfg: "~/.config/opencode\n(git clone tego repo)"
  layer: "warstwa maszyny (gitignored):\nopencode.kilocode.json ← opencode.jsonc\nsecrets/*"
  data: "~/.local/share/opencode\n(opencode.db: migracja schematu\n+ import sesji v1 → session_v2)"
  cfg -> layer
}

shared: Wspólne {
  mem: "mnemoteca\n~/.local/share/mnemoteca/mnemoteca.db"
  secrets2: "~/.config/mcp-secrets/grafana-*.token"
}

repo: "GitHub jabbas/opencode-config\n(źródło prawdy, zmiany tylko z prywatnej)" {shape: cloud}

repo -> v2slot.cfg: git clone / git pull
v2slot.cfg -> shared.mem: plugin mnemoteca (57230ea)
v1slot.cfg -> shared.mem: plugin mnemoteca (eb94d2e, v1)
v2slot.layer -> shared.secrets2: "{file:~/.config/mcp-secrets/…}"
```

Fakty z kodu v2, na których opiera się projekt:
- v2 używa tego samego `opencode.db` (`cli/src/database-path.ts`); migracja schematu
  (`20260804233008_loose_psylocke`) tworzy `session_v2` i przebudowuje `session_message`,
  `session_input`, `session_context_epoch` — tabele, które ma też v1 1.18.35 → po starcie v2
  baza nie nadaje się dla v1, stąd przywracanie kopii przy rollbacku.
- Import sesji v1 (`core/src/database/v1-migration.bun.ts`) działa w tle przy starcie serwera,
  jest wznawialny (kv `migration.v1-v2`), nie zmienia tabel v1 (`session`/`message`/`part`),
  zeruje per-sesyjne `permission`. Na prywatnej: 1393/1393 sesji, ~20 s.
- **Pułapka:** `opencode -s <id>` dla sesji jeszcze nie zaimportowanej tworzy pustą sesję
  o tym ID (`cli/src/session-target.ts:106`), a importer ją potem pomija (`INSERT OR IGNORE`)
  → historia tej sesji przepada. Zakaz `-s` do potwierdzenia końca importu.
- Import `auth.json` → credentials (`20260805200742_import_legacy_credentials`): kilo (oauth
  + `accountId`), anthropic, kimi-code-plan-global, factory, opencode-go.
- Stary format providera v1 jest tłumaczony przez `core/src/v1/config/migrate.ts`; pole `api`
  staje się `baseURL` (`:126`) — obecny `"api": "openai"` w `novomatic` nadpisałby URL.
  Dlatego `novomatic` jest pisany od nowa (§6 F4).
- Projektowe `.opencode/` są wykrywane przez wędrówkę w górę od katalogu sesji
  (`core/src/config/discovery.ts:77-94`) → `~/.opencode` byłby traktowany jak projektowy
  katalog konfiguracji w każdym projekcie pod `~`; na prywatnej go nie ma.
- `~/.claude` wnosi do v2 tylko `skills/` (`config/plugin/compatibility.ts:40`); na służbowej
  brak → bez wpływu.

## 6. Fazy

Wszystko wykonywane **z prywatnej maszyny przez ssh**, nie z sesji OpenCode na służbowej.
Bramki ludzkie oznaczone **[U]**.

### F0. Przygotowanie (prywatna + odczyt służbowej)
1. Parzystość wersji — **zrobione 2026-10-27**: prywatna na `opencode-v2` 2.2.0
   (`debug agents`/`debug config` bajtowo identyczne z 2.1.4; wszystkie 6 pluginów ładuje się)
   i mnemoteca 0.3.4. Służbowa dostaje `opencode-v2` 2.2.0. Jeśli w dniu migracji formuła
   oferuje inną wersję niż prywatna — STOP, **[U]**.
   Uwaga mnemoteca: formuła w `gandazgul/tap` jest błędnie cofnięta do 0.3.3 (commit bota
   RunWield `8130326`); na służbowej **nie** robić `brew reinstall`/`install` mnemoteca.
2. Repo: `main` na GitHubie zawiera `9eed2d7` i wszystko, co ma przejść; working tree czyste.
3. Odczyt na służbowej (bez zmian): lista projektowych nadpisań, które mogłyby zmienić
   uprawnienia w v2 — `opencode.json[c]` i katalogi `.opencode/`, `.claude/skills`, `.agents/`
   w `~/Projects/**` (maxdepth rozsądny) i w `~`. Raport dla użytkownika; nic nie usuwać.
4. Przygotować treść nowej warstwy maszyny (F4) i `rollback.sh` (F2) na prywatnej, do przeglądu.

### F1. Okno serwisowe [U]
1. **[U]** Użytkownik kończy wszystkie sesje OpenCode na służbowej (rekonesans: 9 procesów,
   6 × `-s ses_…`); nie uruchamia OpenCode do końca F5.
2. Warunek: `pgrep -x opencode` pusty (sprawdzać nazwę procesu, nie `-f`).

### F2. Backup → `~/opencode-migration-<YYYY-MM-DD>/`
1. `mnemoteca stats --format json` → manifest; kopia `~/.local/share/mnemoteca/mnemoteca.db`
   i `~/.config/mnemoteca/config.yaml` → `mnemoteca/` (modele/ONNX nie — odtwarzalne).
2. `cp -c -R` (klon APFS): `~/.local/share/opencode` → `share/`, `~/.local/state/opencode` →
   `state/`, `~/.cache/opencode` → `cache/`. `opencode.db` kopiowany razem z `-wal`/`-shm`.
3. Weryfikacja kopii bazy: `PRAGMA quick_check` = `ok` (python3, `mode=ro`) + liczniki
   `session`/`message`/`part` = oryginał → manifest.
4. `mv ~/.opencode` → `dot-opencode/`.
5. `mv ~/.config/opencode ~/.config/opencode.v1` (cały katalog: stash, commit `92b9c2c`,
   submoduł mnemoteca `eb94d2e` z działającym `dist/` dla v1 — nic nie ginie).
6. `brew pin opencode` (keg 1.18.35 zostaje, `brew upgrade`/`cleanup` go nie ruszy) oraz
   `cp -c -R /opt/homebrew/Cellar/opencode/1.18.35` → `bin-v1/` w backupie (brew po upgrade
   kasuje stare kegi — kopia chroni przed przypadkowym `brew cleanup`).
7. Zapisać w katalogu backupu: `manifest.md` (wersje, liczniki, sha256 `opencode.db`, data,
   ścieżki), `rollback.sh`, `README.md` (jak użyć). `rollback.sh` sprawdzony `bash -n` i trybem
   `--dry-run` (wypisuje kroki).

### F3. Instalacja v2
1. `brew unlink opencode` → `brew install anomalyco/tap/opencode-v2` (wersja z F0).
2. `opencode --version` = wersja prywatnej; `which opencode` → keg `opencode-v2`.
3. Nie uruchamiać jeszcze TUI.

### F4. Konfiguracja
1. `git clone --recurse-submodules ssh://git@ssh.github.com:443/jabbas/opencode-config.git ~/.config/opencode`
   (ten sam remote co dotąd na służbowej). Sprawdzić `git submodule status` (brak `-`/`+`).
2. Build pluginu pamięci: `opencode-mnemoteca/` → `npm ci && npm run build`;
   `plugins/mnemoteca.js` musi się rozwiązywać. Pozostałe kroki instalacyjne — dokładnie wg
   `README.md` „Setup on a new machine” i `docs/dev-guide.md` (np. gitignored `package.json`
   z zależnościami, jeśli dev-guide go wymaga — odtworzyć jak na prywatnej).
3. `secrets/`: skopiować wszystkie pliki z `~/.config/opencode.v1/secrets/` poza `README.md`
   i `.gitignore` (te są z gita), z zachowaniem uprawnień; skopiować `alibaba-cloud.apikey`
   z korzenia. Potem `bash scripts/init-secret-placeholders.sh` (uzupełnia brakujące).
4. Warstwa maszyny: nowy `opencode.kilocode.json` + symlink `opencode.jsonc → opencode.kilocode.json`
   (wzorzec „switchable variants” z README). Zawartość:
   - `model`, `small_model` i 17 nadpisań agentów — **bez zmian** względem starego
     `opencode.kilocode.json` (wartości w §3 rekonesansu / pliku w `opencode.v1`).
     Wszystkie 17 agentów istnieje w obecnym repo; nadpisania obejmują też `autopilot`
     i `architect` (przypięte do anthropic w `opencode.json` — warstwa maszyny wygrywa).
     Agenci bez nadpisania (`general`, `jenkins`, `plan`, wbudowani) dziedziczą globalny
     `model` = `kilo/deepseek/…`. Żaden agent na służbowej nie może domyślnie trafić
     na `anthropic/…` — sprawdzane w F4.7 (`debug agents`: brak `anthropic/` w modelach).
   - `agent.reviewer.model` = `kilo/moonshotai/kimi-k3.1-pro` — ID potwierdzić w katalogu
     modeli v2 przed wpisaniem (np. lista modeli providera `kilo`). Brak tego ID → STOP,
     **[U]** wybór (decyzja U5 należy do użytkownika; nie podstawiać zamiennika).
   - Provider `novomatic` zapisany tak, by v2 dało **dokładnie**: SDK openai-compatible,
     `baseURL` = `http://llm.ai.novomatic-tech.com/03/v1`, jeden model `default`
     (nazwa „Qwen3.6-27B”, tool calling, kontekst 131072, output 4096), metoda klucza env
     `NOVOMATIC_API_KEY` dopuszczona. Format (natywny v2 vs v1 bez pola `api`) wybiera
     wykonawca na podstawie `packages/schema/src/config/provider.ts` zainstalowanej wersji;
     kryterium: `opencode debug config` pokazuje powyższe wartości.
   - MCP `grafana-dev/test/stage/prod` — blok z `secrets/README.md` (tokeny
     `{file:~/.config/mcp-secrets/grafana-<env>.token}` już istnieją na służbowej).
5. **Nie** tworzyć `permission-model.local.json` (domyślne `permission-model.json` = shadow).
6. `bash scripts/check-skill-whitelists.sh` → 0 × `[FAIL]`.
7. Statyczne porównanie z prywatną: `cd ~ && opencode debug agents` na obu maszynach,
   znormalizować pola modeli → **identyczne** (uprawnienia, narzędzia, skille, tryby).
   Różnica = STOP. To główny dowód anty-celu #1. (Uruchomienie `debug` startuje migrację
   schematu bazy — dopuszczalne po F2.)

### F5. Pierwszy start [U]
1. **[U]** Użytkownik uruchamia `opencode` (TUI, kitty, katalog `~`) i czeka na koniec
   nakładki „Migrating sessions n/N”. Nie przerywać; nie używać `-s`.
2. Potwierdzenie importu (python3, `mode=ro`): kv `migration.v1-v2` = `{"phase":"completed"}`;
   liczba wierszy `session_v2` z `version` 1.x = liczba sesji v1 z manifestu; każda sesja v1
   z wiadomościami ma wiersze w `session_message`. Dopiero teraz wolno `-s`.
3. Credentials: lista połączeń/credentials v2 zawiera `kilo` (z organizacją) i pozostałe
   z importu. **[U]** `opencode auth login` → Novomatic → klucz (wartość z `~/.zsh/L-03103rc`;
   agent nie czyta ani nie wypisuje klucza).
4. Background service v2: TUI startuje współdzielony `opencode serve --service` (nie launchd;
   na prywatnej proces z ppid 1, `service.json` z hasłem). Nie dziedziczy env z późniejszych
   shelli → `novomatic` musi działać dzięki credentialowi z kroku 3, nie `NOVOMATIC_API_KEY`.
   Zmiana binarki/konfiguracji wymagającej restartu → `opencode service restart`.

### F6. Weryfikacja (kryteria akceptacji)
| # | Kryterium | Jak |
|---|---|---|
| A1 | Parzystość konfiguracji | F4.7 (ponownie po F5) |
| A2 | Pluginy: superpowers, mnemoteca, kilo-gateway (fork), anthropic-auth, shell-style, permission-model — każdy raz, brak `LoadError` | `~/.local/share/opencode/log/` |
| A3 | Instrukcje w obcym projekcie: sesja w `~/Projects/<x>` ma `global-rules.md`, `memory-rules.md`, `design-principles.md` | `instruction_state` / `instruction_blob` (python3 ro) |
| A4 | Pamięć: `memory_recall_global` zwraca znane wspomnienie służbowe; smoke store→recall→delete w projekcie testowym; `mnemoteca stats` ≥ manifest | sesja TUI |
| A5 | Sesje: stara sesja v1 widoczna na liście i otwiera się z historią | TUI / `opencode session export <id>` |
| A6 | Modele: po jednym prompcie — domyślny `kilo/deepseek/…`, reviewer `kilo/moonshotai/kimi-k3.1-pro`, `novomatic/default` | `opencode run -m …` |
| A7 | MCP: grafana-dev (agent `debugger`, zapytanie read-only), context7, jira, firecrawl | sesja TUI |
| A8 | permission-model żyje i loguje | `node scripts/permission-model/check-alive.mjs`; przyrost `~/.local/share/opencode/permission-model/decisions.jsonl` |
| A9 | Testy shell-style przechodzą | `node scripts/test-shell-style.mjs` (lub wg dev-guide) |
| A10 | Rollback gotowy | `rollback.sh --dry-run` wypisuje poprawne kroki |

Niespełnione A1–A9 po próbie naprawy w granicach tego projektu → decyzja **[U]**: naprawiać
czy rollback.

### F7. Okres próbny i domknięcie
1. ≥3 dni pracy → gate 2 permission-model: `node scripts/permission-model/log-report.mjs --since <start F5>`
   + `check-alive.mjs` (pamięć projektu: „PERMISSION-MODEL GATE 2”).
2. Pierwszy przegląd uprawnień na służbowej wg `docs/permission-review.md` uruchomi się sam
   (brak `PERMISSION REVIEW LAST:` w pamięci służbowej).
3. Aktualizacja statusów w repo: plan mnemoteca Task 6 (rollout służbowy) — zrobione;
   plan kilo-gateway Task 7 (test v1 na służbowej) — zastąpiony testem v2 (A6);
   cross-model-reviewer — reviewer służbowy wpisany.
4. Backup i slot v1 trzymane ≥2 tygodnie. Potem **[U]** sprzątanie: katalog backupu,
   `~/.config/opencode.v1`, `brew unpin` + odinstalowanie `opencode` 1.18.35, mnemosyne
   (+ `~/.local/bin/mnemosyne`), `~/.opencode-mem`, globalne pakiety npm `opencode-*`,
   `~/.config/opencode-backup.tar.gz`, `session-ses_3453.md` itp.

## 7. Rollback (`rollback.sh`)

Warunek: brak procesów `opencode` — łącznie z background service v2 (`opencode serve
--service`, ppid 1; skrypt najpierw zamyka go komendą `opencode service …` zainstalowanej
wersji, potem sprawdza `pgrep -x opencode`). Jeśli keg 1.18.35 zniknął z Cellara, skrypt
przywraca go z `bin-v1/` przed `brew link`.
Kroki (idempotentne, każdy z kontrolą):
1. `brew unlink opencode-v2 && brew link opencode` → `opencode --version` = 1.18.35.
2. `mv ~/.config/opencode ~/.config/opencode.v2-<ts>`; `mv ~/.config/opencode.v1 ~/.config/opencode`.
3. `mv ~/.local/share/opencode ~/.local/share/opencode.v2-<ts>`; `cp -c -R <backup>/share ~/.local/share/opencode`
   (kopia, nie `mv` — backup zostaje wielokrotnego użytku). Analogicznie `state`, `cache`.
4. `cp -c -R <backup>/dot-opencode ~/.opencode`.
5. Mnemoteca: **bez zmian** (wspólna; v1 używa pluginu z `opencode.v1`).
6. Raport: co przeniesiono gdzie; jak wrócić do v2 (odwrotne `mv` + `brew unlink opencode && brew link opencode-v2`).

Skutek: sesje utworzone w v2 nie są widoczne w v1 (zostają w `opencode.v2-<ts>`);
wspomnienia zapisane w v2 zostają. Credentials: przywrócony `auth.json` ma tokeny z chwili
backupu. Jeśli v2 zdążył zrotować refresh token OAuth (realnie: anthropic), v1 wymaga
ponownego `opencode auth login` dla tego providera — skrypt na końcu wypisuje to jako
jedyny możliwy krok ręczny. Skrypt nie kopiuje sekretów z v2 do v1 (anty-cel #4). Live-test rollbacku nie jest wymagany (kroki to `mv`/`cp`/
`brew link`); wystarcza `--dry-run` (decyzja architekta).

## 8. Ryzyka

| Ryzyko | Skutek | Mitigacja |
|---|---|---|
| `-s <id>` przed końcem importu | utrata historii tej sesji w v2 | F5.2 jako bramka; komunikat dla użytkownika |
| Import credentiali kilo z organizacją niesprawdzony na koncie firmowym (fork testowany tylko prywatnie) | brak modeli `kilo/…` | A6; fallback `KILO_API_KEY` (obsługiwany przez fork) lub ponowne `opencode auth login` → kilo; ostatecznie rollback |
| Format `novomatic` w v2 | provider bez URL / zły SDK | kryterium F4.4 + A6 |
| `XDG_CONFIG_HOME` z końcowym `/` | inna ścieżka globalnego configu | F4.7 (`debug config` pokazuje `~/.config/opencode`); w razie problemu **[U]** decyzja o zmianie w dotfiles |
| Projektowe `.opencode/`/`opencode.json` w projektach służbowych nadpisują uprawnienia | odstępstwo od „tego samego setupu” w danym projekcie | F0.3 raport; decyzja **[U]** per projekt |
| Długi pierwszy start (2.8 GB, 683k zdarzeń) | użytkownik przerywa | import wznawialny; komunikat w F5.1 |
| `brew install` aktualizuje inne formuły | niezamierzone zmiany | `brew pin opencode`; reszta akceptowalna |

## 9. Decyzje architekta (do przejrzenia)

- Backup w `~/opencode-migration-<data>/` (nie `$TMPDIR`), klony APFS `cp -c`; konfiguracja
  v1 przenoszona `mv` jako cały katalog zamiast bundli/patchy.
- Rollback bez live-testu, tylko `--dry-run`.
- Nieaktywny wariant `opencode.anthropic.json` nie jest przenoszony.
- Klucz `novomatic` jako credential v2 (`opencode auth login`), nie `{file:secrets/…}` ani env;
  `NOVOMATIC_API_KEY` w `L-03103rc` zostaje jako zapas.
- Parzystość wersji v2 obu maszyn ważniejsza niż „najnowsza”.
- Binarka mnemoteca na służbowej zostaje 0.3.4 (bez zmian w trakcie migracji → baza wspólna
  dla v1 i v2 bez ryzyka). Prywatna podnoszona z 0.3.3 do 0.3.4 w F0.1 (config.yaml przypina
  Arctic 256-dim, więc nowe domyślne Jina 768-dim z 0.3.4 nie działają; reranker przechodzi
  na domyślny „wyłączony” — tak jak na służbowej).
- Rollback po rotacji tokenu OAuth wymaga ponownego logowania (wyjątek w anty-celu #3)
  zamiast synchronizacji sekretów z v2 do v1.
- Wykonanie: `@devops` (brew, git, pliki, ssh), `@general` (odczyty DB/raporty), bramki [U] — użytkownik.

## 10. Zostawione wykonawcy

- Dokładne komendy, kolejność kontroli w skryptach, format manifestu.
- Format bloku `novomatic` (natywny v2 vs v1) — byle spełniał kryterium F4.4.
- Sposób normalizacji wyniku `debug agents` do porównania.
- Głębokość przeszukania projektów w F0.3.
