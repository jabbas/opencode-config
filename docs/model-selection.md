# Dobór modeli LLM dla agentów OpenCode

**Stan: czerwiec 2026**

---

## 1. Kontekst i cel

Celem jest przypisanie optymalnych modeli językowych do każdego z 17 agentów OpenCode, z uwzględnieniem ich rzeczywistych zadań, a nie wyłącznie nazw ról. Modele pochodzą wyłącznie z oferty Kilo Code.

### Ograniczenia obligatoryjne

| Ograniczenie | Szczegół |
|---|---|
| Brak modeli frontier | Wykluczone: Anthropic (Claude), OpenAI (GPT), Google (Gemini). Powód: koszt. |
| Brak retencji/treningu na danych | Praca nad firmowym kodem objętym NDA. Modele muszą gwarantować brak uczenia na promptach/odpowiedziach. |

### Provider

**Kilo Code** — `baseURL: https://api.kilo.ai/api/gateway`

Pełna lista modeli (321 modeli, 53 dostawców) dostępna wyłącznie przez API, nie w pliku konfiguracyjnym. Aby pobrać aktualną listę:

```
GET https://api.kilo.ai/api/gateway/models
Authorization: Bearer <klucz>
X-KiloCode-OrganizationId: <org-id>
```

Klucz API: `~/.local/share/opencode/auth.json` (pole `.kilocode.key`). ID organizacji: `<your-org-id>`.

---

## 2. Metodologia

### Kroki analizy

1. Pobrano pełną listę modeli z Kilo Code API.
2. Zebrano benchmarki i opinie branżowe z czerwca 2026 (zob. tabela poniżej).
3. Przeczytano definicje wszystkich 17 agentów — ich faktyczne zadania (nie nazwy) — by dopasować model do realnej pracy.

### Zrodla benchmarkow

| Zrodlo | Data | Uwagi |
|---|---|---|
| kilo.ai/leaderboard (KiloBench) | czerwiec 2026 | Najtrafniejszy — mierzy realne srodowisko Kilo Code |
| swebench.com (SWE-bench Verified/Pro) | czerwiec 2026 | Kodowanie, naprawianie bugów GitHub |
| Terminal-Bench 2.1 | czerwiec 2026 | CLI, narzedzia systemowe, bash |
| benchlm.ai | 18.06.2026 | Agregat wielu benchmarków |
| morphllm.com | 09.06.2026 | Badanie jakosci vs tooling |
| teamai.com | 22.06.2026 | Opinie praktyczne |
| groundy.com | 19.06.2026 | Porównania kosztów |
| llm-stats.com | czerwiec 2026 | Statystyki parametrów modeli |

### Kluczowy meta-wniosek

Badanie Morph (marzec 2026): różnica jakosci między modelami z czolówki rankingów wynosi ok. 1%, natomiast lepszy tooling i scaffolding daje wzrost skutecznosci rzędu +22%. Wniosek operacyjny: przepłacanie za modele frontier przy agentach z dobrym frameworkiem nie ma uzasadnienia ekonomicznego.

---

## 3. Definicje agentów

Poniżej skrótowy opis zadań każdego agenta na podstawie ich definicji. Dobór modelu bazuje na tym co agent realnie robi, nie na jego nazwie.

| Agent | Rzeczywiste zadania |
|---|---|
| **architect** | ADR, design docs, D2 diagramy, API contracts, plany migracji. Głeboki reasoning, brak wykonywania bash, dużo delegowania subagentom. |
| **debugger** | Full-stack: klaster Kubernetes -> pody -> logi -> kod zrodłowy. Wykonuje bash, diagnozuje root-cause, czyta długie logi. |
| **autopilot** | Orkiestrator: planuje i deleguje wszystko subagentom. Niezależny review wyników. |
| **devops** | Kubernetes, Helm, Flux, Kustomize, GitHub Actions. Operacje na żywym klastrze, bash. |
| **skill-smith** | Tworzy skille (behavior code) oraz serwery MCP. |
| **coder** | Programowanie polyglot: Go, Python, TypeScript. TDD, refaktoryzacja, testy. |
| **frontend** | Komponenty UI, generative art, theming, testowanie w przegladarce. |
| **cloudflare** | Workers, wrangler, Durable Objects, KV, D1, R2. |
| **stitch** | Konwersja projektów Google Stitch do kodu React/React Native. |
| **webresearcher** | Wyszukiwanie przez Firecrawl, synteza wyników. |
| **writer** | Dokumenty techniczne, Word/PPT/PDF. |
| **webdebugger** | Playwright przez MCP: snapshoty, inspektowanie sieci, konsola JS. |
| **ha** | Home Assistant przez MCP — sterowanie, automatyzacje, encje. |
| **jira** | Jira przez MCP — JQL, przejscia, komentarze, worklogi, sprinty. |
| **stitch-mcp** | Projektowanie UI w Google Stitch przez MCP. |
| **webscraper** | Firecrawl — scrape i crawl pojedynczych oraz wielu stron. |
| **webmonitor** | Firecrawl — monitory zmian na stronach. |

