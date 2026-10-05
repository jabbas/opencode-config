# Port opencode-mnemoteca na OpenCode v2 + migracja pamięci

- **Data:** 2026-10-04
- **Status:** Proposed
- **Ścieżka brainstormingu:** architektoniczna

## 1. Kontekst

- Zainstalowany OpenCode: **v2.0.22** (Homebrew `anomalyco/tap/opencode-v2`).
- Plugin pamięci w `opencode.json` → `plugin: ["opencode-mnemosyne", …]` to
  `opencode-mnemosyne@0.2.4` (gandazgul) — **tylko API v1** (eksport funkcji), deprecated,
  przeniesiony do `gandazgul/opencode-mnemoteca`. Na v2 loader odrzuca go
  (`Plugin must export a default definition with an id and an effect or setup function.`),
  więc narzędzia `memory_*` z `docs/memory-rules.md` nie istnieją.
- Następca `opencode-mnemoteca@0.3.0` też jest **tylko v1** (`@opencode-ai/plugin ^1.2.24`,
  `export const MnemotecaPlugin: Plugin`, hook `experimental.session.compacting`, `Bun.spawn`
  binarki `mnemoteca`). Brak issues/PR o v2.
- Dane: `~/.local/share/mnemosyne/mnemosyne.db` (Go `mnemosyne`, ~1.6 MB, **219 dokumentów,
  63 kolekcje**). Mnemoteca ma oficjalną migrację export→import
  (`gandazgul/mnemoteca/docs/migrate-from-mnemosyne.md`); nie otwiera starej bazy bezpośrednio.
- Odrzucona alternatywa: `donbowman/opencode-mnemosyne` (v2, ale inny backend — pythonowy
  serwer mnemosyne-oss, brak migracji danych, inne nazwy narzędzi, 3 commity, 0 gwiazdek).

## 2. Decyzja

Dodać obsługę OpenCode v2 do `opencode-mnemoteca` **w forku, z PR upstream** do
`gandazgul/opencode-mnemoteca`, zachowując pełną kompatybilność z v1 (dual export).
Lokalnie używać forka (submoduł) do czasu merge'a i publikacji na npm.
Zmigrować dane na **obu maszynach** (prywatna i służbowa) do mnemoteca.

Fork zakładamy na koncie zalogowanym w `gh` (`gh api user --jq .login`).

## 3. Fakty o API v2 (źródło: anomalyco/opencode @ v2.0.22)

> Lokalny klon `~/Projects/opencode` jest na gałęzi `dev` w stanie **1.18.34**
> (`@opencode-ai/plugin`, wczesny podgląd `src/v2/promise`) — **nie** odpowiada v2.0.22
> (tam SDK to `@opencode/plugin`, `packages/plugin/src/promise/*`). Przed implementacją
> zweryfikować sygnatury na tagu: `git -C ~/Projects/opencode fetch --tags` +
> `git worktree add ../opencode-v2.0.22 v2.0.22`. Ten sam klon (stan 1.18.x) posłuży do
> weryfikacji zachowania ścieżki v1 (`default.server` / `default.setup`).

| Potrzeba | v1 | v2 |
|---|---|---|
| Kontrakt modułu | named/`default.server` fn | `export default { id, setup }` — tylko `default` jest walidowany (`packages/core/src/plugin/module.ts`) |
| Narzędzia | `tool({ description, args, execute })` → string | `ctx.tool.transform(t => t.add({ name, description, input, options, execute }))` → `{ content }` |
| Schemat argumentów | `tool.schema` (zod shape) | Effect Schema / Standard Schema / **JSON Schema** |
| Natywne wywołanie narzędzia | domyślnie | `options: { codemode: false }` (domyślnie code mode) |
| Katalog projektu | `ctx.directory`/`ctx.project` | `ctx.location.directory`, `ctx.location.project.directory` (tylko w `setup`; `ToolContext` nie ma katalogu) |
| Anulowanie | — | `toolCtx.signal: AbortSignal` |
| Kontekst po compaction | `experimental.session.compacting` | `ctx.session.hook("context", e => e.system.push({type:"text", text}))` (tekst wstrzyknięty do compaction nie przetrwa w podsumowaniu) |
| Runtime | Bun | Bun 1.4.2 (binarka brew) — `Bun.spawn` dostępne |

v1 przy `default` zawierającym `id`/`server` wywołuje `default.server`, a (zaobserwowane na
1.18.18 w superpowers) również `default.setup` z kontekstem v1 — stąd wymagany guard.

## 4. Projekt portu (repo forka, gałąź `opencode-v2`)

### 4.1 Moduły

