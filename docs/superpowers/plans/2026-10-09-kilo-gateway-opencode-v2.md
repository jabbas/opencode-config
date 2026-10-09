# opencode-kilo-gateway OpenCode v2 Port — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `@dragenetlabs/opencode-kilo-gateway` work on OpenCode v2.0.22 (device-auth login, organizations as accounts, org-scoped models) while v1 behavior stays unchanged, then PR it upstream.

**Architecture:** Dual default export `{ id: "kilo-gateway", server: KiloGateway, setup }`. Shared pure modules stay as they are; `models.ts` splits fetching from v1 mapping. New `src/v2/` holds a mutable `KiloState` refreshed in the background, an integration module (OAuth methods), a provider module (provider transform, request hooks, v2 model mapping) and `setup`.

**Tech Stack:** TypeScript 5.6 (`tsc -p tsconfig.json`), yarn 4.17.1, vitest 2, `@opencode-ai/plugin` 1.18.2 (v1 types), `@opencode/plugin` 2.0.22 (v2 types, devDependency, `import type` only), changesets.

**Spec:** `docs/superpowers/specs/2026-10-09-kilo-gateway-opencode-v2-design.md` (in `~/.config/opencode`)

## Locations

| What | Path |
|---|---|
| Fork (work here) | `~/Projects/opencode-kilo-gateway` — origin `jabbas/opencode-kilo-gateway`, upstream `dragenet/opencode-kilo-gateway`, base branch `master` |
| OpenCode v2.0.22 source | `~/Projects/opencode-v2.0.22` (paths below relative to `packages/`) |
| Spec / plan / ledger | `~/.config/opencode/docs/superpowers/…`, `~/.config/opencode/.superpowers/sdd/…` |
| Work machine (v1 1.18.35) | `ssh -A gdziegielewski@10.1.1.10`, commands via `zsh -lic "…"` |

## Global Constraints

