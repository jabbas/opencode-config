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
| Domena | Cokolwiek; orkiestrator + proste robi sam (hybryda) |
| Bezpieczeństwo | Autonomia; **twardy STOP** tylko przy operacjach nieodwracalnych/niebezpiecznych |
| Niejednoznaczność | Research → rozsądne założenia + dokumentuj → **STOP** tylko gdy nieusuwalna |
| Weryfikacja | TDD + self-review + verification-before-completion **oraz** niezależny przegląd drugim agentem |
| Wykonanie | Orkiestrator (deleguje przy przekraczaniu domen), proste robi sam |
| Przebieg | Foreground (na żywo) + **zawsze plik-audyt** (plan + raport) |
| Uruchamianie | **Tylko użytkownik** — `mode: "primary"` (niewywoływalny przez Task) |

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
4. WYKONAJ   → proste: sam; złożone/cudza domena: deleguj specjaliście
               → operacja nieodwracalna → STOP + zapytaj
               → TDD, częste commity, izolacja (worktree/branch)
5. ZWERYFIKUJ→ testy, self-review, verification-before-completion
               → niezależny przegląd (@debugger / code-review skille)
6. RAPORTUJ  → plik-audyt: co zrobiono, ZAŁOŻENIA, weryfikacja, STOP-y
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
- **Narzędzia:** pełne (read/write/edit/bash/glob/grep)
- **`mode: "primary"`** — KLUCZOWE: wyklucza go z listy Task u wszystkich agentów
  (`registry.ts:253` filtruje `item.mode !== "primary"`), więc żaden agent nie
  uruchomi go automatycznie; uruchamia wyłącznie użytkownik. Jednocześnie sam
  może delegować do subagentów.
- **`permission.task: "allow"`** — by mógł delegować do specjalistów
  (`@coder`, `@frontend`, itd.).
- **Whitelist skilli:** `autonomous-execution`, `using-superpowers`,
  `writing-plans`, `test-driven-development`, `verification-before-completion`,
  `requesting-code-review`, `receiving-code-review`,
  `subagent-driven-development`, `dispatching-parallel-agents`,
  `using-git-worktrees`, `finishing-a-development-branch`, `systematic-debugging`.
  **Bez `brainstorming`** (myślenie wbudowane w `autonomous-execution`).

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
- `mode: primary` zapobiega kaskadom „autonomiczny odpala autonomicznego".

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
- Brak redundantnego `task:{autopilot:deny}` u innych agentów — `mode:primary`
  już to egzekwuje.