```d2
direction: right
index: "src/index.ts\n(entry, dual export)"
v1: "v1 adapter\nMnemotecaPlugin (server)\n@opencode-ai/plugin tool()"
v2: "src/v2.ts\nsetup(ctx)\nzero-dep"
core: "src/core.ts\nrunner + handlers + opisy\nzero-dep"
bin: "mnemoteca CLI\n(Go, brew)" {shape: hexagon}
db: "~/.local/share/mnemoteca/mnemoteca.db" {shape: cylinder}
oc1: "OpenCode 1.x" {shape: oval}
oc2: "OpenCode 2.x" {shape: oval}

oc1 -> index: "default.server"
oc2 -> index: "default.setup"
index -> v1
index -> v2
v1 -> core
v2 -> core
core -> bin: "Bun.spawn(cwd, signal)"
bin -> db
```

- **`src/core.ts`** (nowy, bez zależności) — logika wyjęta z obecnego `index.ts` bez zmiany
  zachowania:
  - `run(args: string[], opts: { cwd: string; signal?: AbortSignal }): Promise<string>` —
    `Bun.spawn(["mnemoteca", ...args])`, stdout/stderr, kod wyjścia → błąd.
  - `init(projectName, cwd)`.
  - Handlery: `recall`, `recallGlobal`, `store`, `storeGlobal`, `delete` — przyjmują
    zwalidowane argumenty, zwracają string (jak dziś w v1).
  - Stałe: nazwy i opisy narzędzi, tekst instrukcji pamięci (dziś wstrzykiwany w compaction).
- **`src/index.ts`** — adapter v1 (`MnemotecaPlugin`) z identycznymi nazwami, argumentami,
  hookami i zachowaniem co 0.3.0, tylko delegujący do `core`. Dual export:
  ```ts
  export const MnemotecaPlugin: Plugin = /* v1, bez zmian zachowania */;
  export default { id: "mnemoteca", server: MnemotecaPlugin, setup };
  ```
- **`src/v2.ts`** — `setup(ctx)`:
  1. **Guard:** jeśli brak `ctx?.tool?.transform` lub `ctx?.session?.hook` → `return`
     (wywołanie przez v1).
  2. Przechwycenie `const cwd = ctx.location.directory` oraz nazwy projektu tą samą logiką
     co v1 (basename katalogu sesji, bez końcowych `/`, `global` → `default`).
  3. **Brak binarki:** zachowanie odziedziczone z v1 przez `core.run` — narzędzia zwracają
     `Error: mnemoteca binary not found. Install it: https://github.com/gandazgul/mnemoteca#install`,
     init loguje ostrzeżenie. Start OpenCode się nie wywraca.
  4. `init(name, cwd)` — błąd logowany, nie rzucany.
  5. `ctx.tool.transform` → 5 narzędzi (`memory_recall`, `memory_recall_global`,
     `memory_store`, `memory_store_global`, `memory_delete`), `input` jako zwykły
     JSON Schema (`type: "object"`, `additionalProperties: false`, te same pola i
     wymagalność co w v1, w tym `core?: boolean`, `id`), `options: { codemode: false }`,
     `execute: async (input, tctx) => ({ content: await handler(input, { cwd, signal: tctx.signal }) })`.
  6. `ctx.session.hook("context", e => e.system.push({ type: "text", text: MEMORY_INSTRUCTIONS }))`
     — odpowiednik hooka compaction z v1.

### 4.2 Pakiet

- `main`/`exports` bez zmian → `dist/index.js` (tsc). v2 ładuje ten sam entry
  (`Host.resolve` próbuje `"server"`, potem `""`).
- `@opencode-ai/plugin` zostaje zależnością tylko dla ścieżki v1. **Nie** dodajemy
  `@opencode/plugin` (v2) — `Plugin.define` to funkcja tożsamościowa; typy v2 lokalne w `v2.ts`.
- README: sekcja „OpenCode v2” (konfiguracja, `codemode:false`, różnice zachowania).

### 4.3 Poza zakresem (YAGNI)

- Auto-recall/auto-capture (styl donbowman).
- Zamiana `Bun.spawn` na `node:child_process`.
- Jakiekolwiek zmiany w binarce `mnemoteca`.
- Zmiany nazw narzędzi lub ich semantyki.

## 5. Testy

- Narzędzia testowe zgodne z repo: `npm test` (tsc + `tsx`, `node:test`, zaślepka
  `globalThis.Bun`); istniejący `src/index.test.ts` musi przejść **bez modyfikacji**
  (to jest test regresji v1).
- **Jednostkowe**, fałszywy kontekst v2:
  - `setup` rejestruje dokładnie 5 narzędzi, wszystkie z `codemode: false` i poprawnym JSON Schema.
  - `execute` wywołuje stub binarki (skrypt w PATH testu) z oczekiwanymi argumentami i `cwd`;
    zwraca `{ content }`; przekazuje `signal`.
  - Guard: kontekst w kształcie v1 → `setup` nic nie rejestruje i nie rzuca.
  - Brak binarki → narzędzia zwracają komunikat błędu, `setup` nie rzuca.
  - Hook `context` dopisuje część systemową.
- **Regresja v1:** istniejący `src/index.test.ts` (narzędzia, argv, compaction, brak binarki)
  przechodzi bez zmian po refaktorze.