- Default export exactly `{ id: "kilo-gateway", server: KiloGateway, setup }`; named export `KiloGateway` kept; v1 behavior unchanged.
- Existing `test/*.test.ts` pass unmodified (only allowed edit: an import path if a symbol moved — none should, since `fetchKiloModels`/`mapKiloModel` keep their names).
- No runtime dependencies. `@opencode/plugin` only as devDependency `2.0.22`, imported with `import type`.
- Type aliases used below: `V2Context` = the promise setup context type, `V2Model` = the `Model.Info` type — both from `@opencode/plugin` under the names recorded in Task 0 Step 4 (local structural type only where Task 0 found no export).
- Naming deviation from spec §4.1 (ruled): the v1 mapper keeps its existing name `mapKiloModel` (spec called it `toV1Model`) to keep the upstream diff minimal; raw models are stored in state and mapped to v2 in `provider.ts`.
- Integration/provider ID `"kilo"` (`PROVIDER_ID`). Login method ID `"oauth"` (matches v2's import of v1 credentials). Org method ID `"organization"`. Personal-account option value `"personal"` (v2 rejects empty required answers).
- Credential metadata keys: `accountID` (org id, same key v2 import uses) and `orgName`. Never `baseURL`, `provider`, `timeout*`, `store`, `reasoningEffort`, `metadata` (they change provider settings in v2).
- Chat base URL `<apiBase>/api/openrouter`; org scoping only via header `X-KiloCode-OrganizationId`; attribution headers = `buildKiloHeaders({ version: PACKAGE_VERSION })` without org.
- Env precedence as v1: `KILO_API_KEY` over credential; `KILO_ORG_ID` over credential org; `KILO_API_URL` when the token has no embedded base URL.
- Credential label: `"Kilo · " + (metadata.orgName ?? metadata.accountID ?? "Personal")`.
- Token expiry for new OAuth credentials: `now + 365 days` (as v1 `ONE_YEAR_MS`).
- Transform callbacks synchronous, read only `KiloState`, no side effects. Hooks do no I/O.
- No `console.*` anywhere in `src/v2/` (corrupts the v2 TUI). No exception may escape `refresh()`, subscriptions or hooks.
- `authorize()` never rejects: errors go through a rejected `callback` promise (v2 turns `authorize` rejections into HTTP 500).
- Relative imports in `src/v2/` follow the repo's existing style (check `tsconfig.json` `moduleResolution`; match how `src/index.ts` imports `./auth`).
- Fork branch `opencode-v2`; changeset `minor`. Upstream PR requires explicit human approval of the full diff and PR body (hard gate).

## Review Focus

1. A credential imported from v1 (`methodID:"oauth"`, `metadata:{accountID}` only, `access` possibly `https://host:token`) works with no re-login: org header set, label `Kilo · <accountID>`, embedded base URL honored. Tests in Tasks 2 and 3.
2. Rapid account switches (`credential.switched` twice) → state reflects the last one; an older slow `refresh()` never overwrites a newer one. Test in Task 2.
3. Network down at startup → `setup` resolves, catalog models stay, no unhandled rejection; later `refresh()` recovers. Tests in Tasks 2 and 5.
4. `KILO_API_KEY` set without stored credential → requests use env key/org; “Add organization” is not offered. Tests in Tasks 2, 3, 4.
5. Choosing “Personal account” in Add organization → credential without `accountID`, no org header on requests. Tests in Tasks 3 and 4.

---

### Task 0: Preparation

**Files:** `package.json`, `yarn.lock` (devDependency only).

- [ ] **Step 1:** In the fork: `git fetch upstream && git checkout -b opencode-v2 upstream/master`; confirm `origin/master == upstream/master` (`git log -1` both).
- [ ] **Step 2:** Baseline: `corepack enable && yarn install --immutable && yarn build && yarn test` → all green. Record test count.
- [ ] **Step 3:** `yarn add -D @opencode/plugin@2.0.22`; `yarn build && yarn test` still green.
- [ ] **Step 4:** Record in the report the exact type names `@opencode/plugin@2.0.22` exports for: setup context, `IntegrationOAuthMethodRegistration`, `IntegrationOAuthAuthorization`, `IntegrationEditor`, `ProviderEditor`, `Model.Info` (or equivalent), `Credential.OAuth`, the `model.request` / `http.request` events, and `Form` field. Verify against `~/Projects/opencode-v2.0.22/packages/plugin/src/promise/*.ts`. If any needed type is not exported, note it — later tasks then declare a minimal local structural type for that one item.
- [ ] **Step 5:** Commit: `chore: add @opencode/plugin 2.0.22 types (dev only)`.

### Task 1: Split model fetching from v1 mapping

**Files:** Modify `src/models.ts`. Test: `test/models.test.ts` (existing, unmodified) + new `test/models-raw.test.ts`.

**Interfaces — Produces:**
- `fetchRawKiloModels(options: FetchModelsOptions): Promise<KiloRawModel[]>` — today's fetch/timeout/401-fallback/HTTP-error logic, returns raw models already filtered by `supportsTools`.
- `fetchKiloModels(options)` unchanged signature/result = `fetchRawKiloModels` → `mapKiloModel(raw, "<baseUrl>/api/openrouter")` keyed by id.

- [ ] **Step 1:** Write `test/models-raw.test.ts`: `fetchRawKiloModels returns only tool-capable raw models` (mock fetch with 2 models, one without `"tools"` → length 1, object equals input raw); `401 with token falls back to public endpoint` (second call URL ends `/api/openrouter/models`, no Authorization); `org endpoint when accountId` (URL `/api/organizations/<encoded id>/models`).
- [ ] **Step 2:** `yarn test test/models-raw.test.ts` → FAIL (not exported).
- [ ] **Step 3:** Implement the split in `src/models.ts`.
- [ ] **Step 4:** `yarn test && yarn build` → all green; `git diff upstream/master -- test/` shows only the new file.
- [ ] **Step 5:** Commit: `refactor(models): expose raw model fetch for reuse`.

### Task 2: `src/v2/state.ts` — KiloState and refresh

**Files:** Create `src/v2/state.ts`, `test/v2/state.test.ts`.

**Interfaces — Produces:**
```ts
export const PERSONAL = "personal"
export interface OrgOption { value: string; label: string }          // value "personal" for the personal account
export interface KiloAuth {
  token: string            // without embedded URL prefix
  apiBase: string          // embedded base ?? resolveApiBase(env.KILO_API_URL)
  embeddedBaseUrl: boolean
  orgId?: string           // env.KILO_ORG_ID || metadata.accountID
  orgName?: string         // profile org name for orgId, else metadata.orgName
  source: "env" | "credential"
  credential?: { access: string; refresh: string; expires: number }   // raw stored values, only for source "credential" + oauth
}
export interface KiloState { auth?: KiloAuth; orgOptions: OrgOption[]; models?: KiloRawModel[] }
export interface ConnectionApi {
  active(integrationID: string): Promise<unknown | undefined>
  resolve(connection: unknown): Promise<{ type: string; access?: string; refresh?: string; expires?: number; key?: string; metadata?: Record<string, unknown> } | undefined>
}
export interface KiloStateDeps {
  connection: ConnectionApi
  env: Record<string, string | undefined>
  fetchImpl?: typeof fetch
  onChange: () => Promise<void>      // setup wires integration.reload() + provider.reload()
}
export function createKiloState(deps: KiloStateDeps): { state: KiloState; refresh(): Promise<void> }
```
- `refresh()` per spec §4.2: generation counter; env path; credential path (`oauth` → `parseKiloToken(access)`; `key` → token = key, no org); profile → `orgOptions` (`organizationSelectOptions` with `""` mapped to `PERSONAL`); models via `fetchRawKiloModels`; profile and models failures independent (keep previous values); stale generation discarded before any assignment; `onChange()` awaited once per successful (non-stale) refresh; never throws.

- [ ] **Step 1:** Write tests (mock connection + fetch):
  - `env key wins over credential`: env `KILO_API_KEY=k`, `KILO_ORG_ID=o` → `auth` `{ token:"k", orgId:"o", source:"env" }`, `credential` undefined.
  - `imported v1 credential` (RF1): resolve → `{ type:"oauth", access:"https://gw.example:tok", refresh:"…", expires:1, metadata:{ accountID:"org1" } }` → `token:"tok"`, `apiBase:"https://gw.example"`, `embeddedBaseUrl:true`, `orgId:"org1"`.
  - `KILO_ORG_ID overrides metadata org`.
  - `key credential has no org and no credential copy`.
  - `orgOptions maps personal to "personal"`: profile with 2 orgs → `[{value:"personal",…},{value:"a",…},{value:"b",…}]`.
  - `orgName resolved from profile`.
  - `models stored raw and tool-filtered`.
  - `profile failure keeps models; models failure keeps previous models` (RF3).
  - `network down: refresh resolves, state unchanged, onChange not called` (RF3).
  - `stale refresh discarded` (RF2): first refresh's fetch resolves after the second's → final `state.auth.orgId` is from the second; `onChange` called once for the second only.
  - `no credential and no env → auth undefined, orgOptions []`.
- [ ] **Step 2:** `yarn test test/v2/state.test.ts` → FAIL.
- [ ] **Step 3:** Implement `src/v2/state.ts`.
- [ ] **Step 4:** `yarn test && yarn build` → green.
- [ ] **Step 5:** Commit: `feat(v2): add Kilo state with background refresh`.

### Task 3: `src/v2/provider.ts` — provider transform, hooks, model mapping

**Files:** Create `src/v2/provider.ts`, `test/v2/provider.test.ts`.

**Interfaces:**
- Consumes: `KiloState`, `KiloAuth` (Task 2); `buildKiloHeaders`, `PACKAGE_VERSION`, `DEFAULT_KILO_API_URL`, `PROVIDER_ID`, `HEADER_ORGANIZATION_ID`, `parseApiPrice`, `KiloRawModel`.
- Produces:
  - `toV2Model(raw: KiloRawModel): V2Model` — spec §4.4 mapping: `id = modelID = raw.id`, `providerID:"kilo"`, `name: raw.name ?? raw.id`, `capabilities:{ tools:true, input, output }` (modality strings from `architecture`, default `["text"]` when empty), `limit:{ context: context_length, output: max_completion_tokens ?? top_provider.max_completion_tokens ?? context_length }`, `cost:[{ input, output, cache:{ read, write } }]` via `parseApiPrice`, `status:"active"`, `enabled:true`, `variants:[]`, `time:{ released:0 }`. Any other required `Model.Info` fields: fill as in `Model.Info.default` (`schema/src/model.ts:146-159`).
  - `registerProvider(ctx: Pick<V2Context,"provider"|"session">, state: KiloState): Promise<void>` — registers (all awaited):
    - `provider.transform`: `update("kilo")` → `settings.baseURL = (state.auth?.apiBase ?? DEFAULT_KILO_API_URL) + "/api/openrouter"`, `headers = { ...headers, ...buildKiloHeaders({ version: PACKAGE_VERSION }) }`; if `state.models` → `models.set("kilo", state.models.map(toV2Model))`.
    - `session.hook("model.request", e => { if (state.auth?.orgId) e.headers[HEADER_ORGANIZATION_ID] = state.auth.orgId }, { providerID:"kilo" })`.
    - `session.hook("http.request", e => { if (state.auth?.embeddedBaseUrl) e.request.headers.set("authorization", "Bearer " + state.auth.token) }, { providerID:"kilo" })`.

- [ ] **Step 1:** Write tests with a fake ctx recording transforms/hooks (run the transform callback against a fake editor):
  - `toV2Model maps pricing per million and limits` (prompt `"0.000002"` → input `2`; missing max tokens → context length).
  - `baseURL default` → `https://api.kilo.ai/api/openrouter`; `baseURL embedded` (RF1) → `https://gw.example/api/openrouter`; `KILO_API_URL` case via `state.auth.apiBase`.
  - `attribution headers set, no org header in provider headers`.
  - `models.set only when state.models defined`; replaying the transform twice yields the same result.
  - `model.request adds org header` / `no header for personal` (RF5) / `env org` (RF4, state with `source:"env", orgId:"o"`).
  - `http.request rewrites Authorization only for embedded URL tokens` (use a real `Request`).
  - `hooks registered with { providerID: "kilo" }`.
- [ ] **Step 2:** `yarn test test/v2/provider.test.ts` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `yarn test && yarn build` → green.
- [ ] **Step 5:** Commit: `feat(v2): provider transform, request hooks and model mapping`.

### Task 4: `src/v2/integration.ts` — login and organization methods

**Files:** Create `src/v2/integration.ts`, `test/v2/integration.test.ts`.

**Interfaces:**
- Consumes: `KiloState`, `PERSONAL` (Task 2); `initiateDeviceAuth`, `waitForDeviceAuthApproval`, `WaitForDeviceAuthOptions`, `fetchProfile`, `defaultOrganizationId`, `resolveApiBase`, `PROVIDER_ID`.
- Produces:
  - `export const LOGIN_METHOD_ID = "oauth"`, `export const ORG_METHOD_ID = "organization"`.
  - `credentialLabel(credential: { metadata?: Record<string, unknown> }): string` — Global Constraints label rule.
  - `registerIntegration(ctx: Pick<V2Context,"integration">, state: KiloState, deps?: { fetchImpl?: typeof fetch; waitOptions?: WaitForDeviceAuthOptions; now?: () => number; env?: Record<string,string|undefined> }): Promise<void>` — one `integration.transform` that:
    - always `method.update` login: method `{ id:"oauth", type:"oauth", label:"Login with Kilo" }`, `label: credentialLabel`, `authorize` per spec §4.3 (api base = `resolveApiBase(env.KILO_API_URL)`; `expiresAt = now() + expiresIn*1000`; init error → `{ url: apiBase, instructions: err.message, mode:"auto", callback: Promise.reject(err) }` with a no-op `.catch` attached to avoid an unhandled-rejection warning before core awaits it; `denied` → reject `"Kilo login was denied"`, `expired` → reject `"Kilo device code expired — try again"`; success → `{ type:"oauth", methodID:"oauth", access, refresh: token, expires: now()+365d, metadata: { accountID?, orgName? } }`, profile failure → no org metadata).
    - only when `state.auth?.source === "credential"` and `state.auth.credential` and `state.orgOptions.length >= 2`: `method.update` organization: method `{ id:"organization", type:"oauth", label:"Kilo · Add organization", form:[{ type:"string", key:"organization", title:"Organization", required:true, options: state.orgOptions, default: state.auth.orgId ?? PERSONAL }] }`, `label: credentialLabel`, `authorize(answer)` → `{ url: apiBase, instructions:"Adding Kilo organization…", mode:"auto", callback }` where callback resolves `{ type:"oauth", methodID:"organization", access/refresh/expires from state.auth.credential, metadata: personal ? { orgName:"Personal" } : { accountID, orgName: option label } }`.
    - when the org method should not be offered, `method.remove("kilo", <organization method>)` so a previously registered one disappears after reload.

- [ ] **Step 1:** Write tests (fake editor capturing `method.update`/`remove`; mock fetch; `waitOptions:{ sleep: async()=>{}, pollIntervalMs:1 }`; fixed `now`):
  - `login method always registered with id "oauth"`.
  - `device flow success → credential shape` (exact object incl. `expires`, `metadata.accountID`, `orgName`).
  - `429 → authorize resolves, callback rejects with the 429 message`.
  - `denied` / `expired` → callback rejects with the exact messages above.
  - `profile failure after approval → credential without metadata`.
  - `org method absent for env auth` (RF4), `absent with <2 options`, `present with 2+ options and credential`, form default = current org.
  - `org method personal → no accountID` (RF5); `org method org → accountID + orgName`; reuses stored access/refresh/expires verbatim.
  - `credentialLabel` for `{accountID}` only (RF1), `{orgName}`, `{}` → `"Kilo · org1"`, `"Kilo · Acme"`, `"Kilo · Personal"`.
  - `transform callback is pure`: calling it twice yields identical registrations and performs no fetch.
- [ ] **Step 2:** `yarn test test/v2/integration.test.ts` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `yarn test && yarn build` → green.
- [ ] **Step 5:** Commit: `feat(v2): device-auth login and organization accounts`.

### Task 5: `setup`, dual export, README, changeset

**Files:** Create `src/v2/index.ts`, `test/v2/setup.test.ts`, `.changeset/<name>.md`. Modify `src/index.ts` (default export only), `README.md`.

**Interfaces:**
- Consumes: Tasks 2–4 exports.
- Produces: `setup(ctx: unknown): Promise<(() => void) | void>` in `src/v2/index.ts`; `src/index.ts` adds `export default { id: "kilo-gateway", server: KiloGateway, setup }`.

`setup` order: guard (`ctx.integration?.transform`, `ctx.provider?.transform`, `ctx.session?.hook` functions; otherwise return) → `createKiloState({ connection: ctx.integration.connection, env: process.env, onChange: async () => { await ctx.integration.reload(); await ctx.provider.reload() } })` → `await registerIntegration` → `await registerProvider` → start subscription loop on `ctx.event.subscribe({ signal })` calling `refresh()` for `type === "credential.switched" && data.integrationID === "kilo"` (loop wrapped so errors and abort end it silently) → `void refresh()` → return `() => controller.abort()`.

- [ ] **Step 1:** Write `test/v2/setup.test.ts` with a full fake ctx (async-iterable `event.subscribe` driven by the test):
  - `guard: v1-shaped ctx → resolves undefined, nothing registered`.
  - `registers integration, provider transform and two session hooks`.
  - `initial refresh runs in background` (setup resolves before the mocked fetch resolves).
  - `credential.switched for kilo triggers refresh + integration.reload + provider.reload`; `for another integration → ignored`.
  - `cleanup aborts subscription` (loop ends, no further refresh).
  - `setup with fetch rejecting → resolves; no unhandled rejection` (RF3; use vitest `process.on("unhandledRejection")` spy).
  - `default export shape`: `id === "kilo-gateway"`, `server === KiloGateway`, `typeof setup === "function"`.
- [ ] **Step 2:** `yarn test test/v2/setup.test.ts` → FAIL.
- [ ] **Step 3:** Implement `src/v2/index.ts` and the default export.
- [ ] **Step 4:** `yarn test && yarn build` → green; `grep -n "export default" dist/index.js`; `ls dist/v2`.
- [ ] **Step 5:** README "OpenCode v2" section: install (`plugins` key, legacy `plugin` also read), login `opencode auth login kilo`, organizations = accounts (`Kilo · Add organization`, then `opencode auth switch kilo` or TUI `/connect` → Connected accounts), v1 logins imported automatically, env vars unchanged, v1 minimum for the object default export 1.18.29 (OpenCode docs). Only claims verified so far — no "tested on" wording until Tasks 6–7.
- [ ] **Step 6:** `yarn changeset` equivalent: create `.changeset/opencode-v2-support.md` with `"@dragenetlabs/opencode-kilo-gateway": minor` and a one-line summary.
- [ ] **Step 7:** Commit `feat: support OpenCode v2 plugin API (dual export, v1 unchanged)`; `git push -u origin opencode-v2`.

### Task 6: Live test on OpenCode v2.0.22 (private machine) — human in the loop

Needs the human for the browser login. Use a file symlink (v2.0.22 skips directory plugins without root `index`/`server`).

- [ ] **Step 1:** `ln -s ~/Projects/opencode-kilo-gateway/dist/index.js ~/.config/opencode/plugins/kilo-gateway.js`; temporarily remove `"@dragenetlabs/opencode-kilo-gateway"` from the `plugin` array in `~/.config/opencode/opencode.json` working tree (do not commit; restore in Step 6).
- [ ] **Step 2:** `opencode run --standalone --print-logs --log-level DEBUG "ok"` from `~/.config/opencode` → log shows plugin `kilo-gateway` loaded, no `LoadError`.
- [ ] **Step 3:** Human runs `opencode auth login kilo` → chooses “Login with Kilo” → approves in browser. Then `opencode models | grep -c '^kilo/'` (expect org-scoped count, not 394) and `opencode run --standalone -m kilo/<a listed model> "reply ok"` → `ok`.
- [ ] **Step 4:** If ≥2 organizations: `opencode auth login kilo --method organization` → pick another org → `opencode models | grep -c '^kilo/'` changes; `opencode auth switch kilo` back → count returns.
- [ ] **Step 5:** Save evidence (log lines, counts, transcript) to `~/Projects/opencode-kilo-gateway/.pr-evidence.md` (untracked).
- [ ] **Step 6:** Restore `opencode.json` working tree; remove the symlink.

### Task 7: Live test on OpenCode v1.18.35 (work machine)

- [ ] **Step 1:** On the work machine: clone/fetch `jabbas/opencode-kilo-gateway` branch `opencode-v2` into `~/Projects/opencode-kilo-gateway`, `yarn install --immutable && yarn build`.
- [ ] **Step 2:** Point opencode at the build: in `~/.config/opencode/opencode.json` working tree replace `"@dragenetlabs/opencode-kilo-gateway"` by the absolute `file://…/dist/index.js` path (or `plugins/kilo-gateway.js` symlink — whichever v1 1.18.35 loads; verify with log). Do not commit.
- [ ] **Step 3:** `opencode run --print-logs --log-level DEBUG -m kilo/deepseek/deepseek-v4.1-flash "reply ok"` → `ok`; log shows the plugin loaded once, no load error for the object default export; `opencode models | grep -c '^kilo/'` equals the pre-change count.
- [ ] **Step 4:** Append evidence to `.pr-evidence.md` (on the private machine copy).
- [ ] **Step 5:** Restore `opencode.json` (`git checkout -- opencode.json` only if it has no other local changes — check `git diff` first) and verify `opencode run -m kilo/deepseek/deepseek-v4.1-flash "ok"` again.

### Task 8: Upstream PR (HARD GATE)

- [ ] **Step 1:** `git fetch upstream && git rebase upstream/master`; `yarn test && yarn build`; `git push --force-with-lease`.
- [ ] **Step 2:** Search prior work: `gh pr list -R dragenet/opencode-kilo-gateway --state all`, `gh issue list … --state all` (terms: v2, opencode 2, setup, LoadError). Open v2 work → STOP, report.
- [ ] **Step 3:** Draft PR body (`.superpowers/sdd/<plan>/pr-body.md`): problem (v2 loader rejects v1-only module — quote the error text, observed on v2.0.22), design (organizations as v2 accounts; why), changes per module, v1 unchanged (tests untouched + live 1.18.35), live v2.0.22 evidence, limitations (spec §8), disclosure (model, harness, plugins). Full diff file `git diff upstream/master...opencode-v2`.
- [ ] **Step 4:** Show the human the full diff and body. **Wait for explicit approval.**
- [ ] **Step 5:** `gh pr create -R dragenet/opencode-kilo-gateway --base master --head jabbas:opencode-v2 --title "Add OpenCode v2 support (dual export, v1 unchanged)" --body-file <pr-body.md>`.