---

## 4. Finalny przydział modeli

### Tabela przydziałów

| Agent | Model | ID w konfigu |
|---|---|---|
| architect | GLM 5.2 | `kilocode/z-ai/glm-5.2` |
| debugger | GLM 5.2 | `kilocode/z-ai/glm-5.2` |
| autopilot | GLM 5.2 | `kilocode/z-ai/glm-5.2` |
| devops | GLM 5.2 | `kilocode/z-ai/glm-5.2` |
| skill-smith | GLM 5.2 | `kilocode/z-ai/glm-5.2` |
| coder | Kimi K2.7 Code | `kilocode/moonshotai/kimi-k2.7-code` |
| frontend | Kimi K2.7 Code | `kilocode/moonshotai/kimi-k2.7-code` |
| cloudflare | Kimi K2.7 Code | `kilocode/moonshotai/kimi-k2.7-code` |
| stitch | Kimi K2.7 Code | `kilocode/moonshotai/kimi-k2.7-code` |
| webresearcher | Qwen3.7 Plus | `kilocode/qwen/qwen3.7-plus` |
| writer | Qwen3.7 Plus | `kilocode/qwen/qwen3.7-plus` |
| webdebugger | DeepSeek V4 Flash | `kilocode/deepseek/deepseek-v4-flash` |
| ha | DeepSeek V4 Flash | `kilocode/deepseek/deepseek-v4-flash` |
| jira | DeepSeek V4 Flash | `kilocode/deepseek/deepseek-v4-flash` |
| stitch-mcp | DeepSeek V4 Flash | `kilocode/deepseek/deepseek-v4-flash` |
| webscraper | DeepSeek V4 Flash | `kilocode/deepseek/deepseek-v4-flash` |
| webmonitor | DeepSeek V4 Flash | `kilocode/deepseek/deepseek-v4-flash` |

---

## 5. Uzasadnienie kluczowych wyborów

### 5.1 GLM 5.2 — role reasoning i CLI (architect, debugger, autopilot, devops, skill-smith)

**Model:** `kilocode/z-ai/glm-5.2` | Cena: $1.40 / $4.40 za 1M tokenów (input/output) | Kontekst: 1M

| Benchmark | Wynik GLM 5.2 | Kontekst |
|---|---|---|
| SWE-bench Pro | 62.1% | #1 open-source; GPT-5.5 uzyskuje 58.6% |
| Terminal-Bench 2.1 | 81.0 | Claude Opus 4.8 = 85; ogromna przewaga w CLI/bash/k8s |
| KiloBench (tool-calling) | #1 open-source | Kluczowe dla agentów MCP-heavy |
| Long-horizon agentic coding | #1 open-source | Architekt, autopilot, devops |

**Uzasadnienie przydziału:**

- Roles reasoning (architect, autopilot): wymagają planowania wieloetapowego, analizy złożonych systemów, delegowania. GLM 5.2 dominuje w long-horizon agentic coding.
- Debugger i devops: Terminal-Bench 2.1 = 81.0 jest decydujące — te role wykonują bash, czytają logi k8s, operują na żywym klastrze. Claude Opus 4.8 uzyskuje 85 (różnica 5%), ale jest frontier (wykluczone).
- Skill-smith: tworzy behavior code i serwery MCP — wymaga rozumienia narzędzi i ich interakcji; #1 w tool-calling to rozstrzygające kryterium.

**Zastrzeżenia:**
- Latencja TTFT ok. 10s (do obserwacji w praktyce).
- Benchmarki SWE-bench Pro podawane przez Zhipu — self-reported, weryfikacja niezalezna ograniczona.

---

### 5.2 Kimi K2.7 Code — kodowanie (coder, frontend, cloudflare, stitch)

