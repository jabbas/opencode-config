# Spec: Odchudzenie AGENTS.md (relokacja treści referencyjnej do dev-guide)

Data: 2026-06-14
Status: do przeglądu

## Problem

AGENTS.md (13 334 znaki ≈ **3 334 tokeny**) jest wstrzykiwany do system promptu
**każdego** z 16 agentów przy **każdym** wywołaniu. Zweryfikowane w źródłach
OpenCode:

- `session/instruction.ts:155` — `Instruction.system()` nie przyjmuje parametru
  agenta; czyta globalny `AGENTS.md` + `config.instructions` i wstrzykuje je
  identycznie wszystkim agentom. **Nie istnieje per-agent scoping AGENTS.md** (w
  przeciwieństwie do skilli, gdzie `permission.skill` filtruje per-agent).
- `session/prompt.ts:1327-1333` — `instructions` są stałą częścią `system`.

Po wcześniejszej optymalizacji skilli (per-agent whitelisty) AGENTS.md jest
największym pozostałym kosztem stałym promptu. Połowa jego treści (style kodu,
komendy testów, layout katalogów, error patterns) to materiał referencyjny
potrzebny wyłącznie agentom edytującym TEN repozytorium (`coder`, `general`,
`skill-smith`) — a wożą go wszyscy, łącznie z `ha`, `webscraper`, `webmonitor`.

## Dlaczego nie skill (odrzucone podejście C)

Rozważano przeniesienie treści do skilla project-scoped w
`~/.config/opencode/.opencode/skill/`. Odrzucone — zweryfikowane w źródłach:

- `config/paths.ts:26` — `config.directories()` zawsze zwraca `Global.Path.config`
  (= `~/.config/opencode`).
- `skill/index.ts:205-208` — każdy katalog z `config.directories()` jest skanowany
  wzorcem `OPENCODE_SKILL_PATTERN = "{skill,skills}/**/SKILL.md"`.

Wniosek: ponieważ TEN repozytorium **jest** katalogiem global config OpenCode,
dowolny skill w nim umieszczony jest wykrywany **globalnie, w każdej sesji** —
project-scoping (`fsys.up` od `cwd`) działa tylko dla `.opencode` napotkanych w
górę od bieżącego katalogu pracy, a przy pracy w innym projekcie `cwd` wskazuje
tamten projekt. Nie da się mieć skilla „tylko dla tego repo", gdy to repo to
`~/.config/opencode`. Skill globalny obciążałby `coder`/`general`/`skill-smith`
(~135 tok) w każdym projekcie. Dlatego: zwykły plik, nie skill.

## Rozwiązanie

Rozdzielić AGENTS.md na:

1. **Rdzeń** (zostaje w AGENTS.md, globalny, ~1 050 tok) — to, co każdy agent musi
   widzieć zawsze.
2. **`docs/dev-guide.md`** (nowy plik, on-demand) — materiał referencyjny czytany
   narzędziem `Read` tylko wtedy, gdy agent edytuje ten repozytorium. NIE jest
   skillem. Zero kosztu tokenowego dopóki nieotwarty.

### ZOSTAJE w AGENTS.md (rdzeń, cel ~4 200 znaków / ~1 050 tok)

- **Global Hard Rules (All Agents)** — bez zmian (bezpieczeństwo, krytyczne).
- **Agent Roster** — bez zmian (potrzebne do delegacji).
- **Per-Agent Skill Whitelists** — skrócone z 1 442 → ~400 zn: 3 zdania
  (mechanizm + „tylko deny oszczędza" + „brak skilla → delegacja") + link do
  `docs/superpowers/specs/2026-06-13-agent-skill-optimization-design.md`.
- **Skill Resolution & Invocation** — bez zmian (świeżo poprawione).
- **Repository Layout** — skrócony z 2 379 → ~350 zn: 3–4 kluczowe linie + „pełne
  drzewo → docs/dev-guide.md".
- **Nowa sekcja „Working in This Repo"** — imperatywny wskaźnik: „Edytujesz
  `superpowers.js`, skille, agenty lub skrypty shell w tym repo? Przeczytaj
  `docs/dev-guide.md` PRZED zmianą — zawiera styl kodu, konwencje nazewnictwa,
  komendy testów i layout."

### WYCHODZI do `docs/dev-guide.md` (relokacja 1:1, bez zmian treści)

- Repository Layout (pełne drzewo katalogów)
- Build / Lint / Test Commands (wszystkie pod-sekcje)
- Code Style Guidelines (JavaScript / Bash / SKILL.md / Agent Definition / Naming)
- Configuration: opencode.json (szczegóły)
- Error Handling Patterns
- Key Files for Agents
- Superpowers Skills (lista 14)

## Przepływ działania agenta

Agent kodowy edytujący repo → widzi w rdzeniu AGENTS.md sekcję „Working in This
Repo" → wykonuje `Read docs/dev-guide.md` → ma pełne wytyczne. Agenci nie-kodowi
(`ha`, `web*`, `architect`) → nigdy nie czytają pliku, nie płacą tokenami.

## Efekt

- AGENTS.md: ~3 334 → ~1 050 tok → **oszczędność ~2 280 tok × 16 agentów × każde
  wywołanie**.
- Zero ryzyka globalnego skilla odpalającego się w cudzych projektach.
- Treść nie ginie — przeniesiona 1:1, jedynie w innym pliku.

## Ryzyka i mitygacje

- **Agent nie sięgnie do dev-guide.md** jeśli wskaźnik będzie zbyt słaby →
  mitygacja: wyraźny, imperatywny wskaźnik z konkretnymi wyzwalaczami
  („edytujesz X → przeczytaj Y PRZED zmianą"), umieszczony blisko góry rdzenia.
- **Dryf między AGENTS.md a dev-guide.md** (duplikacja Repository Layout w obu) →
  mitygacja: w rdzeniu tylko 3–4 linie + jawny link; pełna wersja wyłącznie w
  dev-guide.

## Weryfikacja

- Po implementacji: `wc -c AGENTS.md` — cel ≤ ~4 500 znaków.
- `wc -c docs/dev-guide.md` — powinien zawierać przeniesione sekcje.
- Sprawdzić, że żadna treść nie zniknęła: suma sekcji przed ≈ rdzeń + dev-guide.
- Brak nowego pliku SKILL.md (to ma być zwykły `.md`, nie skill).

## Poza zakresem (YAGNI)

- Bez zmian w `docs/global-rules.md` / `docs/memory-rules.md` (osobny potencjalny
  temat: ~1 223 tok łącznie).
- Bez nowego skilla.
- Bez zmian w treści samych wytycznych (tylko relokacja).
