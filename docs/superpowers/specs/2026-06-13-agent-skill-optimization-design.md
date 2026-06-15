# Spec: Optymalizacja agentów i skilli (maksimum funkcji, minimum tokenów)

Data: 2026-06-13
Status: do przeglądu

## Problem

Lista skilli w prompcie systemowym to ~7 580 tokenów (56% promptu), wstrzykiwana
do **każdego** agenta przy **każdym** wywołaniu. Każdy agent — nawet operator MCP
jak `ha` czy `webscraper` — wozi pełną listę 56 skilli, z których realnie użyje
najwyżej kilku. Dodatkowo mapowanie agent→domena jest niedopasowane: brak
właścicieli dla ~22 skilli wizualnych/dokumentowych, a nazwa `designer` myli
(to architekt systemów, nie projektant UI).

## Cel

Każdy agent widzi tylko skille, które realnie mu się przydadzą. Wszystkie 56
skille zostają na dysku — ograniczamy jedynie ich **widoczność per-agent** przez
`permission.skill`. Domenowe zestawy (Cloudflare, Stitch, frontend, dokumenty,
MCP) trafiają do dedykowanych agentów-specjalistów, których wołasz przez
`@nazwa` tylko gdy ich potrzebujesz — wtedy (i tylko wtedy) płacisz tokenami za
ich skille.

## Mechanizm (zweryfikowany w źródłach OpenCode)

- `skill/index.ts:314` — `Skill.available(agent)` filtruje listę skilli:
  `Permission.evaluate("skill", skill.name, agent.permission).action !== "deny"`.
  Skill z `deny` **nie trafia** do `<available_skills>` w prompcie.
- `permission/index.ts:43` — dopasowanie przez `Wildcard.match` (ostatnia
  pasująca reguła wygrywa, `findLast`). Wspiera wildcardy.
- `permission/index.ts:197-208` — `fromConfig`: string = wzorzec `*`; obiekt =
  mapa `wzorzec→akcja`.
- `agent/agent.ts:291` — per-agentowe `permission` z `opencode.json`
  (`agent.<name>.permission`) jest scalane na wierzch domyślnych.
- Wniosek: definiujemy `permission.skill` w `opencode.json` pod
  `agent.<name>.permission.skill` (spójnie z istniejącym `permission.bash`).

### Składnia (wzorzec whitelisty)

```json
"agent": {
  "debugger": {
    "permission": {
      "skill": {
        "*": "deny",
        "using-superpowers": "allow",
        "systematic-debugging": "allow",
        "verification-before-completion": "allow"
      }
    }
  }
}
```

`"*": "deny"` najpierw (blokuje wszystko), potem konkretne `allow`. Bez wpisu
`skill` agent zachowuje obecne zachowanie (widzi wszystkie skille).

### Wywoływanie skilli i dlaczego tylko `deny` oszczędza (zweryfikowane)

- `tool/skill.ts:28` — przy wywołaniu skilla `skill(name)` wykonywane jest
  `ctx.ask({ permission: "skill", patterns: [name] })`.
- `permission/index.ts:86-90` — jeśli `evaluate` zwróci `deny`, rzucany jest
  `DeniedError` → **wywołanie zablokowane**. Czyli `deny` ukrywa skill z listy
  **i** uniemożliwia jego wywołanie po nazwie. Whitelist jest szczelna.
- `permission/index.ts:44` — domyślna akcja (brak pasującej reguły) to `ask`.
- `skill/index.ts:314` — filtr listy odrzuca **tylko `deny`**. Wniosek krytyczny:

| Akcja | Na liście w prompcie | Wywołanie | Koszt tokenów |
|---|---|---|---|
| `allow` | widoczny | działa | pełny |
| `ask` | **widoczny** | pyta o zgodę | **pełny** |
| `deny` | ukryty | `DeniedError` | **zero** |

  **Tylko `deny` redukuje tokeny.** `ask` kosztuje tyle samo co `allow` (skill
  i tak ląduje na liście). Dlatego strategia to wyłącznie: `allow` u
  agenta-właściciela, `deny` u wszystkich pozostałych. Nie używamy `ask` do
  oszczędzania.

