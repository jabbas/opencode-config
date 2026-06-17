# Spec: Agent autonomiczny `autopilot`

Data: 2026-06-14
Status: do przeglądu

## Cel

Agent, któremu użytkownik zleca **dowolne** zadanie, a on realizuje je
end-to-end **bez interakcji** — z dwoma wyjątkami (rzadkie STOP-y). Tylko
użytkownik może go uruchomić; żaden inny agent nie może go odpalić dyspozytorsko.

## Polityka zachowania (decyzje z brainstormingu)

| Wymiar | Decyzja |
|---|---|
| Domena | Cokolwiek |
| Bezpieczeństwo | Autonomia; **twardy STOP** tylko przy operacjach nieodwracalnych/niebezpiecznych |
| Niejednoznaczność | Research → rozsądne założenia + dokumentuj → **STOP** tylko gdy nieusuwalna |
| Weryfikacja | subagenci stosują TDD/self-review; autopilot zleca **niezależny przegląd** innemu subagentowi i decyduje o „gotowe" (verification-before-completion) |
| Wykonanie | **Czysty orkiestrator** — opus MYŚLI, subagenci (sonnet i in.) WYKONUJĄ |
| Przebieg | Foreground (na żywo) + **zawsze plik-audyt** (plan + raport) |
| Uruchamianie | **Tylko użytkownik** — `mode: "primary"` (niewywoływalny przez Task) |

### Podział pracy: opus myśli, subagenci wykonują (KLUCZOWE)

`autopilot` (opus) jest **wyłącznie mózgiem**: rozumie zadanie, projektuje,
planuje, decyduje, ocenia wyniki, raportuje. **Nigdy nie wykonuje sam** — żadnego
pisania kodu, edycji plików projektu, uruchamiania testów/buildów ani operacji
systemowych. **Całe wykonanie deleguje do subagentów** (sonnet: `@coder`,
`@frontend`, `@devops`, `@writer`, `@cloudflare`, `@general`; diagnoza: `@debugger`).

Egzekwowane mechanicznie: `autopilot` ma `bash: deny` i `edit: deny`. Może tylko
czytać (zrozumieć kontekst), pisać **własne artefakty** (plan/raport) i delegować
(`task: allow`). Nie da się więc „przemycić" wykonania do opusa.

Uzasadnienie: (1) separacja myślenia od działania — czystsze decyzje, lepsza
kontrola; (2) koszt — drogi opus tylko do rozumowania, tani sonnet do bulk-roboty.

**Dwa jedyne punkty interakcji:** (1) ryzyko nieodwracalne, (2) nieusuwalna
niejednoznaczność. Poza tym pełna autonomia.

### Twarde STOP-y (operacje wymagające potwierdzenia)

Reboot/shutdown/poweroff, `rm -rf`, `git push --force` do main/master, `terraform
destroy`/`kubectl delete` zasobów produkcyjnych, drop/truncate bazy, operacje
finansowe, oraz wszystko z Global Hard Rules (AGENTS.md). Przy takiej operacji:
przerwij, podsumuj, poproś o potwierdzenie — nie wykonuj bez zgody.

## Pętla autonomiczna (skill `autonomous-execution`)

```
1. ZROZUM    → research (kod, docs, pamięć, web), rozwiej niejasności
2. ZAPROJEKTUJ (brainstorming-style, ale AUTONOMICZNIE)
               → eksploruj alternatywy, trade-offy, YAGNI
               → sam odpowiadasz na pytania projektowe (z researchu/założeń)
               → nieusuwalna niejasność → STOP + zapytaj użytkownika
               → zapisz design jako artefakt
3. ZAPLANUJ  → writing-plans → plan jako plik; sam wybierasz tryb wykonania
4. WYKONAJ   → DELEGUJ całość do subagentów (sonnet): @coder/@frontend/@devops…
               → przekaż w pełni doprecyzowane zadania (z planu)
               → instruuj subagentów: TDD, częste commity, izolacja (worktree)
               → operacja nieodwracalna → STOP + zapytaj (zanim zlecisz)
               → autopilot SAM nie pisze/nie uruchamia — tylko koordynuje
5. ZWERYFIKUJ→ oceń raporty subagentów; zleć niezależny przegląd innemu
               subagentowi (@debugger / @coder code-review); DECYDUJ czy „gotowe"
               (verification-before-completion na poziomie decyzji)
6. RAPORTUJ  → plik-audyt (autopilot pisze sam): co zrobiono, ZAŁOŻENIA,
               wyniki weryfikacji, STOP-y, którzy subagenci co wykonali
```

### Dlaczego nie wywołuje wprost skilla `brainstorming`

Skill `brainstorming` ma HARD-GATE „nie rób nic, dopóki użytkownik nie zaakceptuje
designu" + interaktywny przepływ (pytania po jednym). Wywołany dosłownie,
zatrzymałby autonomię. Dlatego **myślenie projektowe brainstormingu jest
wbudowane w `autonomous-execution`** (krok 2), ale z bramką WARUNKOWĄ: agent
rozstrzyga sam, a do użytkownika wychodzi tylko przy nieusuwalnej niejasności.
Wartość brainstormingu (design-przed-budową, alternatywy, YAGNI) zachowana w 100%.

## Realizacja

### Agent `agents/autopilot.md`

