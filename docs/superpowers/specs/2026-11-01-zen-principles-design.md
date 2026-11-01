# Zasady Zen of Python w pracy agentów — specyfikacja projektu

- Data: 2026-11-01
- Autor decyzji: Grzegorz (użytkownik), ustalone w sesji burzy mózgów
- Status: do zatwierdzenia przez użytkownika
- Język: dokument dla użytkownika po polsku; wszystkie zmieniane pliki w repozytorium pozostają po angielsku

Oznaczenia „D1”–„D7” w tym dokumencie to numery decyzji (Decyzja 1 … Decyzja 7).
Zapis „#10” oznacza aforyzm numer 10 z ponumerowanej listy Zen of Python (patrz D3).

## 1. Cel i uzasadnienie

Grzegorz na co dzień pracuje według Zen of Python — zbioru 19 aforyzmów autorstwa
Tima Petersa, opublikowanego jako PEP 20 (PEP — Python Enhancement Proposal, czyli
oficjalny dokument propozycji zmian w języku Python). Chce, żeby agenci pracowali
tak samo, a w szczególności: `@architect`, `@coder`, `@reviewer` i `@devops`.

Zmiana nie wynika z konkretnego incydentu. Chodzi o zgodność sposobu pracy agentów
z filozofią pracy użytkownika.

## 2. Stan obecny

- Plik `docs/design-principles.md` już istnieje i jest ładowany do **każdego** agenta
  przez `opencode.json` → `instructions` (ścieżka bezwzględna od `~/`). Zawiera:
  - zasadę nadrzędną „If it doesn't exist, it can't break.”,
  - pełny tekst Zen of Python (19 wierszy, bez numeracji, łącznie z
    „Namespaces are one honking great idea”),
  - sekcję „How Agents Apply This” z sześcioma punktami: Ambiguity → ask;
    No silent failures; Subtract before adding; One obvious way;
    Explainable or redesign; Flat and namespaced.
- Sekcja „Design Principles” w `AGENTS.md` odsyła do tego pliku.
- Żaden z czterech promptów agentów (`agents/architect.md`, `agents/coder.md`,
  `agents/reviewer.md`, `agents/devops.md`) nie przekłada tych zasad na konkretne
  zachowania właściwe dla swojej roli.

## 3. Decyzje

**D1. Zasady pozostają globalne.** Obowiązują wszystkich agentów i żyją w jednym
wspólnym pliku `docs/design-principles.md` — zgodnie z „one obvious way” (#13).
Zawężenie do czterech agentów sprawiłoby, że pozostali działaliby według innych
reguł. Cztery wymienione role dostają dodatkowo krótkie bloki właściwe dla roli.

**D2. Bloki ról nie powtarzają wspólnego pliku.** Powtórzenie stworzyłoby dwa źródła
tej samej reguły. Blok roli zawiera wyłącznie konkrety specyficzne dla danej roli.

**D3. Numeracja aforyzmów #1–#19** w `design-principles.md`, żeby recenzent mógł
powołać się na przykład na „#10”. Pełny oryginalny tekst zostaje bez zmian, łącznie
z #19 („Namespaces…”) — potwierdzone przez użytkownika.

**D4. Bez przykładów kodu w promptach.** Przykłady w Pythonie z artykułu, który
przesłał użytkownik, służyły tylko jako ilustracja. W promptach kosztowałyby tokeny
przy każdym wywołaniu i byłyby związane z jednym językiem programowania.

**D5. Uzgodnione interpretacje aforyzmów:**
- #12 („refuse the temptation to guess”): niejasne wymagania → zapytaj;
  niejasna awaria → zdiagnozuj przyczynę źródłową, bez poprawek metodą prób i błędów.
- #15/#16 („Now is better than never” / „never is often better than *right* now”):
  nie odkładaj w nieskończoność, ale nie wypychaj niedopracowanej rzeczy „na już”;
  wszystko, co świadomie pominięto, zapisz jawnie jako dług techniczny.
- #19: przestrzenie nazw — prefiksy, osobne moduły, przestrzenie nazw (namespaces)
  w Kubernetesie, czytelne nazwy wydań (releases).

**D6. Zaktualizowana sekcja „How Agents Apply This”** w `design-principles.md`.
Docelowe brzmienie punktów (po angielsku; dokładne sformułowanie zostawione
wykonawcy w granicach poniższego znaczenia):

| Punkt (angielski) | Zmiana | Znaczenie |
|---|---|---|
| **Ambiguity → ask, failure → diagnose.** | rozszerzony | Dochodzi druga połowa z #12: przy awarii najpierw przyczyna, potem poprawka. |
| **No silent failures.** | bez zmian | — |
| **Now, but not half-baked.** | nowy | #15/#16; świadome pominięcia zapisane jawnie jako dług. |
| **Subtract before adding.** | bez zmian | — |
| **One obvious way.** | bez zmian | — |
| **Explainable or redesign.** | bez zmian | — |
| **Flat and namespaced.** | doprecyzowany | Jawne odwołanie do #19. |
| **Readable over clever.** | nowy | #1, #6, #7: pełne opisowe nazwy, żadnych jednolinijkowców kosztem czytelności, z dwóch działających rozwiązań wybierz prostsze. |
| **No abbreviations.** | nowy | Dwie części — opis niżej. |

„No abbreviations.” — dwie części:
- **a) Komunikacja z użytkownikiem:** w wiadomościach na czacie, w podsumowaniach,
  które koordynator przekazuje od subagentów, **oraz** w specyfikacjach i planach
  (`docs/superpowers/`): pisz pełne nazwy; jeśli skrót jest konieczny, rozwiń go przy
  pierwszym użyciu w danej wiadomości lub dokumencie; nigdy nie zakładaj, że skrót
  jest „powszechnie znany”. Uzasadnienie (parafraza słów użytkownika): agenci czasem
  zwracają się do niego dwu- lub trzyliterowymi skrótami, których nie rozumie.