- **Smoke na żywo (v2.0.22):** agent wykonuje `memory_store` → `memory_recall` →
  `memory_delete`; w logu brak `PluginModule.LoadError`.
- v1 na żywo: brak instalacji — zaznaczyć w PR jako nietestowane na żywo (pokryte testem regresji).

## 6. PR upstream

- Przed otwarciem: przeszukać otwarte i zamknięte PR/issues w
  `gandazgul/opencode-mnemoteca` i `gandazgul/mnemoteca` (stan na 2026-10-04: tylko zamknięty
  PR #1 „tag support and core memories” — niezwiązany).
- Jedna zmiana: „Add OpenCode v2 support (dual export, v1 unchanged)”.
- Opis problemu na faktach: log `LoadError` z sesji v2.0.22.
- Ujawnienie autorstwa: model, harness (OpenCode v2.0.22), zainstalowane pluginy.
- **Pełny diff do akceptacji użytkownika przed wysłaniem.**
- Target: domyślna gałąź upstream (sprawdzić przed otwarciem).

## 7. Wdrożenie lokalne (runbook — obie maszyny)

Wykonać na **każdej** maszynie (prywatna, służbowa), przy zamkniętych sesjach OpenCode.

1. **Inwentaryzacja:** czy istnieje `~/.local/share/mnemosyne/mnemosyne.db` i
   `~/bin/mnemosyne` (lub `mnemosyne` w PATH); zanotować liczby dokumentów i kolekcji
   (prywatna: 219 / 63).
2. **Backup:** `tar` katalogu `~/.local/share/mnemosyne/` (z `-wal`/`-shm`) do archiwum z datą.
   Stara binarka i baza zostają nietknięte.
3. **Binarka:** `brew install gandazgul/tap/mnemoteca` (nie `install.sh` — automigracja poza kontrolą).
4. **Migracja:**
   - eksport do **trwałego** katalogu (wg `~/Projects/mnemoteca/docs/migrate-from-mnemosyne.md`):
     `mnemosyne export --all --yes --output ~/.mnemoteca-migration-exports/manual-mnemosyne-export`
     (z embeddingami; katalog zostaje jako kopia odtworzeniowa),
   - `mnemoteca stats --format json` → musi być 0 kolekcji / 0 dokumentów,
   - `mnemoteca import --dir ~/.mnemoteca-migration-exports/manual-mnemosyne-export` — jednokrotnie,
   - weryfikacja: liczby zgodne z krokiem 1; `mnemoteca search` na 2–3 znanych
     wspomnieniach (global + projektowe).
5. **Plugin (raz w repo konfiguracji, potem `git pull` + submodule update na drugiej maszynie):**
   - submoduł `opencode-mnemoteca/` → fork, gałąź `opencode-v2`,
   - względny symlink **do pliku** `plugins/mnemoteca.js → ../opencode-mnemoteca/dist/index.js`
     (auto-discovery v2; katalog bez `index`/`server` w korzeniu jest przez v2.0.22 po cichu
     pomijany — zweryfikowane w recenzji końcowej),
   - na każdej maszynie: `cd opencode-mnemoteca && npm ci && npm run build`
     (rozwój forka odbywa się w `~/Projects/opencode-mnemoteca`; submoduł śledzi gałąź `opencode-v2`).
6. **Konfiguracja:**
   - usunąć `"opencode-mnemosyne"` z `plugin` w `opencode.json` i z `package.json`,
   - `docs/dev-guide.md`: zaktualizować sekcję Plugins (l. 43–47), Repository Layout
     (submoduł) i tabelę „Memory config” (l. 188); dodać krok budowania po aktualizacji
     submodułu,
   - `docs/memory-rules.md`: **bez zmian** (nazwy narzędzi zachowane).
7. **Weryfikacja end-to-end:** nowa sesja → `memory_recall` zwraca zmigrowane wspomnienie.
8. **Docelowo:** po merge'u i publikacji na npm — zastąpić submoduł + symlink wpisem
   `"opencode-mnemoteca@<wersja>"` (przypięty) w `plugin`.
9. **Rollback:** usunąć symlink `plugins/mnemoteca`; stara baza nietknięta. Backup i starą
   binarkę usunąć ręcznie po ~2 tygodniach stabilnej pracy.

## 8. Konsekwencje

- **+** Pamięć wraca na v2 bez zmiany reguł agentów i bez utraty danych; brak nowych usług w tle.
- **+** Port jest upstreamowalny i nie łamie użytkowników v1.
- **−** Do czasu merge'a utrzymujemy fork i krok budowania na każdej maszynie.
- **−** Instrukcja pamięci wstrzykiwana w każdej turze (koszt tokenów, ~kilkadziesiąt) zamiast
  tylko przy compaction.
- **Ryzyko:** API pluginów v2 jest młode (`@opencode/plugin` 2.0.x) — możliwe zmiany kontraktu
  `tool.transform`/`location`; łagodzone guardem i testami na fałszywym kontekście.
