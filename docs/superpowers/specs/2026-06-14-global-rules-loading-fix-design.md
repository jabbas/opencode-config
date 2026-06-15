# Spec: Naprawa globalnego ładowania reguł + czyszczenie duplikatów

Data: 2026-06-14
Status: do przeglądu

## Problem (odkrycie nt. mechanizmu ładowania)

`docs/global-rules.md` i `docs/memory-rules.md` są podpięte w `opencode.json`
przez `instructions` jako ścieżki **względne** (`"docs/global-rules.md"`). To
sprawia, że **NIE ładują się w normalnych projektach** — działają tylko gdy `cwd`
jest wewnątrz `~/.config/opencode` (albo gdy bieżący projekt ma własny
`docs/global-rules.md`).

Zweryfikowane w źródłach OpenCode:

- `config/config.ts:47` — `instructions` są scalane jako surowe stringi, BEZ
  absolutyzacji względem pliku configu, który je deklaruje.
- `session/instruction.ts:135-150` — ścieżki względne idą przez `relative()`.
- `session/instruction.ts:79-89` — `relative()` woła
  `globUp(instruction, ctx.directory, ctx.worktree)`.
- `core/fs-util.ts:162-176` — `globUp` szuka wzorca idąc **w górę od `cwd`** do
  `stop` (worktree). **Nie zagląda do `~/.config/opencode`.**
- Dla kontrastu `session/instruction.ts:115-120` — `AGENTS.md` jest ładowany
  przez `globalFiles` jako ścieżka **absolutna** (`Global.Path.config/AGENTS.md`),
  więc ładuje się ZAWSZE, niezależnie od `cwd`.

Skutek: reguły pamięci (`memory-rules.md`) oraz część reguł bezpieczeństwa i
operacyjnych (`global-rules.md`) są w praktyce **uśpione** poza repo configu.
Reguły bezpieczeństwa działają wszędzie tylko dlatego, że są **zduplikowane** w
`AGENTS.md` (który ładuje się globalnie).

Dodatkowo `global-rules.md` zawiera treść **przestarzałą**:
- sekcja „Available Agents" wymienia `designer` (przemianowany na `architect`)
  oraz `websearch` (usunięty) i dubluje aktualny „Agent Roster" z `AGENTS.md`;
- `memory-rules.md` → „Agent-specific rules" odwołuje się do `websearch`.

## Cel

Reguły pamięci i operacyjne mają działać **wszędzie**, niezależnie od katalogu
pracy. Usunąć duplikaty i przestarzałą treść. Pojedyncze źródło prawdy.

## Rozwiązanie

### 1. `opencode.json` — ścieżki instrukcji na absolutne

```json
"instructions": [
  "~/.config/opencode/docs/global-rules.md",
  "~/.config/opencode/docs/memory-rules.md"
]
```

`instruction.ts:138` rozwija `~/` do home → `path.isAbsolute` → glob w konkretnym
katalogu → oba pliki ładują się globalnie, niezależnie od `cwd`.

### 2. `global-rules.md` (2 989 → ~900 zn)

- **Usunąć „Hard Rules"** — kanoniczna kopia zostaje w `AGENTS.md`. Powód:
  `AGENTS.md` ładuje się przez `globalFiles` (ścieżka absolutna, zahardkodowana) —
  najbardziej odporny kanał. Treść krytyczna dla bezpieczeństwa nie powinna
  zależeć od poprawności `instructions` (właśnie zobaczyliśmy, jak łatwo to po
  cichu przestaje działać).
- **Usunąć „Available Agents"** — przestarzałe (designer/websearch) i dubluje
  aktualny „Agent Roster" w `AGENTS.md`.
- **Zostawić** „Filesystem Safety" + „Web Content Rules" (unikalne, behawioralne).

### 3. `memory-rules.md` (1 904 → ~1 850 zn)

- **Naprawić „Agent-specific rules"** — usunąć linię o `websearch` (usunięty
  agent). Reszta bez zmian.

### 4. `AGENTS.md` — bez zmian

„Global Hard Rules" zostaje jako jedyne, kanoniczne źródło reguł bezpieczeństwa.

## Efekt

- **Naprawiony bug:** memory-rules + filesystem/web rules realnie działają w
  każdym projekcie.
- **Usunięty duplikat** bezpieczeństwa (był w 2 miejscach) i przestarzała lista
  agentów.
- Oszczędność ~520 tok (global-rules schudło) — drugorzędne; głównie chodzi o
  poprawność.
- Pojedyncze źródło prawdy: bezpieczeństwo → `AGENTS.md`; reguły
  operacyjne/pamięci → `global-rules.md`/`memory-rules.md` (teraz globalne).

## Weryfikacja

- `jq '.instructions' opencode.json` — obie ścieżki z prefiksem `~/.config/...`.
- `global-rules.md` — brak sekcji „Hard Rules" i „Available Agents"; obecne
  „Filesystem Safety" + „Web Content Rules".
- `memory-rules.md` — brak odwołań do `websearch`.
- Brak innych przestarzałych odwołań: `grep -rn 'designer\|websearch'
  docs/global-rules.md docs/memory-rules.md` → puste.

## Poza zakresem (YAGNI)

- Bez przenoszenia treści do `AGENTS.md` (opcja B — odrzucona, re-pogrubiłaby plik
  wbrew #4).
- Bez zmian w treści reguł poza usunięciem duplikatów/przestarzałych odwołań.