- **Model:** opus (mocne rozumowanie do decyzji/orkiestracji)
- **Narzędzia:** `read`, `glob`, `grep` (zrozumienie kontekstu) + `write`
  (TYLKO własne artefakty pod `docs/superpowers/`). **`bash: deny`** (nie
  uruchamia) + **`edit: { "*": "deny", "docs/superpowers/**": "allow" }`**.
  WAŻNE: narzędzie `write` jest bramkowane uprawnieniem **`edit`** (`write.ts:54`
  woła `ctx.ask({permission:"edit", patterns:[relPath]})`) — dlatego carve-out na
  `edit` egzekwuje OBA naraz: mechanicznie blokuje tworzenie/edycję kodu
  gdziekolwiek, a pozwala zapisać artefakty tylko pod `docs/superpowers/`.
  (Samo `edit:"deny"` blokowałoby też zapis artefaktów — autopilot mógł je zapisać
  w smoke teście wyłącznie dzięki `--dangerously-skip-permissions`.)
- **`mode: "primary"`** — wyklucza go z **reklamowanej** listy Task
  (`registry.ts:253` filtruje `item.mode !== "primary"`), więc agenci go nie
  „widzą". UWAGA: to tylko UKRYWA — `task.ts:116` pobiera agenta po nazwie BEZ
  sprawdzania `mode`, więc samo `mode:primary` NIE blokuje wywołania po nazwie.
  Twardą barierę daje warstwa `task`-deny (poniżej). Uruchamia go wyłącznie
  użytkownik (wybór agenta sesji); sam może delegować do subagentów.
- **Bariera „nikt nie odpali autopilota" (defense-in-depth):**
  (1) **root** `permission.task: { "autopilot": "deny" }` — łapie build/plan/explore
  i każdego bez własnej reguły task; (2) **per-agent** u wszystkich delegujących
  (`coder`, `general`, `architect`, `devops`, `frontend`, `writer`, `autopilot`)
  `task: { "*": "allow", "autopilot": "deny" }` — bo per-agentowe `task:allow`
  nadpisałoby root-deny przez `findLast`. Razem: `evaluate("task","autopilot")` =
  deny dla KAŻDEGO agenta; delegacja do pozostałych agentów działa normalnie.
- **`permission.task` u autopilota:** `{ "*": "allow", "autopilot": "deny" }` — może
  delegować do specjalistów, ale nie do samego siebie (brak rekurencji).
- **Whitelist skilli (lekka — tylko orkiestracja/myślenie):**
  `autonomous-execution`, `using-superpowers`, `writing-plans`,
  `subagent-driven-development`, `dispatching-parallel-agents`,
  `verification-before-completion`, `requesting-code-review`.
  **Bez `brainstorming`** (myślenie wbudowane w `autonomous-execution`).
  Skille wykonawcze (`test-driven-development`, `using-git-worktrees`,
  `finishing-a-development-branch`, `systematic-debugging`, code-review-doing)
  należą do **subagentów** (`@coder` itd. już je mają) — autopilot ich nie ładuje,
  tylko zleca subagentom ich użycie.

### Skill `autonomous-execution`

Nowy skill kodujący pętlę + polityki (STOP-y, protokół niejasności, dokumentowanie
założeń, raport-artefakt). Tworzony przez `@skill-smith` (właściciel skilli).
Lokalizacja zgodna z mechanizmem discovery (skill globalny w tym repo —
whitelistowany tylko dla `autopilot`, więc nie obciąża innych agentów).

## Delegacja — kluczowy niuans

Gdy autopilot deleguje (np. `@coder`), przekazuje **w pełni doprecyzowane**
zadanie (fazę designu już zrobił), aby specjalista po prostu wykonał i nie wpadł
we własną interaktywną bramkę (`brainstorming` jako subagent nie ma kogo pytać —
zawisłby/zgadywał). To zgodne z `subagent-driven-development` (orkiestrator pisze
szczegółowe specyfikacje zadań).

## Bezpieczeństwo

- STOP-y respektują Global Hard Rules (AGENTS.md/global-rules.md).
- Domyślnie praca w izolacji (worktree/branch) — zmiany odwracalne aż do
  integracji.
- Bariera `task`-deny (root + per-agent) zapobiega odpaleniu autopilota przez
  jakiegokolwiek agenta — w tym kaskadom „autonomiczny odpala autonomicznego"
  (autopilot ma `autopilot:deny` u siebie). `mode:primary` to dodatkowo ukrywa go
  z list, ale to bariera `task` egzekwuje (nie samo `mode`).

## Weryfikacja (po implementacji)

- `opencode debug agent autopilot` → model opus, `mode: primary`.
- `autopilot` NIE pojawia się w liście Task innych agentów (np. sprawdzić, że
  `describeTask` go pomija — pośrednio: brak w `agent list` subagentów).
- `bash scripts/check-skill-whitelists.sh` → PASS (nowy skill `autonomous-execution`
  na dysku, whitelistowany).
- Test dymny: zlecić proste zadanie, sprawdzić że powstaje plan + raport-artefakt,
  TDD/weryfikacja przebiegają, brak interakcji poza STOP-ami.

## Poza zakresem (YAGNI)

- Brak trybu background (na razie foreground) — można dodać później.
- Brak checkpointów na żywo (tylko raport końcowy + plik-audyt).
- Brak osobnego wariantu `brainstorming-autonomous` (myślenie wbudowane w skill).

> SPROSTOWANIE (poprzednia wersja tego specu błędnie zakładała, że
> `mode:primary` sam egzekwuje niewywoływalność i że per-agent `task:deny` jest
> zbędny). Faktycznie per-agent + root `task:{autopilot:deny}` SĄ konieczne i
> wdrożone (patrz „Bariera" wyżej) — `mode:primary` tylko ukrywa, nie blokuje.
