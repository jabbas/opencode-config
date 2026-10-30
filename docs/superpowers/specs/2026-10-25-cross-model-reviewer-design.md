# Cross-model reviewer — review kodu na innym modelu niż implementacja

- **Data:** 2026-10-25
- **Status:** zatwierdzony do planowania
- **Zakres:** repo `~/.config/opencode` (agent, reguły, lokalny skill, per-machine config)

## 1. Intencja (dlaczego)

Przy kodowaniu z superpowers implementację, review i weryfikację robi dziś ta sama
rodzina modeli (Anthropic: sonnet/opus). Użytkownik chce przenieść **review** na
model innego dostawcy z dwóch powodów:

1. **Główny: dywersyfikacja kosztów.** Rozłożyć obciążenie na więcej niż jedno
   konto/subskrypcję, żeby całość nie szła z jednego budżetu Anthropic.
2. **Drugorzędny: inny punkt widzenia.** Model z innej rodziny ma inne nawyki i
   inne ślepe plamki niż model, który pisał kod.

Nie ma problemu z jakością do naprawienia — dotychczasowe review niczego nie
przepuściło. To jest zmiana kosztowo-architektoniczna, nie gaszenie pożaru.

## 2. Stan obecny (zweryfikowany)

- `subagent-driven-development` (SDD) ma trzy punkty review: **task review** po
  każdym tasku (`task-reviewer-prompt.md`), **scoped re-review** po każdej rundzie
  poprawek (`re-review-prompt.md`) i **final whole-branch review**
  (`requesting-code-review/code-reviewer.md`). `requesting-code-review` każe
  dispatchować "general-purpose" subagenta → u nas `@general`.
