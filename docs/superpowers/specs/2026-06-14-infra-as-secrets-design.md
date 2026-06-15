# Spec: Traktowanie danych infrastrukturalnych jak sekretów

Data: 2026-06-14
Status: do przeglądu

## Problem

Audyt przed dodaniem zdalnego repo (backup) potwierdził brak sekretów w
śledzonych plikach i całej historii. Pozostały jednak **dane infrastrukturalne**
— nie-tajne, ale ujawniające topologię i tożsamość: osobista domena, wewnętrzne
hostname'y, nazwa użytkownika. Decyzja właściciela: **traktować je jak sekrety**,
aby repo dało się bezpiecznie wypchnąć nawet publicznie.

Inwentarz (śledzone pliki configu; submoduły upstream pominięte):

| Plik | Dane |
|---|---|
| `opencode.json:436` | `https://<ha-host>/api/mcp` (URL HA + osobista domena) |
| `opencode.json:449` | `https://<firecrawl-host>` (wewnętrzny hostname) |
| `docs/superpowers/specs/2025-07-18-firecrawl-subagents-design.md` | `<firecrawl-host>` (proza, 2×) |
| `docs/memory-rules.md:16` | przykład „k3s cluster on Proxmox" |
| `docs/superpowers/plans/2026-06-14-agents-md-slimming.md` | `~/<username>/` (27×, nazwa użytkownika) |

## Mechanizm (zweryfikowany w źródłach)

`{file:...}` w `opencode.json` jest podstawiane na surowym tekście PRZED parsowaniem
JSON (`config/config.ts:226`); zawartość pliku jest `trim`-owana i escape'owana do
JSON (`config/variable.ts:83-85`); ścieżki rozwiązywane względem katalogu configu.
Działa więc dla dowolnego pola string, w tym `url`. `secrets/.gitignore` ignoruje
wszystko poza `README.md` → nowe pliki sekretów są auto-ignorowane.

## Rozwiązanie

### Poziom 1 — config funkcjonalny

- `opencode.json`: `url` HA → `{file:secrets/homeassistant.url}`; `FIRECRAWL_API_URL`
  → `{file:secrets/firecrawl.url}`.
- Utworzyć `secrets/homeassistant.url` i `secrets/firecrawl.url` z aktualnymi
  wartościami (gitignored).
- `secrets/README.md`: dopisać oba pliki do tabeli + przykłady setupu.

### Poziom 2 — dokumentacja

- Spec firecrawl: `<firecrawl-host>` → `<firecrawl-host>` (placeholder, 2×).
- `memory-rules.md`: przykład „deploys to k3s cluster on Proxmox" → ogólny
  („deploys to an internal k8s cluster").

### Poziom 3 — nazwa użytkownika

- `plans/2026-06-14-agents-md-slimming.md`: `~/<username>/` → `~/` (27×; komendy
  pozostają poprawne w shellu).

## Weryfikacja

- `git grep` po wzorcach infra (nazwa użytkownika, hostname'y, nazwy klastra) →
  brak trafień w śledzonych plikach (poza `secrets/` które są ignorowane).
- `jq empty opencode.json` → OK; `git check-ignore secrets/homeassistant.url
  secrets/firecrawl.url` → oba ignorowane.
- `bash scripts/check-skill-whitelists.sh` → nadal PASS (sanity).
- Funkcjonalnie: OpenCode startuje i rozwiązuje `{file:}` (wartości obecne lokalnie).

## Poza zakresem (YAGNI)

- Brak zmian w submodułach (publiczne repo upstream).
- Brak zmian w pamięci (mnemosyne) — baza SQLite nie jest śledzona, nie trafia do
  push.
- Stare placeholdery „Bearer <redacted>" w innych specach — już bezpieczne.
