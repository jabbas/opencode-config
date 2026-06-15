# Spec: Test spójności whitelist skilli ↔ dysk

Data: 2026-06-14
Status: do przeglądu

## Problem

Per-agentowe whitelisty skilli (`agent.<name>.permission.skill` w `opencode.json`)
odwołują się do skilli po nazwie. Gdy submoduł skilli zostanie zaktualizowany i
skill zmieni nazwę (lub zniknie), wpis w whiteliście staje się **martwy** — skill
po cichu znika z listy agenta BEZ żadnego błędu (mechanizm: `skill/index.ts:314`
filtruje tylko po `deny`; nieistniejąca nazwa po prostu nie ma czego dopuścić).
To cichy dryf, który psuje wcześniejszą optymalizację bez ostrzeżenia.

Szczególnie kruche: Stitch używa nazw prefiksowanych (`stitch::*`) i
nieprefiksowanych — łatwo o rozjazd przy update.

## Cel

Skrypt, który weryfikuje, że każdy wpis `allow` w whiteliście odpowiada
realnemu skillowi na dysku (albo znanemu wbudowanemu, albo — dla wzorców —
matchuje ≥1 skill). Strażnik regresji: uruchamiany ręcznie po zmianach w
whitelistach lub po update submodułów.

## Rozwiązanie

`scripts/check-skill-whitelists.sh` (bash, `set -euo pipefail`).

### Logika

Dla każdego agenta, dla każdego wpisu `permission.skill` o wartości `allow`:

- `*` (deny-all base) → pomijany.
- wpis z `*` (wildcard, np. `stitch::*`) → musi pasować ≥1 skill na dysku;
  inaczej `[FAIL]` martwy wzorzec.
- literał (np. `frontend-design`) → musi istnieć na dysku LUB być znanym
  wbudowanym; inaczej `[FAIL]` martwy wpis.

### Źródła danych

- whitelisty: `jq` z `opencode.json`.
- skille na dysku: pole `name:` z frontmatter wszystkich `**/SKILL.md`
  (z wykluczeniem `node_modules`); brana tylko pierwsza linia `^name:`
  (frontmatter), nie przykłady z treści.
- wbudowane: `KNOWN_BUILTINS=("customize-opencode")` — skill rejestrowany w
  źródłach OpenCode (`skill/index.ts`), NIE plik SKILL.md.

### Sieroty

Skille na dysku, których żaden agent nie whitelistuje (literałem ani wzorcem) →
raport `[INFO]`, NIE błąd. (Np. `template-skill` to celowy szablon.)

### Wynik

- exit 0 — brak martwych wpisów (sieroty dozwolone).
- exit 1 — ≥1 martwy literał lub martwy wildcard.
- Output z prefiksami `[PASS]`/`[FAIL]`/`[INFO]` (konwencja testów repo).

## Uruchamianie

Ręcznie: `bash scripts/check-skill-whitelists.sh`. Komenda udokumentowana w
`docs/dev-guide.md`. Bez auto-hooka (YAGNI).

## Weryfikacja

- Na obecnym stanie: `[PASS]`, exit 0 (potwierdzone: wszystkie wpisy mają
  pokrycie — disk ∪ {customize-opencode} ∪ wildcard `stitch::*`).
- Ścieżka błędu: tymczasowe wstrzyknięcie fałszywego wpisu `allow` →
  oczekiwany `[FAIL]` + exit 1 → rewert.

## Poza zakresem (YAGNI)

- Brak auto-uruchamiania (hook/CI).
- Brak sprawdzania kolizji nazw skilli (osobny temat).
- Sieroty nie są błędem (celowe).
