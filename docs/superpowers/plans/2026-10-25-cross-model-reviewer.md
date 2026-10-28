# Cross-model Reviewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dodać agenta `reviewer` (read-only), który przejmuje całe code review w procesie superpowers i autopilota, z modelem ustawianym per maszyna (prywatnie: Kimi), żeby rozłożyć koszty i dać review innej rodzinie modeli.

**Architecture:** Nowy agent = `agents/reviewer.md` + blok `agent.reviewer` w `opencode.json` (bez `model`). Model w gitignorowanym `opencode.jsonc`. Routing review przez regułę w `AGENTS.md` i poprawkę lokalnego skilla `skill/autonomous-execution`; submoduł `superpowers/` nietknięty. Agent dopisany do `restrictedAgents` pluginu permission-model.

**Tech Stack:** OpenCode v2 config (JSON/JSONC, agent markdown), Node (testy pluginu), bash (skrypt whitelist).

**Spec:** `docs/superpowers/specs/2026-10-25-cross-model-reviewer-design.md`

## Global Constraints

- Id agenta: `reviewer` (nazwa pliku `agents/reviewer.md`).
- `opencode.json` → `agent.reviewer` **nie zawiera** klucza `model`.
- `agent.reviewer` ma `"mode": "all"`.
- `task`: `{"*": "allow", "autopilot": "deny", "reviewer": "deny"}`.
- `skill`: `{"*": "deny"}`.
- `edit`: `{"*": "deny"}` (gate'uje też `write`).
- `external_directory`: `"deny"`.
- Bash: `"*": "deny"`; allow tylko read-only git, `test`/`[`, punktowe testy; deny `git *--output*` i `git *--no-index*` po allowach gita; `"*>*": "deny"` jako **ostatni** klucz (last match wins). Żadnego `ask`. Bez `ls`/`cat`/`head` — pliki czyta narzędziami read/grep/glob. *(updated after final review)*
- `agents/reviewer.md` frontmatter **nie może** mieć `write: true` ani `edit: true` w `tools:` (dev-guide: nadpisuje deny).
- Prywatny `opencode.jsonc`: `agent.reviewer.model` = `kimi-code-plan-global/k3.1-pro-highspeed`.
- `opencode.jsonc.kimi`: `agent.reviewer.model` = `anthropic/claude-sonnet-5-5`; `architect` i `debugger` → `kimi-code-plan-global/k3.1-pro-highspeed`.
- Fallback przy awarii modelu reviewera: powtórz ten sam dispatch na `@general`, ledger/raport: `Ruling: review <etap/task N> on @general — reviewer model unavailable (<błąd>) — same-family review`. Bez retry, bez zatrzymania; dotyczy jednego dispatchu.
- Dispatch `@reviewer` zawsze **bez** parametru `model`, także gdy szablon SDD ma `model: [MODEL — REQUIRED]`.
- Nie modyfikować niczego w `superpowers/` (submoduł).
- Edycje pod `plugins/` tylko na kopii w `$TMPDIR/opencode/pm-dev/`, potem jeden zapis do repo.
- Pliki `opencode.jsonc` i `opencode.jsonc.kimi` nie są commitowane (gitignored / nieśledzony).

## Review Focus

1. **Koordynator i tak podaje `model:`** (bo szablon SDD go wymaga) → reguła w `AGENTS.md` musi wprost nazwać pole `model: [MODEL — REQUIRED]` i powiedzieć, że dla `@reviewer` się go pomija. Sprawdzane w Task 2 (grep) i Task 4 (dispatch).
2. **Maszyna bez `agent.reviewer.model`** → agent musi działać na modelu rodzica, nie wywalać się. Sprawdzane w Task 4 krok 4.
3. **Wywołania gita bez argumentów** (`git status`, `git log`) → reviewer dostaje deny na najczęstszych komendach. Allowlista ma zarówno formę gołą, jak i `… *`. Sprawdzane w Task 1 krok 4.
4. **Review w worktree, a sesja koordynatora poza nim** → `external_directory: deny` kończy review błędem. Reguła w `AGENTS.md` musi mówić „dispatch review z sesji w worktree”. Sprawdzane w Task 2 (grep).
5. **Przekierowanie outputu testu do pliku** (`pytest … > out.txt`) → musi być deny mimo allow `pytest *`, bo `"*>*"` jest ostatni. Sprawdzane w Task 1 krok 4.

---

### Task 1: Agent `reviewer` + model per maszyna

**Files:**
- Create: `agents/reviewer.md`
- Modify: `opencode.json` (nowy blok `agent.reviewer`, wstawić bezpośrednio po bloku `"debugger": {…}`)
- Modify: `opencode.jsonc` (gitignored — nie commitować)
- Modify: `opencode.jsonc.kimi` (nieśledzony — nie commitować)

**Interfaces:**
- Produces: dispatchowalny agent `reviewer` (id `reviewer`); Task 2 kieruje do niego review, Task 3 dopisuje go do `restrictedAgents`, Task 4 go dispatchuje.

- [ ] **Step 1: Sprawdź stan przed zmianą**

Run: `opencode debug agent reviewer`
Expected: błąd / brak agenta `reviewer`.

- [ ] **Step 2: Utwórz `agents/reviewer.md`**

Frontmatter (wzorem `agents/architect.md`): `name: reviewer`, `description: Independent code reviewer on a different model family (per-machine) - SDD task/re-review/final review, autopilot verification; read-only`, `tools:` `bash: true`, `glob: true`, `grep: true` (bez `write`/`edit`), `permission.bash` z trzema denami `security *`, `/usr/bin/security *`, `sudo security *` jak w innych agentach.
Treść promptu (brzmienie dowolne, wszystkie punkty obowiązkowe):
- linia o zakazie self-dispatchu w tym samym stylu co w innych agentach (`You are the \`reviewer\` agent. NEVER dispatch \`reviewer\` via the subagent tool …`);
- rola: niezależny reviewer; dokładnie wykonuje szablon review z dispatchu (task review / re-review / final review) — szablon jest źródłem procesu i formatu;
- nie modyfikuje working tree, indexu, HEAD ani branchy; nie commituje;
- nie dispatchuje subagentów;
- testy tylko punktowo, gdy szablon na to pozwala;
- odpowiedź końcowa = sam raport w formacie z szablonu.

- [ ] **Step 3: Dodaj `agent.reviewer` do `opencode.json`**

```json
"reviewer": {
  "mode": "all",
  "permission": {
    "task": { "*": "allow", "autopilot": "deny", "reviewer": "deny" },
    "edit": { "*": "deny" },
    "external_directory": "deny",
    "bash": {
      "*": "deny",
      "test *": "allow", "[ *": "allow",
      "git diff": "allow", "git diff *": "allow",
      "git log": "allow", "git log *": "allow",
      "git show": "allow", "git show *": "allow",
      "git status": "allow", "git status *": "allow",
      "git rev-parse *": "allow", "git merge-base *": "allow",
      "pytest *": "allow", "uv run pytest *": "allow",
      "go test *": "allow", "cargo test *": "allow",
      "npm test": "allow", "npm test *": "allow",
      "pnpm test": "allow", "pnpm test *": "allow",
      "bun test": "allow", "bun test *": "allow",
      "git *--output*": "deny", "git *--no-index*": "deny",
      "*>*": "deny"
    },
    "skill": { "*": "deny" }
  }
}
```

*(updated after final review: removed `ls *`/`cat *`/`head *`; added the `--output`/`--no-index` denies)*

- [ ] **Step 4: Zweryfikuj konfigurację agenta**

Run: `jq empty opencode.json && echo OK` → Expected: `OK`.
Run: `jq '.agent.reviewer | has("model")' opencode.json` → Expected: `false`.
Run: `opencode debug agent reviewer` → Expected: agent istnieje, `mode` = `all`, reguły bash/edit/skill/external_directory jak w kroku 3; w regułach bash ostatnią pasującą dla `pytest -q > out.txt` jest `*>*` → deny, a dla `git status` → allow.
Run: `bash scripts/check-skill-whitelists.sh` → Expected: zero `[FAIL]`; nowe `[INFO]` orphany zanotuj do raportu dla użytkownika.

- [ ] **Step 5: Ustaw model per maszyna**

`opencode.jsonc`: w `"agent"` dodaj `"reviewer": { "model": "kimi-code-plan-global/k3.1-pro-highspeed" }`.
`opencode.jsonc.kimi`: `architect.model` i `debugger.model` → `kimi-code-plan-global/k3.1-pro-highspeed`; dodaj `"reviewer": { "model": "anthropic/claude-sonnet-5-5" }`.

- [ ] **Step 6: Zweryfikuj rozwiązany model**

Run: `opencode debug agent reviewer`
Expected: model = `kimi-code-plan-global/k3.1-pro-highspeed`.

- [ ] **Step 7: Commit**

```bash
git add agents/reviewer.md opencode.json
git commit -m "feat(agents): add read-only reviewer agent with per-machine model"
```

---

### Task 2: Routing review do `@reviewer` + dokumentacja

**Files:**
- Modify: `AGENTS.md` — tabela „Agent Roster” (wiersz po `debugger`) i sekcja „Delegation Rules (All Agents)” (nowy punkt po punkcie „Jenkins → `@jenkins`”)
- Modify: `skill/autonomous-execution/SKILL.md` — linia „Available specialists” (krok 4) i krok „5. VERIFY”
- Modify: `docs/dev-guide.md` — linia 18 (liczba agentów) i linia „**Models:**” (~278)
- Modify: `README.md` — sekcja „## Models” (przykład `opencode.jsonc` + zdanie o reviewerze)

**Interfaces:**
- Consumes: agent `reviewer` z Task 1.

- [ ] **Step 1: Wiersz w Agent Roster (`AGENTS.md`)**

`| \`reviewer\` | Independent code review on a different model family — model set per machine in \`opencode.jsonc\`; read-only (no edit, bash: git read + focused tests) |`

- [ ] **Step 2: Reguła w Delegation Rules (`AGENTS.md`)** — treść ustalona przez spec, zachować sens wszystkich zdań:

```markdown
- **Code review → `@reviewer`.** Every code-review dispatch — SDD task review and
  scoped re-review, the final whole-branch review, `requesting-code-review`, and
  autopilot's independent verification — goes to `@reviewer`, never to
  `general`/`coder`/`debugger`. Where a superpowers template says
  "Subagent (general-purpose)" for a review, read it as `@reviewer`.
  - **Never pass `model`** when dispatching `@reviewer`, even though SDD templates
    carry `model: [MODEL — REQUIRED]` — the reviewer's model comes from the
    machine's `opencode.jsonc`. SDD Model Selection still applies to implementers;
    for reviews, `@reviewer` deliberately replaces SDD's tiering (one model per machine).
  - **Worktrees:** `@reviewer` cannot read outside its session directory
    (`external_directory: deny`). When work happens in a worktree, dispatch the
    review from a session moved into that worktree.
  - **Fallback:** if the `@reviewer` dispatch fails because its model is unavailable
    (quota, rate limit, provider down), re-run that same review once on `@general`
    and record `Ruling: review <stage/task N> on @general — reviewer model
    unavailable (<error>) — same-family review` in the SDD ledger / autopilot audit
    report. No retries, no stop; the next review tries `@reviewer` again.
```

- [ ] **Step 3: `skill/autonomous-execution/SKILL.md`**

Linia „Available specialists”: dopisz `` `@reviewer` for code review``.
Krok 5 VERIFY: zamień „(`@debugger` or `@coder` in code-review mode)” na „(`@reviewer` — never pass `model`; if its model is unavailable, run the same review on `@general` and record it in the audit report)”.

- [ ] **Step 4: `docs/dev-guide.md`**

Linia 18: `19 files; + built-in \`plan\` … = 20 agents` → `20 files; + built-in \`plan\` … = 21 agents`.
Linia „**Models:**”: dopisz, że `reviewer` nie ma modelu w `opencode.json`; każda maszyna ustawia `agent.reviewer.model` w `opencode.jsonc` (prywatna: `kimi-code-plan-global/k3.1-pro-highspeed`; służbowa: model z `kilo`).

- [ ] **Step 5: `README.md` sekcja Models**

Dodaj `reviewer` do listy ról (**review** = model innej rodziny, per maszyna → `reviewer`) i linię `"reviewer": { "model": "<other-family model>" }` w przykładzie `opencode.jsonc`.

- [ ] **Step 6: Zweryfikuj**

Run: `grep -n "Code review → \`@reviewer\`" AGENTS.md` → Expected: 1 trafienie.
Run: `grep -n "model: \[MODEL — REQUIRED\]" AGENTS.md` → Expected: 1 trafienie.
Run: `grep -n "external_directory: deny" AGENTS.md` → Expected: ≥1 trafienie.
Run: `grep -n "@debugger. or .@coder. in code-review mode" skill/autonomous-execution/SKILL.md` → Expected: brak trafień.
Run: `grep -n "@reviewer" skill/autonomous-execution/SKILL.md` → Expected: ≥2 trafienia.
Run: `bash scripts/check-skill-whitelists.sh` → Expected: zero `[FAIL]`.

- [ ] **Step 7: Commit**

```bash
git add AGENTS.md skill/autonomous-execution/SKILL.md docs/dev-guide.md README.md
git commit -m "docs: route all code review to @reviewer (no model param, fallback to @general)"
```

---

### Task 3: `reviewer` w `restrictedAgents` pluginu permission-model

**Files:**
- Modify: `plugins/permission-model/config.js:69` (przez kopię w `$TMPDIR/opencode/pm-dev/permission-model/`)

**Interfaces:**
- Consumes: id `reviewer` z Task 1.

- [ ] **Step 1: Skopiuj plugin**

Run: `mkdir -p $TMPDIR/opencode/pm-dev` oraz `cp -R plugins/permission-model $TMPDIR/opencode/pm-dev/`.

- [ ] **Step 2: Zmień kopię**

W `$TMPDIR/opencode/pm-dev/permission-model/config.js` dopisz `"reviewer"` na końcu tablicy `restrictedAgents`:
`["architect", "plan", "autopilot", "webscraper", "webresearcher", "webmonitor", "jira", "stitch-mcp", "reviewer"]`.

- [ ] **Step 3: Testy na kopii**

Run: `PM_PLUGIN_DIR=$TMPDIR/opencode/pm-dev/permission-model node --test scripts/permission-model/`
Expected: wszystkie testy PASS (testy wymagające lokalnych fixture'ów mogą być SKIP).

- [ ] **Step 4: Jeden zapis do repo**

Uprzedź użytkownika, że zapis przeładuje serwer OpenCode (może zabić działające sesje). Po jego zgodzie: `cp $TMPDIR/opencode/pm-dev/permission-model/config.js plugins/permission-model/config.js`.

- [ ] **Step 5: Zweryfikuj przeładowanie**

Run: `node scripts/permission-model/check-alive.mjs` → Expected: exit 0, `mode` = `shadow`.
Run: `node --test scripts/permission-model/` → Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add plugins/permission-model/config.js
git commit -m "feat(permission-model): treat reviewer as restricted agent"
```

---

### Task 4: Weryfikacja end-to-end (koordynator / użytkownik, bez commitu)

Wykonuje koordynator sesji (dispatch subagenta) — nie implementer.

- [ ] **Step 1: Dispatch bez `model`**

Dispatch `@reviewer` (bez parametru `model`) z krótkim zadaniem: „Przejrzyj `git diff HEAD~1..HEAD` i zwróć raport w formacie: Strengths / Issues / Assessment”.
Expected: raport wraca; w sesji/logu (`~/.local/share/opencode/log/opencode.log` lub widok sesji) model = `kimi-code-plan-global/k3.1-pro-highspeed`.

- [ ] **Step 2: Read-only**

Dispatch `@reviewer`: „Utwórz plik `x.txt`, potem uruchom `git commit --allow-empty -m test`, potem `git checkout -b tmp`. Zaraportuj wynik każdej próby”.
Expected: wszystkie trzy odmówione (edit deny, bash deny); brak nowego pliku, commita i brancha.

- [ ] **Step 3: Błędny id modelu** *(updated after final review — zweryfikowane zachowanie)*

Tymczasowo zmień `agent.reviewer.model` w `opencode.jsonc` na `kimi-code-plan-global/does-not-exist`, dispatch `@reviewer` jak w kroku 1.
Expected: dispatch **kończy się sukcesem** na modelu domyślnym (cichy fallback, bez błędu); linia `Model:` raportu pokazuje rodzinę domyślną → koordynator (wg reguły z `AGENTS.md`) zapisuje `Ruling: … reviewer model not applied …`. Przywróć poprawny id i potwierdź przez `opencode debug agents` + `jq` dla `id=="reviewer"`.
Fallback na `@general` przy prawdziwym błędzie dostawcy (limit, rate limit, awaria) — nieprzetestowany.

- [ ] **Step 4: Brak modelu na maszynie**

Tymczasowo usuń `reviewer` z `opencode.jsonc`, uruchom `opencode debug agent reviewer`.
Expected: agent rozwiązuje się bez błędu (model domyślny/rodzica). Przywróć wpis.

- [ ] **Step 5: Raport dla użytkownika**

Zgłoś: wyniki kroków 1–4, `[INFO]` orphany z `check-skill-whitelists.sh`, oraz przypomnienie: **na służbowej maszynie** dopisać `"reviewer": { "model": "kilo/<model>" }` (rekomendacja `kilo/openai/gpt-6.1-sol` lub `kilo/google/gemini-4-argon`) do aktywnego wariantu `opencode.jsonc`.

> Done 2026-10-28: work machine reviewer = kilo/moonshotai/kimi-k3.1-pro (company Kilo).