**Model:** `kilocode/moonshotai/kimi-k2.7-code` | Cena: $0.95 / $4.00 za 1M tokenów | Kontekst: standard

| Benchmark | Wynik |
|---|---|
| KiloBench | 60.7% — #1 non-frontier |
| Aider Polyglot | wysoka pozycja w rankingach code-specific |

**Uzasadnienie:** Specjalista kodu wytrenowany pod tym zadaniem. Najtańszy w top-10 KiloBench. Role coder/frontend/cloudflare/stitch polegają w 90%+ na pisaniu i transformacji kodu — model wyspecjalizowany bije modele ogólne w tym zakresie.

---

### 5.3 Qwen3.7 Plus — synteza tekstu (webresearcher, writer)

**Model:** `kilocode/qwen/qwen3.7-plus` | Cena: $1.00 / $5.00 za 1M tokenów | Kontekst: 1M

**Uzasadnienie:** Role webresearcher i writer produkują głównie tekst: syntezy, raporty, dokumenty. Qwen3.7 Plus ma dobre wskazniki w zadaniach synthesis + summarization przy 1M oknie kontekstu (potrzebne dla duzych crawlów Firecrawl i długich dokumentów).

---

### 5.4 DeepSeek V4 Flash — role MCP i masowe (webdebugger, ha, jira, stitch-mcp, webscraper, webmonitor)

**Model:** `kilocode/deepseek/deepseek-v4-flash` | Cena: $0.14 / $0.28 za 1M tokenów

**Uzasadnienie:** Role te:
- Operują głównie na danych publicznych lub przez dobrze ustrukturyzowane API MCP (Jira, Home Assistant, Firecrawl, Stitch).
- Nie wymagają głębokiego reasoning — wykonują sekwencyjne wywołania narzędzi ze structured input/output.
- Mogą być uruchamiane wielokrotnie (webmonitor, webscraper).

DeepSeek V4 Flash przy cenie $0.14/$0.28 jest 10x tańszy od GLM 5.2 przy zadaniach, gdzie wyższa jakość nie przynosi wymiernej różnicy w wynikach.

---

## 6. Modele rozważane i odrzucone

### 6.1 Grok 4.20 (xAI)

**Rozważany dla:** debugger, devops — ze względu na kontekst 2M tokenów (największy dostępny).

**Odrzucony ponieważ:**
- Kontekst 1M był wystarczający w dotychczasowej pracy.
- GLM 5.2 uzyskuje lepsze wyniki w Terminal-Bench (kluczowe dla debugger/devops) i tool-calling.
- 2M kontekstu nie uzasadnia niższej jakosci w wymiarach, które mają znaczenie dla tych ról.

---

### 6.2 DeepSeek V4 Pro

**Rozważany dla:** ról reasoning (architect, debugger, autopilot, devops, skill-smith).

| Benchmark | DeepSeek V4 Pro | GLM 5.2 |
|---|---|---|
| SWE-bench Verified | 80.6% | — |
| Terminal-Bench 2.1 | 44 | 81.0 |
| Cena (input/output za 1M) | $2.40 / $4.80 | $1.40 / $4.40 |

**Odrzucony ponieważ:**
- Terminal-Bench: 44 vs 81 — przegrywa znacznie w zadaniach CLI/bash, decydujących dla debugger i devops.
- Gorszy tool-calling.
- Droższy.

**Status:** Pozostaje jako fallback — jeśli latencja GLM 5.2 (~10s TTFT) okaże się problemem w praktyce, przełączyć architect/autopilot na `kilocode/deepseek/deepseek-v4-pro`.

---

### 6.3 Warianty `:discounted` (deepseek-v4-pro:discounted, deepseek-v4-flash:discounted)

**Pozorna zaleta:** ok. 82% nizszy koszt.

**Odrzucone bezwarunkowo z dwóch powodów:**

1. **Ryzyko IP (NDA):** `mayTrainOnYourPrompts: true` — prompty i odpowiedzi mogą byc używane do treningu przez dostawcę (DeepSeek). Naruszenie jest nieodwracalne. Umowa NDA firmy z Kilo Code może nie pokrywac sub-procesora (DeepSeek) na endpoincie zniżkowym.

2. **Okrojony tool-calling:** 5 zamiast 19 parametrów, brak `tool_choice`, brak `structured_outputs`. Agenci OpenCode korzystają intensywnie z tych funkcji — wariant discounted jest funkcjonalnie niekompatybilny.

