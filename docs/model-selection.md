# Dobór modeli LLM dla agentów OpenCode

**Stan: 2026-11-26.** Dokument opisuje **obecną** konfigurację. Wcześniejsza wersja
z czerwca 2026 (przejście na GLM 5.2 / Kimi K2.7 / Qwen3.7 Plus przez `kilocode/`)
została porzucona i usunięta — jej wnioski są w historii gita.

## 1. Zasada nadrzędna: modele tylko w `opencode.jsonc`

`opencode.json` (wersjonowany, współdzielony między maszynami) **nie zawiera żadnego
przypięcia modelu** — ani globalnego, ani per-agent. Wszystkie modele ustawia
per-maszyna `opencode.jsonc` (gitignorowany, może być symlinkiem do wariantu
`opencode.*.json`, np. `opencode.kilocode.json`).

Konsekwencje:

- Nie ma „cross-machine pins". Poprzednio `architect` i `autopilot` były przypięte
  w `opencode.json` do modeli Anthropic — to zostało usunięte. Powód: przypięcie
  wygrywało z `opencode.jsonc` i uniemożliwiało sterowanie modelem per maszyna.
- Zmiana modelu = jedna linia w `opencode.jsonc`. Nie dotykaj `opencode.json`.
- Maszyna bez odpowiednika modelu w swoim jsonc dostaje domyślny (top-level `model`).

## 2. Role modelowe

Agenci różnią się charakterem pracy, nie tylko nazwą. Stąd trzy role:

| Rola | Charakter pracy | Wymagania |
|---|---|---|
| **reasoning** | długie dokumenty, analiza, planowanie, ADR | głębokie rozumowanie, niska skłonność do pewnej-nieprawdy |
| **coding** | pisanie i transformacja kodu, tool-calling | wysoka sprawność agentowa, tanio, dużo wywołań |
| **utility** | MCP, JSON, ekstrakcja, masowe podzadania | tanio, szybko, wystarczy poprawne wywołanie narzędzi |

## 3. Przydział modeli

Stan dla wariantu `opencode.kilocode.json` (maszyna prywatna).

| Agent | Model | Cena in/out za 1M |
|---|---|---|
| *(domyślny, top-level `model`)* | `kilo/deepseek/deepseek-v4.1-flash-1017` | $0.30 / $1.20 |
| `architect` | `kilo/openai/gpt-6.2-sol` | $2.00 / $10.00 |
| `reviewer` | `kilo/openai/gpt-6.2-sol` | $2.00 / $10.00 |
| `debugger` | `kilo/deepseek/deepseek-v4.1-flash-1017` | $0.30 / $1.20 |
| `autopilot` | `kilo/deepseek/deepseek-v4.1-flash-1017` | $0.30 / $1.20 |
| `coder` | `kilo/deepseek/deepseek-v4.1-flash-1017` | $0.30 / $1.20 |
| `devops` | `kilo/deepseek/deepseek-v4.1-flash-1017` | $0.30 / $1.20 |
| `skill-smith` | `kilo/deepseek/deepseek-v4.1-flash-1017` | $0.30 / $1.20 |
| `stitch` | `kilo/deepseek/deepseek-v4.1-flash-1017` | $0.30 / $1.20 |
| `webresearcher` | `kilo/deepseek/deepseek-v4.1-flash-1017` | $0.30 / $1.20 |
| `frontend` | `kilo/xiaomi/mimo-v2.6-pro` | $0.43 / $0.87 |
| `cloudflare` | `kilo/xiaomi/mimo-v2.6-pro` | $0.43 / $0.87 |
| `writer` | `kilo/xiaomi/mimo-v2.6-pro` | $0.43 / $0.87 |
| `webdebugger` | `kilo/tencent/hy3` | $0.132 / $0.528 |
| `ha` | `kilo/tencent/hy4-flash` | $0.07 / $0.281 |
| `jira` | `kilo/tencent/hy4-flash` | $0.07 / $0.281 |
| `webscraper` | `kilo/tencent/hy4-flash` | $0.07 / $0.281 |
| `webmonitor` | `kilo/tencent/hy4-flash` | $0.07 / $0.281 |
| `title` | `kilo/qwen/qwen3.7-flash` | $0.03 / $0.13 |

