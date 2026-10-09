# Port opencode-kilo-gateway na OpenCode v2 (dual export)

- **Data:** 2026-10-09
- **Status:** Proposed
- **Ścieżka brainstormingu:** architektoniczna
- **Repo:** fork `jabbas/opencode-kilo-gateway` (`~/Projects/opencode-kilo-gateway`, remote
  `upstream` = `dragenet/opencode-kilo-gateway`, gałąź domyślna `master`)
- **Źródło faktów v2:** `~/Projects/opencode-v2.0.22` (tag v2.0.22). Pliki poniżej względem
  `packages/` tego worktree.

## 1. Kontekst

- `@dragenetlabs/opencode-kilo-gateway@0.1.0` to plugin **tylko v1** (`export const KiloGateway: Plugin`,
  `@opencode-ai/plugin` 1.18.2). Dostarcza dla providera `kilo`:
  - logowanie OAuth device-auth (`POST /api/device-auth/codes`, polling co 3 s),
  - wybór organizacji („Kilo · Switch organization”, statyczny `select` liczony przy ładowaniu),
  - `loader` → `{ baseURL: <api>/api/openrouter, apiKey, headers }` (nagłówek
    `X-KiloCode-OrganizationId` + nagłówki atrybucji),
  - dynamiczną listę modeli org-scoped (`provider.models`), tylko modele z `tools`.
- Na v2.0.22 plugin się nie ładuje (`Plugin must export a default definition…`, walidacja tylko
  domyślnego eksportu: `core/src/plugin/module.ts`). Zaobserwowane na maszynie prywatnej.
- v2 ma wbudowanego providera `kilo` z katalogu models.dev (`openai-compatible`,
  `https://api.kilo.ai/api/gateway`, integracja `kilo` z metodami `key` i `env: KILO_API_KEY`,
  394 modele) — bez device-auth, bez organizacji, bez listy org-scoped.
- v2 importuje jednorazowo `auth.json` z v1: wpis `kilo` (oauth) → credential
  `{ type:"oauth", methodID:"oauth", access, refresh, expires, metadata:{ accountID } }`
  (`core/src/database/migration/20260805200742_import_legacy_credentials.ts`).

## 2. Decyzja

Dodać implementację v2 obok v1 w jednym pakiecie (dual export
`export default { id: "kilo-gateway", server: KiloGateway, setup }`), zachowując v1 bez zmian
zachowania. Wysłać PR do `dragenet/opencode-kilo-gateway` (gałąź `master`) z gałęzi forka
`opencode-v2`.

**Model organizacji w v2: jeden credential na organizację (wariant A).** v2 przy każdym
udanym OAuth tworzy nowy credential i go aktywuje; plugin nie może credentiali edytować ani
usuwać. Przełączanie organizacji = natywne przełączanie kont (`opencode auth switch kilo`,
TUI `/connect` → „Connected accounts”). Wzorzec jak wbudowany OpenCode Console
(`core/src/plugin/provider/opencode.ts`: org w `metadata`, `label: c => orgName`).

Odrzucone: B (semantyka „Switch organization” v1 — w v2 i tak tworzy credential na każde
przełączenie), C (org w `ctx.storage` — metoda OAuth i tak musi zwrócić credential; dwa źródła
prawdy).

## 3. Fakty API v2 (zweryfikowane w źródłach)