- Szablony SDD wymagają jawnego `model:` przy dispatchu („an omitted model silently
  inherits the session's most expensive one”). W praktyce nic tego nie ustawia
  inaczej niż na model z rodziny Anthropic, więc review = ta sama rodzina co kod.
- Reviewer **przegląda testy TDD** codera: task review (Part 2 „Tests”: realne
  zachowanie, edge case'y; testy bez asercji = Important; warningi w outpucie =
  finding) i final review („Testing”). Reviewer celowo **nie** odpala ponownie
  suite'u — wolno mu jeden punktowy test przy konkretnej wątpliwości.
- `skill/autonomous-execution/SKILL.md` krok 5 VERIFY: „independent review by a
  different subagent (`@debugger` or `@coder` in code-review mode)”.
- `superpowers/` to **submoduł upstream** — nie modyfikujemy go (nadpisze się przy
  aktualizacji; upstream nie przyjmie zmian specyficznych dla naszego setupu).
- Dostępni dostawcy na prywatnej maszynie (z `opencode` models): `anthropic`,
  `kilo`, `opencode-go` (subskrypcja), `kimi-code-plan-global` (subskrypcja),
  `opencode` (darmowe). Na służbowej: `kilo` z modelami dostarczanymi przez firmę.

## 3. Cele, nie-cele, anty-cele

**Cele**
- Wszystkie review w procesie superpowers (task review, re-review, final review,
  ad-hoc `requesting-code-review`) oraz niezależna weryfikacja autopilota idą do
  jednego dedykowanego agenta `reviewer`.
- Model `reviewer` jest ustawiany **per maszyna** w `opencode.jsonc` — wspólny
  `opencode.json` pozostaje przenośny i nie zawiera modelu reviewera.
- Prywatna maszyna: review z subskrypcji Kimi. Służbowa: model z `kilo`.

**Nie-cele**
- Osobny agent QA piszący testy (rozważony i odłożony — patrz §7).
- Zmiany w submodule `superpowers/`.
- Zmiany roli `@debugger` — zostaje do diagnozy na żywych środowiskach.
- Zmiana modelu implementera/codera.

**Anty-cele (porażka, nawet jeśli „działa”)**
- Koordynator po cichu nadpisuje model reviewera parametrem `model:` przy
  dispatchu (np. sonnetem z szablonu SDD) — review wraca na Anthropic i nikt tego
  nie zauważa.
- Reviewer modyfikuje checkout (edycja plików, commit, zmiana brancha/indexu).
- Wpisanie modelu reviewera do wspólnego `opencode.json` (łamie przenośność między
  maszynami).

## 4. Decyzje (uzgodnione z użytkownikiem)

1. **Jeden nowy agent `reviewer`** przejmuje wszystkie role review. QA odpuszczone,
   bo reviewer już przegląda testy TDD.
2. **Model per maszyna** przez `agent.reviewer.model` w `opencode.jsonc`.
3. **Prywatna maszyna:** dostawca Kimi (`kimi-code-plan-global`).
4. **Służbowa maszyna:** model z `kilo` (konkretny model wybiera użytkownik na
   tamtej maszynie).
5. **Routing bez zmian w submodule:** reguła w naszym `AGENTS.md` + poprawka w
   lokalnym `skill/autonomous-execution/SKILL.md`.
6. **Dispatch do `@reviewer` bez parametru `model`** — model wynika z konfiguracji
   agenta na danej maszynie.
7. **Awaria modelu reviewera → fallback na `@general` (Anthropic) z jawnym wpisem**
   w ledgerze/raporcie; praca idzie dalej (szczegóły §5.3).

## 5. Projekt

```d2
direction: right

coord: Koordynator\n(sesja / autopilot)\nAnthropic
coder: "@coder / @general\n(implementer)\nAnthropic"
reviewer: "@reviewer\nmodel z opencode.jsonc\n(Kimi | kilo)"
cfg: opencode.jsonc\n(per maszyna, gitignored) {shape: page}

coord -> coder: brief taska\n(model wg SDD)
coder -> coord: raport + commity
coord -> reviewer: review package\n(BEZ parametru model)
reviewer -> coord: verdykty + findings
cfg -> reviewer: agent.reviewer.model {style.stroke-dash: 3}
```

### 5.1 Agent `reviewer`

**`agents/reviewer.md`** — prompt agenta (id = nazwa pliku):
- Rola: niezależny reviewer kodu. Wykonuje dokładnie szablon review podany w
  dispatchu (task review / re-review / final review); szablon jest źródłem procesu.
- Zakaz modyfikacji checkoutu (working tree, index, HEAD, branche) — spójne z
  szablonami.
- Zakaz dispatchowania subagentów (spójne z szablonami; i tak blokowane przez
  depth=1) oraz standardowa linia o zakazie self-dispatchu, jak w innych agentach.
- Odpowiedź końcowa = sam raport w formacie z szablonu.

**`opencode.json` → `agent.reviewer`** (bez `model`):
- `"mode": "all"` — wymagane, inaczej v2 potraktuje go jako primary i nie da się
  go dispatchować.
- `edit`/`write`: deny.
- `bash`: `"*": "deny"`, allow dla odczytu gita (`git diff *`, `git log *`,
  `git show *`, `git status *`, `git rev-parse *`, `git merge-base *`), `test`, `[`
  i **punktowych testów** (`pytest *`, `uv run pytest *`, `go test *`,
  `cargo test *`, `npm test *`, `pnpm test *`, `bun test *`); potem
  `"git *--output*": "deny"`, `"git *--no-index*": "deny"` i na końcu
  `"*>*": "deny"`. Reszta to `deny`, nie `ask` — autopilot działa bez człowieka i
  `ask` by go zawiesił. *Po final review:* bez `ls`/`cat`/`head` — nadpisywały globalne
  deny na sekrety, a argumentów shella nie obejmuje `external_directory`; pliki
  reviewer czyta narzędziami read/grep/glob. `--output` zapisuje plik bez `>`,
  `--no-index` czyta dowolny plik.
- `tools`: `{"memory_*": false}` — brak narzędzi pamięci (Mnemoteca); dane trafiałyby
  do zewnętrznego dostawcy, a kontekst i tak przychodzi z szablonu review. W v2 to
  reguła permission `deny` (ukrywa i blokuje). *[decyzja użytkownika 2026-10-28]*
- `tools`: też `websearch`, `opencode_session_rename`, `opencode_session_move`,
  `opencode_worktree_create` = `false` — bez wyszukiwania w sieci i bez narzędzi
  OpenCode zmieniających stan (id = `<namespace>_<name>`; działa też w code mode).
  `worktree_remove` blokuje już `edit: deny` (jego uprawnienie to `edit`). Narzędzia
  read-only (`models`, `worktree_list`) zostają; `opencode_list_mcp_resources` i
  `opencode_read_mcp_resource` też `false` — dane MCP trafiałyby do zewnętrznego
  dostawcy (2026-10-30). *[decyzja użytkownika 2026-10-28, 2026-10-30]*
- `task`: standardowa reguła `{"*": "allow", "autopilot": "deny", "reviewer": "deny"}`.
- `skill`: `{"*": "deny"}` — cały proces przychodzi w prompcie z szablonu.
- `external_directory`: `deny` — reviewer czyta tylko w katalogu sesji (repo /
  worktree). `deny` zamiast `ask`, żeby nie zawiesić autopilota promptem; review
  poza katalogiem kończy się jawnym błędem, a nie cichym zawisem. Koordynator SDD
  pracujący w worktree dispatchuje review z sesji przeniesionej do worktree
  (`session_move`). `git worktree add` (sugerowane w `code-reviewer.md`) pozostaje
  zablokowane allowlistą bash. *[decyzja architekta]*
- **Permission-model plugin:** dopisać `reviewer` do `restrictedAgents` w
  `plugins/permission-model/config.js`, żeby po przejściu na `enforce` agent nie
  dostał szerszych reguł niż tu. Edycja na kopii — plugin hot-reloaduje serwer
  (patrz `docs/dev-guide.md`). *[decyzja architekta]*

### 5.2 Model per maszyna

- **Prywatna** (`opencode.jsonc`): `"reviewer": { "model": "kimi-code-plan-global/k3.1-pro-highspeed" }`.
- **Służbowa** (aktywny wariant `opencode.kilocode.json` / `opencode.jsonc` na
  tamtej maszynie): `"reviewer": { "model": "kilo/<model>" }`. Rekomendacja:
  `kilo/openai/gpt-6.1-sol` lub `kilo/google/gemini-4-argon` (inna rodzina niż w
  domu = więcej różnorodności). **Wpisuje użytkownik na służbowej maszynie** — z tej
  maszyny pliku nie widać.
- **Wariant `opencode.jsonc.kimi`** (wszystko na Kimi): tam rodziny się
  odwracają — `"reviewer": { "model": "anthropic/claude-sonnet-5-5" }`, żeby review
  nadal szło z innej rodziny i innego konta niż implementacja. Poprawić martwe
  identyfikatory: `architect` i `debugger` → `kimi-code-plan-global/k3.1-pro-highspeed`
  (dostawca udostępnia dziś tylko `kimi-for-coding` i `k3.1-pro-highspeed`).
  Pliku nie przemianowujemy ani nie dopisujemy do `.gitignore` (poza zakresem;
  użytkownik wie, że jest nieśledzony). *[decyzja architekta]*
- **Fallback:** maszyna bez `agent.reviewer.model` → agent dziedziczy model
  rodzica (zachowanie jak dziś). Degradacja łagodna, nie awaria.

### 5.3 Routing review do `@reviewer`

**`AGENTS.md`** — nowa krótka sekcja w „Delegation Rules (All Agents)”:
- Każdy dispatch review kodu — task review i scoped re-review z SDD, final
  whole-branch review, `requesting-code-review`, niezależna weryfikacja autopilota —
  idzie do `@reviewer`, nie do `general`/`coder`/`debugger`. Tam, gdzie szablon
  superpowers mówi „Subagent (general-purpose)” dla review, czytamy to jako
  `@reviewer`.
- **Nie podawaj parametru `model`** przy dispatchu `@reviewer`, nawet gdy szablon
  SDD ma pole `model: [MODEL — REQUIRED]` — model reviewera wynika z konfiguracji
  maszyny. (Reguła „Model Selection” z SDD nadal obowiązuje dla implementerów.)
- **Awaria modelu reviewera w trakcie pracy** (wyczerpany limit, rate limit,
  dostawca niedostępny, błąd dispatchu `@reviewer`) → **fallback na Anthropic z
  jawnym wpisem** *(decyzja użytkownika)*: koordynator powtarza ten sam dispatch
  review na `@general` (model wg SDD Model Selection) i zapisuje to w ledgerze SDD
  jako `Ruling: review <etap/task N> on @general — reviewer model unavailable
  (<błąd>) — same-family review` oraz w raporcie końcowym (sekcja „Rulings I made”
  w SDD / raport audytu autopilota). Bez retry, bez zatrzymywania pracy. Fallback
  dotyczy pojedynczego dispatchu — następne review znowu próbuje `@reviewer`.
- **Jeden poziom review.** `@reviewer` świadomie zastępuje tiering z SDD dla
  review (najmocniejszy model na final, tańszy na re-review) — wszystkie review
  idą na jeden model per maszyna. Na prywatnej to subskrypcja, więc koszt per
  review nie gra roli; drugi agent (`reviewer-final`) dopiero, jeśli final review
  okaże się za słabe. *[decyzja architekta]*
- Wpis w „Agent Roster”: `reviewer` — code review na innym modelu (per maszyna),
  read-only.

**`skill/autonomous-execution/SKILL.md`**:
- Krok 5 VERIFY: `@debugger` / `@coder` → `@reviewer` (bez parametru `model`);
  przy awarii modelu reviewera fallback na `@general` z wpisem w raporcie audytu
  (jak w regule `AGENTS.md`).
- Lista specjalistów w kroku 4 (linia „Available specialists”): dodać `@reviewer`.

**`docs/dev-guide.md` / `README.md`**: jeśli zawierają listę agentów lub opis
warstwy modeli per maszyna — dopisać `reviewer` i `agent.reviewer.model`.

### 5.4 Wykrywanie cichego fallbacku (po teście E2E 2026-10-27)

**Ustalenie:** nieistniejący/wycofany id w `agent.reviewer.model` (test:
`kimi-code-plan-global/does-not-exist`) **nie daje błędu** — agent po cichu działa na
modelu domyślnym (`anthropic/claude-sonnet-5-5`), bez WARN/ERROR w logu. Fallback z §5.3
(oparty na błędzie dispatchu) tego nie łapie; review byłoby same-family bez śladu.

**Poprawki:**
- `agents/reviewer.md`: pierwsza linia każdego raportu to
  `Model: <providerID>/<modelID>` (z sekcji „Your Model” własnego system promptu;
  `Model: unknown`, gdy niewidoczny) — jedyny wyjątek od formatu szablonu.
- `AGENTS.md` (reguła „Code review → `@reviewer`”) + krok 5 VERIFY w
  `skill/autonomous-execution/SKILL.md`: koordynator czyta linię `Model:`; brak /
  `unknown` / ta sama rodzina co implementer (rodzina, nie dostawca —
  `kilo/anthropic/…` to Claude) → `Ruling: review <etap/task N> same-family (<model>)
  — reviewer model not applied — same-family review` w ledgerze / raporcie audytu.
- `README.md` („Verifying the setup”): kontrola konfiguracji poniżej (§6).

## 6. Weryfikacja (do uruchomienia przez buildera / użytkownika)

- `bash scripts/check-skill-whitelists.sh` — zero `[FAIL]`; nowe `[INFO]` orphany
  zgłosić użytkownikowi (wymóg `AGENTS.md`).
- Agent widoczny jako subagent (`mode: all`) i dispatch `@reviewer` działa.
- **Kluczowy test:** dispatch `@reviewer` bez `model` → w logach/sesji widać model
  z `opencode.jsonc` (prywatnie: `kimi-code-plan-global/k3.1-pro-highspeed`), a nie
  model rodzica. Potwierdza, że model agenta wygrywa przy pominiętym parametrze.
- `@reviewer` dostaje odmowę na edycję pliku i na `git commit`/`git checkout`.
- Błędny id modelu (tymczasowo w `opencode.jsonc`, zweryfikowane 2026-10-28):
  dispatch `@reviewer` **kończy się sukcesem** na modelu domyślnym; linia `Model:`
  raportu pokazuje rodzinę domyślną → koordynator zapisuje Ruling „reviewer model not
  applied” (§5.4); przywrócić poprawny id po teście. Fallback na `@general` przy
  prawdziwym błędzie dostawcy (limit, rate limit, awaria) — **nieprzetestowany**.
- Krótki run SDD na małym planie (lub ręczny dispatch szablonu task review) →
  raport w formacie szablonu, z modelu Kimi.
- Kontrola konfiguracji po ustawieniu/zmianie `agent.reviewer.model` (README,
  „Verifying the setup”): `opencode run --standalone --agent reviewer "Reply with OK"`
  → nagłówek pokazuje model reviewera z `opencode.jsonc`, nie domyślny (zwłaszcza
  id `kilo/…` na maszynie służbowej).

## 7. Rozważone i odrzucone / odłożone

- **Osobny agent `qa` piszący testy** (niezależna warstwa testów albo podział TDD:
  qa pisze red, coder green). Odłożone: reviewer już przegląda testy TDD, a
  `writing-plans` i tak projektuje testy w planie, więc qa w dużej mierze by je
  przepisywał. Wrócić, jeśli review zacznie przepuszczać słabe testy.
- **Parametr `model` przy dispatchu zamiast agenta** — model zaszyty w promptach
  i regułach, nieprzenośny między maszynami, łatwy do pominięcia.
- **Plugin przepisujący model w locie** (wykrywanie dispatchu review po treści
  promptu) — kruche, nieczytelne.
- **Zmiana szablonów w submodule `superpowers/`** — nadpisywane przy aktualizacji.

## 8. Pozostawione builderowi

- Dokładna treść promptu `agents/reviewer.md` (zgodnie z §5.1).
- Dokładne miejsce i brzmienie sekcji w `AGENTS.md` (krótko — plik jest
  odchudzany, patrz spec `2026-06-14-agents-md-slimming-design.md`).
- Czy dopisywać `reviewer` w `README.md` / `docs/dev-guide.md`, zależnie od tego,
  czy zawierają odpowiednie listy.