## 4. Uzasadnienie kluczowych wyborów

### 4.1 `architect` → GPT-6.2 Sol

Rola reasoning: czyta duży kontekst, waży alternatywy, pisze ADR i kontrakty API.
Nie wykonuje kodu ani poleceń (allowlist tylko do odczytu), więc słabość w
Terminal-Bench nie ma znaczenia — liczy się jakość rozumowania i kalibracja.

Wybrany mimo najwyższej ceny na liście, bo **koszt per zadanie jest najniższy
wśród poważnych kandydatów** ($1.01) — model jest zwięzły (~61M tokenów wyjścia
vs ~99M u GPT-6.1 Terra) i szybki (~10 min/zadanie). Do tego jest niezależny od
rodziny DeepSeek, na której stoi cały zespół implementujący, więc projekt i jego
realizacja nie dzielą ślepych plam.

Ograniczenia: 1M kontekstu niezweryfikowane powyżej ~512K (rodzina OpenAI degraduje);
cena wejścia podwaja się powyżej 272K tokenów. Dlatego kontekst architecta trzymaj
w okolicach 100–250K.

> Uwaga: przed zmianą architect stał na `claude-opus-5-5` przez przypięcie
> w `opencode.json`. Historia użycia pokazała ~$1000/kwartał przy wywołaniach,
> które kończyły się poprawnie — czyli płacono za jakość, której nie brakowało.

### 4.2 `reviewer` → GPT-6.2 Sol

Review jest wyjściowo-ciężki, więc liczy się zwięzłość, nie stawka za token.
GPT-6.1 Terra ma niższą cenę za token, ale zużywa ~63% więcej tokenów wyjścia,
co daje $0.96/zadanie przy $1.01 dla Sola — 5% taniej za 6 punktów mniej
intelligence i większą skłonność do rozwlekłości (czyli więcej fałszywych uwag).

`reviewer` celowo ma model z innej rodziny niż implementujący agenci — review
ma być niezależnym punktem widzenia. Uwaga: `architect` i `reviewer` dzielą ten
sam model, więc nie są wobec siebie niezależni.

### 4.3 `webdebugger` vs pozostałe role MCP

`webdebugger` obsługuje Playwright i Chrome DevTools — realna praca terminalowa.
`tencent/hy3` (256K, brak `parallel_tool_calls`) jest stary, ale utrzymany
**celowo**: `hy4-flash` ma Terminal-Bench 4.0 na poziomie 19.2, czyli jest zbyt
słaby do tej roli, mimo niższej ceny.

`hy4-flash` trafił do ról czysto-MCP (`ha`, `jira`, `webscraper`, `webmonitor`),
gdzie liczy się tylko poprawne wywołanie narzędzia i JSON — i tam jest ~50% tańszy
przy 1M kontekstu.

### 4.4 `mimo-v2.6-pro` (frontend, cloudflare, writer)

Model o dobrych wynikach wizualno-tekstowych, ale **wolny** (~60 min/zadanie,
36 tok/s) — najwolniejszy element konfiguracji. Jeśli odczujesz to w pracy
interaktywnej, kandydatem na zamianę jest `deepseek-v4.1-flash-1017`.

## 5. Odrzucone świadomie

### 5.1 `deepseek/deepseek-v4-pro` — nie używać

Kuszące jako „ten sam dostawca, większy model". W praktyce **gorszy od
`v4.1-flash-1017` na prawie wszystkich wspólnych benchmarkach**
(DeepSWE 62.7 vs 74.2, Terminal-Bench 90.6 vs 87.9), indeks inteligencji 23
(vs 32), a wskaźnik halucynacji 94.1% — model praktycznie nigdy nie mówi
„nie wiem". Dla dokumentów architektonicznych to dokładnie ten tryb porażki,
który kosztuje najwięcej.