### Delegacja łańcuchowa wymaga jawnego `task` (zweryfikowane)

- `agent/subagent-permissions.ts:18,25` — gdy agent jest uruchamiany jako
  subagent (przez tool `task` / `@mention`), **traci prawo do `task`**, chyba że
  jego własny ruleset zawiera **jawną** regułę o `permission === "task"`.
  Reguła `"*": "allow"` NIE wystarcza (ma `permission: "*"`, nie `"task"`).
- Decyzja: agenci delegujący (`general`, `coder`, `architect`, `devops`) dostają
  w `opencode.json` jawne `"permission": { "task": "allow" }`, aby mogli wołać
  specjalistów (`@frontend`, `@stitch`, `@writer`, `@cloudflare`, `@skill-smith`)
  także działając jako subagent.
- Skutek braku skilla u subagenta: `DeniedError`. Obsługa = delegacja do
  agenta-właściciela. Dlatego sekcje delegacji w promptach są obowiązkowe, a
  whitelisty nie mogą być zbyt wąskie dla rdzenia roli agenta.

## Zmiany agentów

### Usunięcie
- **websearch** — usunięty (`agents/websearch.md` + wpis w `opencode.json` +
  odniesienia `@websearch` w promptach innych agentów i w `AGENTS.md`).
  Zadania przejmuje `@webscraper` (czytelna treść) + `curl`/`wget` w bashu
  agentów `general`/`coder`/`devops` (surowy HTTP/API/pliki).

### Zmiana nazwy
- **designer → architect** — ta sama rola (architektura, plany, ADR, D2,
  kontrakty API, brak wykonywania kodu, `bash: deny`), trafniejsza nazwa.
  Plik `agents/designer.md` → `agents/architect.md`; wpis `opencode.json`
  `agent.designer` → `agent.architect`; odniesienia `@designer`/„designer"
  w promptach i `AGENTS.md`. Model bez zmian: `opus-4-8`.

### Nowi agenci (5)
| Agent | Model | Mode | bash |
|---|---|---|---|
| cloudflare | sonnet-4-6 | subagent | allow (jak coder) |
| frontend | sonnet-4-6 | subagent | allow |
| stitch | sonnet-4-6 | subagent | allow |
| writer | sonnet-4-6 | subagent | allow |
| skill-smith | sonnet-4-6 | subagent | allow |

## Mapowanie agent → skille (whitelisty)

Skróty zestawów:
- **SP-pełny** = using-superpowers, brainstorming, writing-plans,
  executing-plans, subagent-driven-development, dispatching-parallel-agents,
  test-driven-development, systematic-debugging, verification-before-completion,
  requesting-code-review, receiving-code-review, using-git-worktrees,
  finishing-a-development-branch (13 skilli)
- **SP-devops** = using-superpowers, systematic-debugging,
  verification-before-completion, writing-plans, using-git-worktrees,
  finishing-a-development-branch (6)
- **SP-debug** = using-superpowers, systematic-debugging,
  verification-before-completion (3)

| Agent | Model | Skille (whitelist) |
|---|---|---|
| general | sonnet-4-6 | SP-pełny + pdf, xlsx, claude-api, customize-opencode |
| coder | sonnet-4-6 | SP-pełny + claude-api, webapp-testing |
| architect | opus-4-8 | using-superpowers, brainstorming, writing-plans |
| debugger | opus-4-8 | SP-debug |
| devops | sonnet-4-6 | SP-devops |
| ha | sonnet-4-6 | using-superpowers |
| webdebugger | sonnet-4-6 | SP-debug + webapp-testing, web-perf |
| webscraper | haiku-4-5 | *(zero — `"skill": {"*":"deny"}`)* |
| webresearcher | sonnet-4-6 | *(zero)* |
| webmonitor | haiku-4-5 | *(zero)* |