**Uwaga:** API nie zwraca daty wygaśnięcia tych endpointów, ale ich charakter jest promocyjny. Nie używac niezależnie od okolicznosci.

---

## 7. Analiza kosztowa

### Parametry szacunku

Szacunek oparty na założonym profilu sesji: 2M tokenów input + 0.3M tokenów output na sesję roboczą. Realny koszt zależy od intensywności użycia.

### Ceny modeli

| Model | Input (za 1M) | Output (za 1M) |
|---|---|---|
| GLM 5.2 | $1.40 | $4.40 |
| Kimi K2.7 Code | $0.95 | $4.00 |
| Qwen3.7 Plus | $1.00 | $5.00 |
| DeepSeek V4 Flash | $0.14 | $0.28 |

### Porownanie setup poprzedni vs obecny

| Setup | Przybliżony koszt / sesję |
|---|---|
| Frontier (poprzedni): Opus 4.8 dla architect/autopilot, Sonnet 4.6 dla większosci, Haiku dla tanich ról | ~$135.82 |
| Non-frontier (obecny) | ~$50–58 |
| Oszczędnosc | ~57–63% (ok. 2.3–2.7x taniej) |

Głównym generatorem kosztów w poprzednim setupie były Opus 4.8 i Sonnet 4.6. Przejście na non-frontier eliminuje ten koszt przy zachowaniu lub poprawieniu jakosci w mierzalnych wymiarach (Terminal-Bench, KiloBench, tool-calling).

---

## 8. Konfiguracja — jak zmieniac i utrzymywac

### Plik konfiguracyjny

```
~/.config/opencode/opencode.local.json
```

- Sekcja `"agent"` — model per agent.
- Sekcja `"provider.kilocode.models"` — definicje modeli z limitami kontekstu i cenami.

### Format identyfikatora modelu

```
"kilocode/<provider>/<model-id>"
```

Przykład: `"kilocode/z-ai/glm-5.2"`, `"kilocode/deepseek/deepseek-v4-flash"`.

### Pobieranie aktualnej listy modeli z API

```bash
curl -s https://api.kilo.ai/api/gateway/models \
  -H "Authorization: Bearer $(jq -r '.kilocode.key' ~/.local/share/opencode/auth.json)" \
  -H "X-KiloCode-OrganizationId: <your-org-id>" \
  | jq '.data[].id' | sort
```

### Zmiany wchodza w życie

Po restarcie OpenCode.

### Punkt obserwacji — latencja GLM 5.2

GLM 5.2 ma zmierzony TTFT ok. 10 sekund. Jesli architect lub autopilot okaza się zbyt wolne w praktyce, przełączyc te role na:

```
kilocode/deepseek/deepseek-v4-pro
```

Fallback ten zachowuje dobry reasoning (SWE-bench Verified 80.6%) przy niższym TTFT, kosztem gorszego Terminal-Bench i tool-callingu (co dla architect/autopilot jest mniej krytyczne niż dla debugger/devops).

---

## 9. Podsumowanie decyzji

| Wymiar | Wybor |
|---|---|
| Provider | Kilo Code — jeden provider dla wszystkich agentów, uproszczone rozliczenie |
| Modele frontier | Wykluczone (koszt) |
| Modele z retencja danych | Wykluczone (NDA, firmowy kod) |
| Warianty :discounted | Wykluczone (mayTrainOnYourPrompts + okrojone API) |
| Model reasoning/CLI | GLM 5.2 — #1 open-source Terminal-Bench i tool-calling |
| Model kodowania | Kimi K2.7 Code — #1 non-frontier KiloBench |
| Model tekstu/syntezy | Qwen3.7 Plus — 1M kontekst, dobra synteza |
| Model masowy/MCP | DeepSeek V4 Flash — 10x taniej, wystarczajacy dla prostych ról |
| Fallback (latencja GLM) | DeepSeek V4 Pro |

---

*Dokument utworzony: czerwiec 2026.*

*Krajobraz modeli LLM zmienia sie co kilka tygodni. Weryfikowac aktualne rankingi przed kolejna aktualizacja konfiguracji:*
- *kilo.ai/leaderboard (KiloBench — najtrafniejszy dla srodowiska Kilo Code)*
- *swebench.com*
- *lmarena.ai*