- **b) Kod i skrypty:** żadnych skrótów w identyfikatorach (`create_list`, nie
  `create_lst`); w skryptach i potokach automatyzacji długie flagi i pełne nazwy
  zasobów (`--namespace`, `kustomization` zamiast `ks`). Wyjątki: idiomy języka
  (`err`, `ctx`, `i`, jednoliterowe odbiorniki metod w Go) oraz akronimy powszechnie
  używane w kodzie (`URL` — adres zasobu, `ID` — identyfikator, `HTTP` — protokół
  przesyłania stron internetowych).

Budżet (orientacyjny, nie twardy limit): wspólny plik rośnie o około 10–12 wierszy,
czyli około 150–250 tokenów na każde wywołanie (plik jest ładowany do każdego
agenta). Znaczenie z D6 ma pierwszeństwo przed liczbą wierszy (patrz sekcja 8).

**D7. Bloki ról** — krótkie (około 3–6 wierszy każdy), po angielsku, dodane do pliku
promptu każdego agenta, na przykład jako sekcja „Zen in this role”:

- **`@architect`:**
  - wśród ocenianych wariantów zawsze jest „nie budować / usunąć”;
  - każdy nowy komponent lub warstwa musi wskazać wymaganie, które go uzasadnia;
  - gdy problem jest naprawdę złożony (#4), powiedz to wprost i wybierz czytelne
    granice komponentów zamiast udawanej prostoty.
- **`@coder`:**
  - wczesny powrót z funkcji zamiast `else` po `return`, płytkie zagnieżdżenie;
  - błąd to wyjątek albo zwrócony błąd, nigdy `None` ani pusta wartość;
  - długie wyrażenia dziel na nazwane kroki;
  - przy błędzie najpierw odtwórz problem i znajdź przyczynę, dopiero potem zmieniaj kod;
  - istniejąca reguła „zachowuj istniejący styl kodu” zostaje (#8); jeśli ten styl
    łamie Zen, zgłoś to, nie przepisuj po cichu.
- **`@reviewer`:**
  - naruszenia Zen to zwykłe ustalenia w formacie szablonu recenzji, z numerem
    reguły i `file:line`;
  - oznaczaj nadmierną inżynierię: zbędne warstwy, równoległe mechanizmy,
    nieużywane abstrakcje;
  - odstępstwo uzasadnione komentarzem (#9) nie jest wadą;
  - waga: połknięty lub wyciszony błąd bez uzasadnienia (#10/#11) to co najmniej
    „Important” (blokuje scalenie); problemy z czytelnością i skrótami to „Minor”,
    chyba że ukrywają zachowanie;
  - pozostaje w formacie wyjściowym szablonu (`reviewer.md` mówi, że szablon jest
    jedynym źródłem prawdy).
- **`@devops`:**
  - przypięte wersje chartów Helma i obrazów kontenerów zamiast ukrytych domyślnych;
  - płytkie nakładki (overlays) Kustomize;
  - żadnego `|| true`, `continue-on-error` ani `failurePolicy: Ignore` bez komentarza;
  - długie flagi i pełne nazwy zasobów w skryptach i potokach automatyzacji.

## 4. Cele, nie-cele, anty-cele

**Cele:**
- agenci widocznie stosują zasady w swojej pracy;
- jedno źródło prawdy dla zasad;
- mały koszt w tokenach.

**Nie-cele (świadomie poza zakresem):**
- brak wstecznego przepisywania istniejących dokumentów ani `AGENTS.md` w celu
  usunięcia skrótów (na przykład „SDD” — subagent-driven development, czyli
  wytwarzanie sterowane subagentami — zostaje tam bez zmian);
- brak zmian w przykładach poleceń w `docs/global-rules.md` (`-n`, `ks` to tam
  polecenia interaktywne; reguła długich flag dotyczy tylko skryptów i potoków);
- brak zmian w umiejętnościach (skills) z podmodułu `superpowers`;
- brak nowych narzędzi, linterów (narzędzi do statycznej kontroli kodu) i wtyczek.

**Anty-cele (czego ma nie być):**
- powielania zasad w wielu miejscach;
- rozdmuchania promptu każdego agenta;
- wklejania artykułu lub jego przykładów.

## 5. Ograniczenia

- Pliki w repozytorium pozostają po angielsku (reguła użytkownika: komentarze
  i dokumentacja w repozytorium po angielsku). Ta specyfikacja po polsku jest
  wyjątkiem jako dokument projektowy dla użytkownika.
- Sprawdzone: reguły uprawnień w `opencode.json` i `plugins/shell-style.js` nie
  dopasowują dosłownie `ks` ani krótkich flag, więc reguła pełnych nazw nie wywoła
  nowych pytań o zgodę.
- Prompty `@architect` i `@reviewer` mają ograniczenia, które trzeba zachować:
  tryb tylko do odczytu oraz zasadę „szablon jest jedynym źródłem prawdy”.

## 6. Pozostawione wykonawcy

- Dokładne angielskie brzmienie punktów i bloków ról (w granicach znaczenia z D6 i D7).
- Miejsce sekcji roli w każdym pliku agenta.
- Ewentualna aktualizacja jednozdaniowego opisu w sekcji „Design Principles”
  w `AGENTS.md` — tylko jeśli jest potrzebna, by opis pozostał prawdziwy.

**Weryfikacja:** po zmianie odczytać zmienione pliki; opcjonalnie uruchomić nową
sesję i potwierdzić, że `docs/design-principles.md` nadal jest ładowany.

## 7. Zakres zmian w plikach

| Plik | Zmiana |
|---|---|
| `docs/design-principles.md` | numeracja #1–#19 (D3), zaktualizowana sekcja „How Agents Apply This” (D6) |
| `agents/architect.md` | blok roli (D7) |
| `agents/coder.md` | blok roli (D7) |
| `agents/reviewer.md` | blok roli (D7) |
| `agents/devops.md` | blok roli (D7) |
| `AGENTS.md` | tylko jeśli opis „Design Principles” przestanie być dokładny |

## 8. Decyzje architekta (do sprawdzenia przez użytkownika)

Pytania z niezależnego przeglądu specyfikacji, rozstrzygnięte przez architekta, a nie
przez użytkownika:

- **A1. „Przypięte wersje” u `@devops`** oznaczają zakaz *ukrytych* wartości
  domyślnych: brak wersji albo `latest`. Jawne zakresy wersji (np. `1.x` w HelmRelease)
  i automatyczne aktualizacje obrazów przez Flux (ImageAutomation) są dozwolone, bo są
  jawne (#2). Agent nie przepisuje działających konfiguracji z jawnymi zakresami.
- **A2. Gdzie zapisywać dług („Now, but not half-baked”):** w raporcie końcowym agenta
  dla użytkownika, a jeśli praca wynika ze specyfikacji lub planu w
  `docs/superpowers/` — także w tym dokumencie. Żadnego nowego pliku z długiem ani
  wpisów w systemie zgłoszeń (#13, „Subtract before adding”).
- **A3. `@reviewer`: Zen kontra szablon recenzji.** Szablon decyduje o procesie
  i formacie, a minimalna waga z D7 obowiązuje w skali szablonu. Wyciszenie błędu musi
  być jawne *w kodzie* (komentarz, #11). Zgoda w planie nie zastępuje komentarza,
  bo jego dodanie nic nie kosztuje. Jeśli szablon nie ma skali Critical/Important/Minor
  (np. niezależna weryfikacja autopilota), recenzent oznacza takie ustalenie słowami
  jako blokujące.
- **A4. Budżet wierszy** jest orientacyjny. Znaczenie z D6 wygrywa z liczbą wierszy
  (patrz „Budżet” w D6).