> Decyzja świadoma: `webscraper`/`webresearcher`/`webmonitor` mają zero skilli
> (BEZ `using-superpowers`). To czyste operatory MCP (Firecrawl), które nie kodują
> ani nie delegują — jakikolwiek skill byłby martwym balastem (~135 tok). Nie
> „naprawiać" przez dodawanie skilli.

| cloudflare | sonnet-4-6 | using-superpowers + cloudflare, workers-best-practices, wrangler, durable-objects, agents-sdk, sandbox-sdk, cloudflare-email-service, turnstile-spin, web-perf |
| frontend | sonnet-4-6 | SP-pełny + frontend-design, shadcn-ui, web-artifacts-builder, canvas-design, algorithmic-art, brand-guidelines, theme-factory, slack-gif-creator, webapp-testing |
| stitch | sonnet-4-6 | using-superpowers + stitch::* (14 skilli) |
| writer | sonnet-4-6 | using-superpowers, brainstorming, doc-coauthoring, internal-comms, docx, pptx, pdf |
| skill-smith | sonnet-4-6 | using-superpowers, skill-creator, writing-skills, mcp-builder |

### Uwagi do nazw skilli w whiteliście
- Stitch używa prefiksowanych nazw (`stitch::react-native`, `stitch::generate-design`
  itd.) oraz nieprefiksowanych (`remotion`, `react:components`, `react-native`,
  `shadcn-ui`, `design-md`, `enhance-prompt`, `stitch-loop`, `taste-design`).
  W implementacji whitelist Stitcha trzeba zbudować z **rzeczywistych nazw**
  wykrytych przez OpenCode (potwierdzonych w skilldump: 14 nazw). Użyć wildcardu
  `"stitch::*": "allow"` dla prefiksowanych + jawne `allow` dla pozostałych
  (remotion, shadcn-ui, react:components, design-md,
  enhance-prompt, stitch-loop, taste-design). UWAGA: nieprefiksowany
  `react-native` NIE istnieje jako skill (rzeczywista nazwa to
  `stitch::react-native`, pokryta wildcardem) — nie dodawać go do whitelisty.
- `shadcn-ui` występuje w Stitch (stitch-build) — frontend i stitch oba go
  whitelistują; to jeden skill, oba agenty mają do niego dostęp. OK.

## Podział odpowiedzialności

- **architect ZLECA** — projektuje, brainstormuje, pisze plany; gdy trzeba
  spisać dokument/komunikat → deleguje `@writer`. Nie ma doc-coauthoring/internal-comms.
- **writer ZAPISUJE** — jedyny właściciel doc-coauthoring + internal-comms.
- **coder** — implementacja; UI/grafikę deleguje `@frontend`, Stitch `@stitch`.
- **devops** — czysty K8s/Flux/Helm; Cloudflare deleguje `@cloudflare`.

## Duplikacja whitelist jest CELOWA (nie DRY-ować)

Zestaw skilli „SP-pełny" powtarza się dosłownie w whitelistach `coder`, `general`,
`frontend` (a podzbiory w pozostałych). To **świadoma decyzja**, nie przeoczenie —
NIE refaktoryzować na wspólną bazę. Powody (zweryfikowane w źródłach):

1. **Zero kosztu tokenowego.** Whitelisty są tylko w `opencode.json` (plik
   configu), który NIE jest wstrzykiwany do promptu. Rendered prompt zawiera
   wyłącznie faktyczne skille agenta (potwierdzone pomiarem B6). Duplikacja w
   JSON-ie nic nie kosztuje — to wyłącznie gadatliwość pliku.

2. **DRY przez root `permission.skill` NIE zadziała.** Merge daje kolejność
   `[defaults, root(user), per-agent]` (`agent.ts:117-291`), a `evaluate` używa
   `findLast` (`permission/index.ts:39`). Każdy agent ma własną mapę z
   `{"*":"deny", ...}`, a ta reguła `skill/*→deny` ląduje NA KOŃCU rulesetu i
   unieważnia wszystko, co przyznałby root. Czyli dokładnie wzorzec `"*":"deny"`,
   który daje oszczędność tokenów i bezpieczny „default-deny", z definicji blokuje
   dziedziczenie. Jedyna alternatywa (jawne denied-per-skill zamiast `"*":"deny"`)
   byłaby bardziej gadatliwa, krucha i mniej bezpieczna — gorsza od obecnego stanu.