| Potrzeba | API v2 | Źródło |
|---|---|---|
| Metody logowania | `ctx.integration.transform(e => e.method.update({ integrationID, method, authorize, label? }))` | `plugin/src/promise/integration.ts:56-85` |
| OAuth device flow | `authorize(answer) → { url, instructions, expiresAt?, mode:"auto", callback: Promise<Credential.OAuth> }` | `integration.ts:41` |
| Credential OAuth | `{ type:"oauth", methodID, refresh, access, expires, metadata? }` | `schema/src/credential.ts:32` |
| Formularz | pole `{ type:"string", key, title?, required?, options?, default? }`; CLI renderuje select; `answer` = `Record<string,string\|…>`; serwer nie stosuje `default`, puste wymagane → odrzucone | `schema/src/form.ts:50-61,139-147`, `core/src/form.ts:247-331` |
| Odczyt credentiala | `ctx.integration.connection.active("kilo")` → `connection.resolve(conn)` | `integration.ts:692-714` |
| Provider + modele | `ctx.provider.transform(e => { e.update("kilo", p => …); e.models.set("kilo", models) })`, `ctx.provider.reload()` | `plugin/src/promise/provider.ts:9-33` |
| Model | `Model.Info` (`id, modelID, providerID, name, capabilities{tools,input,output}, cost[] ($/1M), limit{context,output}, status, enabled, variants, time`) | `schema/src/model.ts:119-159` |
| Nagłówki/baseURL per żądanie | `ctx.session.hook("model.request", cb, { providerID:"kilo" })` — `event.headers`, `event.baseURL` (honorowany) | `core/src/session/model-request.ts:301-316` |
| Podmiana `Authorization` | **tylko** `ctx.session.hook("http.request", cb, { providerID:"kilo" })` — `model.request` jest nadpisywany przez auth z `credential.access` | `ai/src/route/transport/http.ts:58-67`, `model-request.ts:333-350` |
| Zmiana konta | zdarzenie `credential.switched` `{ integrationID, credentialID\|null }` — także przy nowym logowaniu; brak `credential.created` | `schema/src/credential.ts:21-24`, `core/src/credential.ts:121-166` |
| Metadane credentiala OAuth | scalane do ustawień providera; dla openai-compatible klucze spoza `baseURL, provider, timeout*, store, reasoningEffort` są bezwładne | `core/src/model-resolver.ts:203-231` |
| Odrzucenie `authorize()` | defekt → HTTP 500, ogólny komunikat; odrzucenie **callbacku** → `status:"failed"` z naszym komunikatem w CLI/TUI | `plugin/src/promise/adapter.ts:401-414`, `core/src/integration.ts:403-421` |
| Logowanie z pluginu | brak API; `console.*` psuje TUI → nie używamy | — |

## 4. Projekt

### 4.1 Moduły

```
src/
├── index.ts          # KiloGateway (v1, bez zmian) + export default { id:"kilo-gateway", server: KiloGateway, setup }
├── auth.ts, loader.ts, client.ts                       # tylko v1 — bez zmian
├── config.ts, token.ts, device-auth.ts, profile.ts, headers.ts   # wspólne — bez zmian
├── models.ts         # fetchRawKiloModels() (fetch, 401→public, timeout, filtr "tools") + toV1Model() (dzisiejsze mapowanie)
│                     # fetchKiloModels() zostaje jako złożenie obu (API v1 bez zmian)
└── v2/
    ├── index.ts        # setup(ctx): guard, KiloState, rejestracje, subskrypcja, cleanup
    ├── state.ts        # KiloState + refresh() z licznikiem generacji
    ├── integration.ts  # metody "oauth" i "organization"
    └── provider.ts     # provider.transform, hooki model.request/http.request, toV2Model()
```

- Typy v2: `import type` z `@opencode/plugin` (devDependency `~2.0.22`). Brak zależności runtime.
- `@opencode-ai/plugin` 1.18.2 zostaje (typy v1).

### 4.2 KiloState

```ts
interface KiloAuth { token: string; apiBase: string; orgId?: string; orgName?: string; expires: number; source: "env" | "credential" }
interface KiloState {
  auth?: KiloAuth          // aktywny credential lub env
  orgOptions: { value: string; label: string }[]   // z profilu; "personal" dla konta osobistego
  models?: Model.Info[]    // undefined = nie pobrano jeszcze → katalog zostaje
}
```

`refresh()`:
1. `gen = ++generation`.
2. Auth: `KILO_API_KEY` → `{ token, apiBase: resolveApiBase(KILO_API_URL), orgId: KILO_ORG_ID, source:"env" }`;
   inaczej `connection.active("kilo")` + `resolve` → jeśli `type === "oauth"`:
   `parseKiloToken(access)` → `{ token, apiBase: embedded ?? resolveApiBase(KILO_API_URL) }`,
   `orgId = KILO_ORG_ID || metadata.accountID`. Credential typu `key` (natywna metoda v2) →
   `token = key`, bez org.
3. Profil (`fetchProfile`) → `orgOptions` (tylko gdy jest token).
4. Modele: `fetchRawKiloModels({ baseUrl: apiBase, accountId: orgId, token })` → `toV2Model`.
5. Jeśli `gen !== generation` → porzuć wynik. Inaczej zapisz, `await integration.reload()`,
   `await provider.reload()`.