### 5.2 `deepseek-v4.1-flash` (wariant bez `-1017`) — nie używać

Na gatewayu widniał w cenie $0.0507/$0.2028, czyli ~6× taniej, co wyglądało na
oczywistą oszczędność. Zweryfikowane: to **promocja „83% off" u dostawcy
trzeciorzędnego**, nie cena listowa. DeepSeek serwuje u siebie tylko jeden V4.1
Flash i jest to 1017; wariant bez sufiksu to starszy snapshot (10.09 vs 17.10)
z niższymi wynikami (Terminal-Bench 42.3 vs 31.2). Nie budować konfiguracji na
promocji, która może zniknąć — ta sama klasa błędu co wycofanie `mimo-v2.5-pro`.

### 5.3 `mimo-v2.6-flash` — nie używać w agencjach

Xiaomi opublikowało własne post-mortem potwierdzające **zapętlenie wywołań
narzędzi** w harnessach agentowych. Mimo niskiej ceny dyskwalifikuje to model
w jakiejkolwiek roli z tool-callingiem.

### 5.4 `glm-5.3` / `glm-5.3-prime`

`glm-5.3` był rozważany jako alternatywa dla architecta: lepsza kalibracja
(halucynacje 38.9% vs 55.4% u Sola), poprawna rodzina niezależna od DeepSeeka.
Odrzucony za **~27 min/zadanie** (odczuwalne w sesji z człowiekiem) i wyższy
koszt per zadanie ($5.01). `glm-5.3-prime` odrzucony osobno: płatna premia
za przepustowość przy **gorszym** trzymaniu instrukcji (73.0%).

### 5.5 `grok-4.3` / `grok-4.20`

Kusząca cena ($1.25/$2.50) i najniższy wskaźnik halucynacji (25.0%), ale
**AA-LCR 64.3%** — ok. 15 punktów gorzej niż konkurencja w czytaniu długich
kontekstów, a to cała praca architecta. Run nie niezależny.

### 5.6 `kilo-auto/*` i `openrouter/auto*`

Routery zwracają w katalogu niesprawdzalne ceny. Nie da się przewidzieć kosztu
ani tego, który model faktycznie odpowie — nie nadaje się do konfiguracji.

## 6. Zasady przy zmianie modeli

1. **Lista modeli tylko przez API**, nie z pamięci:
   `curl -s https://api.kilo.ai/api/gateway/models`
2. **Weryfikuj ID w katalogu** — nieistniejący ID po cichu spada na model
   domyślny, bez błędu w logu.
3. **Sprawdzaj cenę per zadanie, nie za token**, gdy model ma inną gadatliwość.
4. **Ostrzeżenie o regulaminie**: warianty z `mayTrainOnYourPrompts: true`
   (dawniej `:discounted`) są nieakceptowalne — praca nad kodem objętym NDA.
   Sprawdzaj też, czy tańszy wariant nie jest po prostu okrojony funkcjonalnie
   (mniej parametrów tool-calling), jak `:discounted` w przeszłości.
5. **Po zmianie sprawdź `git diff`** — `opencode.json` jest wersjonowany i łatwo
   tam uszkodzić bloki uprawnień.
6. **Restart sesji** — modele są czytane przy starcie.

## 7. Pobieranie listy modeli

```bash
curl -s https://api.kilo.ai/api/gateway/models
```

Format ID w konfiguracji: `kilo/<provider>/<model-id>`, np.
`kilo/openai/gpt-6.2-sol`, `kilo/tencent/hy4-flash`.

*Krajobraz modeli zmienia się co kilka tygodni. Przed kolejną zmianą zestawu
zweryfikuj ceny i benchmarki — ten dokument opisuje stan na 2026-11-26.*