Koszt utrzymania (dodanie skilla „wszystkim agentom kodowym" = edycja w 3
miejscach) jest akceptowalny. Strażnikiem spójności jest
`scripts/check-skill-whitelists.sh` (martwe wpisy → FAIL).

## Pokrycie skilli — zero sierot

Wszystkie funkcjonalne skille mają co najmniej jednego właściciela (z 56 plików
SKILL.md na dysku: `template-skill` to celowo nieprzypisany szablon). (superpowers→
coder/general/frontend; cloudflare→cloudflare; stitch→stitch; wizualne→frontend;
dokumenty→writer+general; doc/comms→writer; mcp/skille→skill-smith;
claude-api→general/coder; customize-opencode→general).

## Delegacja (sekcje promptów do aktualizacji)

W promptach codziennych agentów (`general`, `coder`, `architect`, `devops`)
dodać/zaktualizować sekcję delegacji o nowych specjalistów:
- `@cloudflare` — zadania Cloudflare Workers/wrangler/DO/Pages.
- `@frontend` — budowa UI, komponenty, grafika, art generatywny.
- `@stitch` — Google Stitch design→kod.
- `@writer` — dokumentacja, specy do spisania, komunikaty.
- `@skill-smith` — tworzenie/edycja skilli, budowa serwerów MCP.
Usunąć odniesienia do `@websearch`.

Dodatkowo każdy z tych agentów (`general`, `coder`, `architect`, `devops`)
dostaje w `opencode.json` jawne `"permission": { "task": "allow" }`, aby
delegacja działała również gdy sam jest uruchomiony jako subagent (patrz sekcja
„Delegacja łańcuchowa"). W prompcie dodać regułę: „jeśli zadanie wymaga skilla,
którego nie masz na liście — deleguj do właściwego specjalisty zamiast próbować
go wywołać".

## Oczekiwany efekt (lista skilli w prompcie, ~135 tok/skill)

| Agent | Teraz | Po | Oszczędność/wywołanie |
|---|---:|---:|---:|
| general | ~7 580 | ~2 300 | ~5 280 |
| coder | ~7 580 | ~2 200 | ~5 380 |
| architect | ~7 580 | ~550 | ~7 030 |
| debugger | ~7 580 | ~550 | ~7 030 |
| devops | ~7 580 | ~950 | ~6 630 |
| ha | ~7 580 | ~200 | ~7 380 |
| webscraper/webresearcher/webmonitor | ~7 580 | ~50 | ~7 530 |
| webdebugger | ~7 580 | ~750 | ~6 830 |
| Nowi specjaliści (cloudflare/frontend/stitch/writer/skill-smith) | — | 600–2 300 | płacisz tylko przy `@wywołaniu` |

Codzienni agenci (najczęściej używani) tracą 5 000–7 400 tokenów na wywołanie.

## Poza zakresem (YAGNI)

- Brak zmian w treści samych skilli (`SKILL.md`).
- Brak globalnego usuwania repozytoriów skilli z wykrywania (`skills.paths`) —
  wszystkie zostają dostępne, jedynie filtrowane per-agent.
- Brak zmian w `instructions`/AGENTS.md jako osobne zadanie (potencjalna
  przyszła optymalizacja: globalny AGENTS.md ~2 920 tok).

## Weryfikacja (jak sprawdzić że działa)

Dla wybranego agenta uruchomić `opencode run --agent <name> --format json "ping"`
i odczytać z `opencode.db` `tokens.cache.write`+`cache.read`+`input` (pierwsza
wiadomość assistant). Porównać przed/po. Alternatywnie: zrzut listy skilli przez
log w `prompt.ts` (jak w analizie) — sprawdzić, że `<available_skills>` zawiera
wyłącznie whitelistowane skille danego agenta.