6. Każdy wyjątek łapany; częściowe wyniki (np. profil OK, modele nie) zapisywane osobno —
   poprzednie wartości zostają.

### 4.3 Integracja `kilo`

- **`oauth` — „Login with Kilo”** (`methodID: "oauth"` = ID importu z v1):
  - `authorize()`: `initiateDeviceAuth(apiBase)` w `try`. Sukces →
    `{ url: verificationUrl, instructions: "Approve this device in your browser. Code: <code>",
    expiresAt: now + expiresIn*1000, mode:"auto", callback }`.
    Błąd (np. 429) → `{ url: apiBase, instructions: <komunikat>, mode:"auto",
    callback: Promise.reject(new Error(<komunikat>)) }` (patrz §3: odrzucenie `authorize` = 500).
  - `callback`: `waitForDeviceAuthApproval` (limit = `expiresIn`); `denied`/`expired`/timeout →
    reject z konkretnym komunikatem. `approved` → profil → `defaultOrganizationId` →
    `{ type:"oauth", methodID:"oauth", access: token, refresh: token, expires: now+1y,
    metadata: { accountID?, orgName? } }`.
  - `label: c => "Kilo · " + (c.metadata?.orgName ?? c.metadata?.accountID ?? "Personal")`
    (credential z importu v1 ma tylko `accountID`). Ten sam `label` dla metody `organization`.
- **`organization` — „Kilo · Add organization”**: rejestrowana tylko gdy `state.auth.source === "credential"`
  i `orgOptions.length >= 2`. Formularz: jedno pole `{ type:"string", key:"organization",
  title:"Organization", required:true, options: orgOptions, default: state.auth.orgId ?? "personal" }`.
  `authorize(answer)` → bez przeglądarki; `callback` = `Promise.resolve({ type:"oauth",
  methodID:"organization", access/refresh/expires = aktywnego credentiala,
  metadata: { accountID: answer === "personal" ? undefined : answer, orgName } })`; brak tokenu →
  odrzucony callback „Log in with ‘Login with Kilo’ first”.
- Transformacja jest synchroniczna i czyta tylko `state` (replay-safe).

### 4.4 Provider `kilo`

- `provider.transform`:
  - `e.update("kilo", p => { p.settings = { ...p.settings, baseURL: (state.auth?.apiBase ?? DEFAULT_KILO_API_URL) + "/api/openrouter" };
    p.headers = { ...p.headers, ...attributionHeaders(version) } })` — nagłówki atrybucji jak
    `buildKiloHeaders` bez org (`X-KILOCODE-EDITORNAME`, `HTTP-Referer`, `X-Title`, `User-Agent`).
    Nadpisuje nagłówki wbudowanego `KiloPlugin` (ten działa tylko dla baseURL `/api/gateway`).
  - gdy `state.models` → `e.models.set("kilo", state.models)` (zastępuje katalog).
- `session.hook("model.request", …, { providerID:"kilo" })`: `X-KiloCode-OrganizationId`
  = `state.auth.orgId` (jeśli jest). BaseURL nie jest tu ustawiany — `provider.transform` już
  liczy go ze `state.auth.apiBase` (osadzony URL / `KILO_API_URL`) i jest ponownie stosowany po
  każdym `refresh()` przez `provider.reload()`.
- `session.hook("http.request", …, { providerID:"kilo" })`: rejestrowany zawsze; działa tylko gdy
  aktywny token ma osadzony prefiks URL — ustawia `Authorization: Bearer <token bez prefiksu>`.
- `toV2Model(raw)`: `id = modelID = raw.id`, `providerID:"kilo"`, `name`,
  `capabilities: { tools:true, input/output z architecture.*_modalities }`,
  `limit: { context: context_length, output: max_completion_tokens ?? top_provider.max_completion_tokens }`,
  `cost: [{ input, output, cache:{read,write} }]` (×1e6, jak v1), `status:"active"`, `enabled:true`,
  `variants: []`, `time.released: 0`. Bazą `Model.Info.default`-podobny literał (bez importu runtime).

### 4.5 `setup(ctx)`

1. Guard: brak `ctx.integration?.transform`, `ctx.provider?.transform` lub `ctx.session?.hook`
   → `return` (v1 i tak nie woła `setup`).
2. Rejestracje (integration, provider, oba hooki) — `await`.
3. Subskrypcja `ctx.event.subscribe({ signal })`: `credential.switched` z `integrationID === "kilo"` → `refresh()`.
4. `void refresh()` (w tle, nie blokuje startu).
5. Zwraca cleanup: `controller.abort()`.

### 4.6 Poza zakresem (YAGNI)

- `refresh` callback dla OAuth (token ~1 rok, Kilo nie ma endpointu refresh).
- Deduplikacja credentiali tej samej organizacji.
- Zmiany zachowania v1, migracja na `/api/gateway`, filtr NDA modeli.
- Przenoszenie wpisu pluginu w konfiguracji użytkownika (osobny krok po porcie).

## 5. Obsługa błędów

- Żaden wyjątek z `refresh()`, subskrypcji ani hooków nie wycieka (brak unhandled rejection).
- Hooki `model.request`/`http.request` są synchroniczne względem stanu (bez I/O).
- Starsze wyniki `refresh()` odrzucane po generacji.
- Komunikaty dla użytkownika wyłącznie przez odrzucony callback OAuth.

## 6. Testy (vitest)

1. **Regresja v1:** istniejące `test/*.test.ts` przechodzą (dopuszczalna jedynie zmiana importu
   po podziale `models.ts`); nowy test: `toV1Model(raw)` ≡ dotychczasowe mapowanie (snapshot
   sprzed refaktoru).
2. **v2 jednostkowe** (fake ctx + mock `fetch`): rejestracja metod (`organization` tylko przy ≥2
   opcjach i credentialu), kształt credentiala i `label`, 429 → odrzucony callback z komunikatem,
   denied/expired → reject, `provider.transform` (baseURL `<apiBase>/api/openrouter` także dla
   osadzonego URL i `KILO_API_URL`, nagłówki, `models.set` po refresh, brak `models.set` przed),
   `toV2Model`, `model.request` (org header, `KILO_ORG_ID` pierwszeństwo), `http.request`
   (Authorization tylko dla osadzonego URL), etykieta credentiala z importu v1,
   `credential.switched` → refresh + reloady, generacje, błędy sieci nie rzucają, guard v1,
   kształt default exportu, credential z importu v1 (`methodID:"oauth"`, `metadata.accountID`).
3. **Na żywo v2.0.22 (maszyna prywatna):** `opencode auth login kilo` (przeglądarka);
   `opencode models | grep -c '^kilo/'` = liczba modeli org-scoped; `opencode run -m kilo/<model> "ok"`;
   przy ≥2 organizacjach: „Add organization” + `opencode auth switch kilo` zmienia listę; brak
   `LoadError`.
4. **Na żywo v1 1.18.35 (maszyna służbowa):** zbudowany fork zamiast pakietu npm;
   `opencode run -m kilo/deepseek/deepseek-v4.1-flash "ok"` jak dotąd; potem przywrócenie npm.

## 7. Dostarczenie

- Gałąź `opencode-v2` w forku; changeset `minor` („Add OpenCode v2 support”).
- README: sekcja v2 (instalacja `plugins`, logowanie, organizacje = konta, minimalne v1 dla
  obiektowego default export: 1.18.29 wg dokumentacji OpenCode).
- PR do `dragenet/opencode-kilo-gateway` `master`: **twarda bramka** — pełny diff i treść PR do
  akceptacji użytkownika; ujawnienie AI (model, harness, pluginy); wyniki testów §6.3–6.4.
- Spec i plan zostają w repo konfiguracji (nie w PR).

## 8. Konsekwencje

- **+** Kilo działa na v1 i v2 z jednego pakietu; zalogowani w v1 nie logują się ponownie w v2.
- **+** Organizacje korzystają z natywnego przełączania kont v2 (CLI + TUI).
- **−** Każde „Add organization” tworzy credential (możliwe duplikaty, rozróżnialne etykietą).
- **−** Do pierwszego `refresh()` widoczny katalog models.dev (394 modele, w tym bez `tools`).
- **−** Błąd utworzenia kodu urządzenia otwiera w CLI stronę `apiBase` zanim pokaże komunikat.
- **Ryzyko:** młode API pluginów v2 (`@opencode/plugin` 2.0.x) — łagodzone guardem, testami na
  fake ctx i przypięciem devDependency.
