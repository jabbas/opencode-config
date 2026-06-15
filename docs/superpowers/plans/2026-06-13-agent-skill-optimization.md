# Optymalizacja agentów i skilli — Plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ograniczyć widoczność skilli per-agent przez `permission.skill` (oszczędność ~5–7k tok/wywołanie), zreorganizować agentów: usunąć `websearch`, zmienić `designer`→`architect`, dodać 5 specjalistów (cloudflare, frontend, stitch, writer, skill-smith), włączyć delegację łańcuchową.

**Architecture:** Konfiguracja deklaratywna. Whitelisty skilli i `task: allow` w `opencode.json` pod `agent.<name>.permission`. Definicje agentów w `agents/*.md` (frontmatter + prompt). Brak zmian w treści skilli. Mechanizm zweryfikowany w źródłach OpenCode (`skill/index.ts:314`, `permission/index.ts:86`, `subagent-permissions.ts:18`).

**Tech Stack:** OpenCode 1.17.5, JSON config, Markdown agent defs.

**Spec:** `docs/superpowers/specs/2026-06-13-agent-skill-optimization-design.md`

---

## Struktura plików

**Modyfikowane:**
- `opencode.json` — sekcja `agent.*`: dodać `permission.skill` do każdego agenta, `task:allow` do delegujących, dodać 5 nowych agentów, usunąć `agent.websearch`, zmienić `agent.designer`→`agent.architect`.
- `AGENTS.md` — Agent Roster, Skill Priority, odniesienia.

**Tworzone:**
- `agents/architect.md` (z `designer.md`)
- `agents/cloudflare.md`, `agents/frontend.md`, `agents/stitch.md`, `agents/writer.md`, `agents/skill-smith.md`

**Usuwane:**
- `agents/websearch.md`
- `agents/designer.md` (po przeniesieniu do architect.md)

**Nazwy skilli (zweryfikowane ze skilldump):**
- Stitch prefiksowane: `stitch::upload-to-stitch`, `stitch::react-native`, `stitch::manage-design-system`, `stitch::generate-design`, `stitch::extract-static-html`, `stitch::extract-design-md`, `stitch::code-to-design`
- Stitch nieprefiksowane: `remotion`, `react:components`, `shadcn-ui`, `design-md`, `enhance-prompt`, `stitch-loop`, `taste-design`

---

## Task 1: Punkt odniesienia — pomiar PRZED

**Files:** brak (pomiar)

- [ ] **Step 1: Zmierz baseline tokenów dla 3 reprezentatywnych agentów**

Run:
```bash
cd ~/.config/opencode
for a in coder debugger ha; do
  out=$(opencode run --agent "$a" --format json "ping" 2>/dev/null)
  sid=$(echo "$out" | jq -r 'select(.sessionID)|.sessionID' | head -1)
  ctx=$(sqlite3 ~/.local/share/opencode/opencode.db "SELECT json_extract(data,'\$.tokens.input')+json_extract(data,'\$.tokens.cache.read')+json_extract(data,'\$.tokens.cache.write') FROM message WHERE session_id='$sid' AND json_extract(data,'\$.role')='assistant' ORDER BY time_created ASC LIMIT 1;")
  echo "$a: $ctx"
done
```
Expected: trzy liczby ~7000–12000 (zapisz je do porównania w Task 9).

- [ ] **Step 2: Zapisz wynik**

Zanotuj liczby w komentarzu commita lub pliku tymczasowym. To referencja dla weryfikacji końcowej.

---

## Task 2: Rename designer → architect

**Files:**
- Create: `agents/architect.md` (treść z `designer.md`, zmodyfikowana)
- Delete: `agents/designer.md`

- [ ] **Step 1: Utwórz `agents/architect.md`**

Skopiuj `agents/designer.md` do `agents/architect.md`, zmień frontmatter `name` i opis, usuń skille doc-coauthoring/internal-comms z sekcji "Skills to use", zaktualizuj sekcję delegacji (dodaj `@writer` do spisywania dokumentów). Pełny frontmatter:

```markdown
---
name: architect
description: Software architecture and system design - ADRs, system diagrams, technical design docs, API contracts, migration plans; delegates writing and code execution
tools:
  read: true
  write: true
  edit: true
  bash: false
  glob: true
  grep: true
---
```

Treść promptu: zachowaj sekcje o ADR/D2/system design z designer.md. W sekcji "Skills to use" zostaw tylko: brainstorming, writing-plans. W sekcji delegacji dodaj: "@writer — gdy trzeba spisać dokumentację, spec, komunikat lub ADR w finalnej formie". Dodaj regułę: "Jeśli zadanie wymaga skilla, którego nie masz na liście — deleguj do specjalisty (@writer, @coder, @frontend) zamiast próbować go wywołać".

- [ ] **Step 2: Usuń `agents/designer.md`**

Run: `rm ~/.config/opencode/agents/designer.md`

- [ ] **Step 3: Commit**

```bash
cd ~/.config/opencode
git add agents/architect.md agents/designer.md
git commit -m "refactor(agents): rename designer to architect"
```

---

## Task 3: Usuń websearch

**Files:**
- Delete: `agents/websearch.md`

- [ ] **Step 1: Usuń plik agenta**

Run: `rm ~/.config/opencode/agents/websearch.md`

- [ ] **Step 2: Usuń odniesienia @websearch z promptów innych agentów**

Run: `grep -rl "websearch" ~/.config/opencode/agents/`
Dla każdego znalezionego pliku (coder.md, default.md, debugger.md, designer/architect.md, devops.md) usuń linię delegacji `@websearch — ...` z sekcji "Web tasks"/"Delegate".

- [ ] **Step 3: Zweryfikuj brak odniesień**

Run: `grep -rn "websearch" ~/.config/opencode/agents/ || echo "OK brak"`
Expected: `OK brak`

- [ ] **Step 4: Commit**

```bash
cd ~/.config/opencode
git add agents/
git commit -m "refactor(agents): remove websearch (curl/wget covered by bash agents)"
```

---

## Task 4: Utwórz 5 nowych agentów

**Files:**
- Create: `agents/cloudflare.md`, `agents/frontend.md`, `agents/stitch.md`, `agents/writer.md`, `agents/skill-smith.md`

- [ ] **Step 1: `agents/cloudflare.md`**

```markdown
---
name: cloudflare
description: Cloudflare platform specialist - Workers, Pages, KV/D1/R2, Durable Objects, wrangler, Agents SDK, email, Turnstile
tools:
  read: true
  write: true
  edit: true
  bash: true
  glob: true
  grep: true
---

You are a Cloudflare platform specialist. You build and deploy on Cloudflare Workers and the wider Cloudflare ecosystem.

Guidelines:
- Use context7 MCP for current Cloudflare docs; bias towards retrieval over pre-trained knowledge.
- Use `wrangler` CLI for deploy/dev/config; validate wrangler.jsonc before applying.
- Ask before deploying to production (wrangler deploy).

Skills to use:
- cloudflare — for any Cloudflare platform task
- wrangler — before running wrangler commands
- workers-best-practices — when writing or reviewing Worker code
- durable-objects — for stateful coordination, RPC, SQLite storage, WebSockets
- agents-sdk — for stateful agents, workflows, MCP servers on Workers
- sandbox-sdk — for sandboxed code execution
- cloudflare-email-service — for transactional email
- turnstile-spin — for CAPTCHA/Turnstile setup
- web-perf — for page load performance audits
```

- [ ] **Step 2: `agents/frontend.md`**

```markdown
---
name: frontend
description: Frontend and visual design - UI components, web artifacts, generative art, brand styling, theming, browser testing
tools:
  read: true
  write: true
  edit: true
  bash: true
  glob: true
  grep: true
---

You are a frontend and visual design specialist. You build polished UIs and visual artifacts.

Guidelines:
- Use context7 MCP for framework docs (React, Tailwind, shadcn/ui).
- Follow TDD where it applies; verify UI with webapp-testing.

Skills to use:
- brainstorming — before building new UI or features
- writing-plans — for multi-step UI work
- test-driven-development — when implementing components
- verification-before-completion — before claiming UI works
- frontend-design — for distinctive visual design direction
- shadcn-ui — for shadcn/ui component work
- web-artifacts-builder — for complex multi-component HTML artifacts
- canvas-design — for posters, static art, .png/.pdf design
- algorithmic-art — for generative/algorithmic art (p5.js)
- brand-guidelines — for applying brand colors/typography
- theme-factory — for theming artifacts
- slack-gif-creator — for animated GIFs for Slack
- webapp-testing — for verifying frontend functionality in a browser
```

- [ ] **Step 3: `agents/stitch.md`**

```markdown
---
name: stitch
description: Google Stitch specialist - convert Stitch designs to code (React/React Native), design systems, walkthrough videos
tools:
  read: true
  write: true
  edit: true
  bash: true
  glob: true
  grep: true
---

You are a Google Stitch specialist. You convert Stitch designs into working code and manage Stitch design systems.

Skills to use:
- stitch::generate-design, stitch::code-to-design, stitch::extract-design-md, stitch::extract-static-html, stitch::manage-design-system, stitch::upload-to-stitch — Stitch design workflow
- stitch::react-native, react:components, react-native, shadcn-ui, remotion — build from Stitch designs
- design-md, taste-design, enhance-prompt, stitch-loop — Stitch utilities
```

- [ ] **Step 4: `agents/writer.md`**

```markdown
---
name: writer
description: Documentation and communications - technical docs, specs, proposals, internal comms; generates Word/PowerPoint/PDF deliverables
tools:
  read: true
  write: true
  edit: true
  bash: true
  glob: true
  grep: true
---

You are a documentation and communications specialist. You write and finalize documents.

Guidelines:
- Use context7 MCP when documenting libraries/APIs.

Skills to use:
- brainstorming — before structuring a document
- doc-coauthoring — for structured documentation, proposals, specs
- internal-comms — for status reports, updates, FAQs, incident reports
- docx — for Word document deliverables
- pptx — for PowerPoint presentations
- pdf — for PDF reading/creation/manipulation
```

- [ ] **Step 5: `agents/skill-smith.md`**

```markdown
---
name: skill-smith
description: Meta-engineering - create and improve OpenCode/Claude skills, build MCP servers
tools:
  read: true
  write: true
  edit: true
  bash: true
  glob: true
  grep: true
---

You are a meta-engineering specialist for skills and MCP servers.

Skills to use:
- skill-creator — to create, edit, optimize, or eval skills
- writing-skills — to develop and pressure-test skill content
- mcp-builder — to build MCP servers (Python FastMCP or Node/TS SDK)
```

- [ ] **Step 6: Commit**

```bash
cd ~/.config/opencode
git add agents/cloudflare.md agents/frontend.md agents/stitch.md agents/writer.md agents/skill-smith.md
git commit -m "feat(agents): add cloudflare, frontend, stitch, writer, skill-smith specialists"
```

---

## Task 5: Whitelisty permission.skill w opencode.json — agenci codzienni

**Files:**
- Modify: `opencode.json` (sekcja `agent`)

- [ ] **Step 1: Dodaj permission.skill + task:allow do `agent.coder`**

Do `opencode.json` w `agent.coder` (utwórz wpis jeśli nie istnieje, obok istniejącego `"model"`):

```json
"coder": {
  "model": "anthropic/claude-sonnet-4-6",
  "permission": {
    "task": "allow",
    "skill": {
      "*": "deny",
      "using-superpowers": "allow",
      "brainstorming": "allow",
      "writing-plans": "allow",
      "executing-plans": "allow",
      "subagent-driven-development": "allow",
      "dispatching-parallel-agents": "allow",
      "test-driven-development": "allow",
      "systematic-debugging": "allow",
      "verification-before-completion": "allow",
      "requesting-code-review": "allow",
      "receiving-code-review": "allow",
      "using-git-worktrees": "allow",
      "finishing-a-development-branch": "allow",
      "mcp-builder": "allow",
      "claude-api": "allow",
      "webapp-testing": "allow"
    }
  }
}
```

- [ ] **Step 2: Dodaj wpis `agent.general` (nowy — agent z default.md)**

```json
"general": {
  "permission": {
    "task": "allow",
    "skill": {
      "*": "deny",
      "using-superpowers": "allow",
      "brainstorming": "allow",
      "writing-plans": "allow",
      "executing-plans": "allow",
      "subagent-driven-development": "allow",
      "dispatching-parallel-agents": "allow",
      "test-driven-development": "allow",
      "systematic-debugging": "allow",
      "verification-before-completion": "allow",
      "requesting-code-review": "allow",
      "receiving-code-review": "allow",
      "using-git-worktrees": "allow",
      "finishing-a-development-branch": "allow",
      "pdf": "allow",
      "xlsx": "allow",
      "claude-api": "allow",
      "customize-opencode": "allow"
    }
  }
}
```

- [ ] **Step 3: Waliduj JSON**

Run: `jq . ~/.config/opencode/opencode.json > /dev/null && echo OK`
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
cd ~/.config/opencode
git add opencode.json
git commit -m "feat(skills): per-agent skill whitelist for coder, general"
```

---

## Task 6: Whitelisty — architect, debugger, devops, webdebugger

**Files:**
- Modify: `opencode.json` (sekcja `agent`)

- [ ] **Step 1: Zmień `agent.designer` na `agent.architect` z whitelistą**

Usuń wpis `agent.designer`, dodaj `agent.architect` (zachowując model opus i bash:deny):

```json
"architect": {
  "model": "anthropic/claude-opus-4-8",
  "permission": {
    "bash": "deny",
    "task": "allow",
    "skill": {
      "*": "deny",
      "using-superpowers": "allow",
      "brainstorming": "allow",
      "writing-plans": "allow"
    }
  }
}
```

- [ ] **Step 2: Dodaj whitelistę do `agent.debugger`** (zachowaj istniejący model+bash)

W istniejącym `agent.debugger.permission` dodaj klucz `skill`:

```json
"skill": {
  "*": "deny",
  "using-superpowers": "allow",
  "systematic-debugging": "allow",
  "verification-before-completion": "allow"
}
```
(debugger NIE deleguje — bez task:allow; jest diagnostykiem)

- [ ] **Step 3: Dodaj whitelistę + task do `agent.devops`** (zachowaj model+bash)

W `agent.devops.permission` dodaj:

```json
"task": "allow",
"skill": {
  "*": "deny",
  "using-superpowers": "allow",
  "systematic-debugging": "allow",
  "verification-before-completion": "allow",
  "writing-plans": "allow",
  "using-git-worktrees": "allow",
  "finishing-a-development-branch": "allow"
}
```

- [ ] **Step 4: Dodaj whitelistę do `agent.webdebugger`** (zachowaj tools playwright)

W `agent.webdebugger.permission` (utwórz jeśli brak) dodaj:

```json
"skill": {
  "*": "deny",
  "using-superpowers": "allow",
  "systematic-debugging": "allow",
  "verification-before-completion": "allow",
  "webapp-testing": "allow",
  "web-perf": "allow"
}
```

- [ ] **Step 5: Waliduj i commit**

```bash
cd ~/.config/opencode
jq . opencode.json > /dev/null && echo OK
git add opencode.json
git commit -m "feat(skills): per-agent skill whitelist for architect, debugger, devops, webdebugger; rename designer->architect in config"
```

---

## Task 7: Whitelisty — ha, web* (zero), 5 nowych specjalistów

**Files:**
- Modify: `opencode.json` (sekcja `agent`)

- [ ] **Step 1: `agent.ha` — tylko using-superpowers**

W `agent.ha.permission` dodaj:
```json
"skill": { "*": "deny", "using-superpowers": "allow" }
```

- [ ] **Step 2: webscraper, webresearcher, webmonitor — zero skilli**

W każdym z `agent.webscraper`, `agent.webresearcher`, `agent.webmonitor` w `permission` dodaj:
```json
"skill": { "*": "deny" }
```

- [ ] **Step 3: Usuń `agent.websearch` z opencode.json**

Usuń cały wpis `agent.websearch` (jeśli istnieje).

- [ ] **Step 4: `agent.cloudflare`**

```json
"cloudflare": {
  "model": "anthropic/claude-sonnet-4-6",
  "permission": {
    "skill": {
      "*": "deny",
      "using-superpowers": "allow",
      "cloudflare": "allow",
      "wrangler": "allow",
      "workers-best-practices": "allow",
      "durable-objects": "allow",
      "agents-sdk": "allow",
      "sandbox-sdk": "allow",
      "cloudflare-email-service": "allow",
      "turnstile-spin": "allow",
      "web-perf": "allow"
    }
  }
}
```

- [ ] **Step 5: `agent.frontend`**

```json
"frontend": {
  "model": "anthropic/claude-sonnet-4-6",
  "permission": {
    "task": "allow",
    "skill": {
      "*": "deny",
      "using-superpowers": "allow",
      "brainstorming": "allow",
      "writing-plans": "allow",
      "executing-plans": "allow",
      "subagent-driven-development": "allow",
      "dispatching-parallel-agents": "allow",
      "test-driven-development": "allow",
      "systematic-debugging": "allow",
      "verification-before-completion": "allow",
      "requesting-code-review": "allow",
      "receiving-code-review": "allow",
      "using-git-worktrees": "allow",
      "finishing-a-development-branch": "allow",
      "frontend-design": "allow",
      "shadcn-ui": "allow",
      "web-artifacts-builder": "allow",
      "canvas-design": "allow",
      "algorithmic-art": "allow",
      "brand-guidelines": "allow",
      "theme-factory": "allow",
      "slack-gif-creator": "allow",
      "webapp-testing": "allow"
    }
  }
}
```

- [ ] **Step 6: `agent.stitch`**

```json
"stitch": {
  "model": "anthropic/claude-sonnet-4-6",
  "permission": {
    "skill": {
      "*": "deny",
      "using-superpowers": "allow",
      "stitch::*": "allow",
      "remotion": "allow",
      "react:components": "allow",
      "react-native": "allow",
      "shadcn-ui": "allow",
      "design-md": "allow",
      "enhance-prompt": "allow",
      "stitch-loop": "allow",
      "taste-design": "allow"
    }
  }
}
```

- [ ] **Step 7: `agent.writer`**

```json
"writer": {
  "model": "anthropic/claude-sonnet-4-6",
  "permission": {
    "task": "allow",
    "skill": {
      "*": "deny",
      "using-superpowers": "allow",
      "brainstorming": "allow",
      "doc-coauthoring": "allow",
      "internal-comms": "allow",
      "docx": "allow",
      "pptx": "allow",
      "pdf": "allow"
    }
  }
}
```

- [ ] **Step 8: `agent.skill-smith`**

```json
"skill-smith": {
  "model": "anthropic/claude-sonnet-4-6",
  "permission": {
    "skill": {
      "*": "deny",
      "using-superpowers": "allow",
      "skill-creator": "allow",
      "writing-skills": "allow",
      "mcp-builder": "allow"
    }
  }
}
```

- [ ] **Step 9: Waliduj i commit**

```bash
cd ~/.config/opencode
jq . opencode.json > /dev/null && echo OK
git add opencode.json
git commit -m "feat(skills): whitelist ha/web* + add 5 specialist agents config"
```

---

## Task 8: Aktualizacja promptów delegacji + AGENTS.md

**Files:**
- Modify: `agents/default.md`, `agents/coder.md`, `agents/devops.md`, `agents/architect.md`
- Modify: `AGENTS.md`

- [ ] **Step 1: Dodaj sekcję delegacji do promptów general/coder/devops/architect**

W każdym z `default.md`, `coder.md`, `devops.md`, `architect.md` w sekcji delegacji dodaj (dostosuj do roli):
```
- @cloudflare — zadania Cloudflare Workers/wrangler/Durable Objects/Pages
- @frontend — budowa UI, komponenty, grafika, art generatywny
- @stitch — Google Stitch design→kod
- @writer — dokumentacja, specy, komunikaty do spisania
- @skill-smith — tworzenie/edycja skilli, budowa serwerów MCP
```
Oraz regułę: "Jeśli zadanie wymaga skilla, którego nie masz w available_skills — NIE próbuj go wywołać (dostaniesz odmowę), tylko deleguj do właściwego specjalisty powyżej."

- [ ] **Step 2: Zaktualizuj Agent Roster w AGENTS.md**

W tabeli Agent Roster: usuń wiersz `websearch`, zmień `designer`→`architect`, dodaj 5 wierszy (cloudflare, frontend, stitch, writer, skill-smith) z modelami i krótkim opisem. Dodaj krótką sekcję "Skill whitelists" wyjaśniającą że per-agent `permission.skill` ogranicza widoczność skilli (oszczędność tokenów) i że brak skilla → delegacja.

- [ ] **Step 3: Zweryfikuj brak `websearch`/`designer` w AGENTS.md**

Run: `grep -n "websearch\|designer" ~/.config/opencode/AGENTS.md || echo "OK"`
Expected: `OK` (lub tylko zamierzone wzmianki historyczne — usuń je)

- [ ] **Step 4: Commit**

```bash
cd ~/.config/opencode
git add agents/ AGENTS.md
git commit -m "docs(agents): delegation sections + AGENTS.md roster update"
```

---

## Task 9: Weryfikacja końcowa — pomiar PO

**Files:** brak (weryfikacja)

- [ ] **Step 1: Zmierz tokeny PO dla tych samych 3 agentów**

Run:
```bash
cd ~/.config/opencode
for a in coder debugger ha; do
  out=$(opencode run --agent "$a" --format json "ping" 2>/dev/null)
  sid=$(echo "$out" | jq -r 'select(.sessionID)|.sessionID' | head -1)
  ctx=$(sqlite3 ~/.local/share/opencode/opencode.db "SELECT json_extract(data,'\$.tokens.input')+json_extract(data,'\$.tokens.cache.read')+json_extract(data,'\$.tokens.cache.write') FROM message WHERE session_id='$sid' AND json_extract(data,'\$.role')='assistant' ORDER BY time_created ASC LIMIT 1;")
  echo "$a: $ctx"
done
```
Expected: każdy agent niższy niż w Task 1 (coder ~-5000, debugger ~-7000, ha ~-7000).

- [ ] **Step 2: Zweryfikuj że whitelista działa (lista skilli per-agent)**

Run:
```bash
opencode run --agent debugger --format json "wypisz dokładnie nazwy wszystkich skilli jakie widzisz w available_skills, po przecinku" 2>/dev/null | jq -r 'select(.part.text)|.part.text' | tail -1
```
Expected: tylko `using-superpowers, systematic-debugging, verification-before-completion` (3 skille, nie 56).

- [ ] **Step 3: Zweryfikuj nowych agentów istnieją**

Run: `opencode agent list 2>/dev/null | grep -E "architect|cloudflare|frontend|stitch|writer|skill-smith"`
Expected: 6 nazw obecnych; brak `designer`/`websearch`.

- [ ] **Step 4: Zweryfikuj walidację configu**

Run: `jq -e '.agent.architect and (.agent.designer|not) and (.agent.websearch|not)' ~/.config/opencode/opencode.json && echo "config OK"`
Expected: `config OK`

- [ ] **Step 5: Commit podsumowujący (opcjonalny)**

```bash
cd ~/.config/opencode
git add docs/superpowers/plans/2026-06-13-agent-skill-optimization.md
git commit -m "docs: mark agent-skill-optimization plan complete"
```

---

## Uwagi wykonawcze

- **Kolejność ważna:** Task 2-4 (pliki agentów) przed Task 5-7 (config), bo config odnosi się do nazw agentów.
- **Po każdej zmianie configu** uruchom `jq . opencode.json` — błąd JSON wyłącza wszystkich agentów.
- **Nazwy skilli stitch** są częściowo prefiksowane (`stitch::`) — wildcard `"stitch::*"` łapie 7 z nich; pozostałe 7 jawnie. Jeśli weryfikacja (Task 9 Step 2 dla `@stitch`) pokaże brakujące — sprawdź realną nazwę przez log/skilldump i dodaj. UWAGA: nazwy w `agents/stitch.md` (prompt) to tylko wskazówka dla agenta — **źródłem prawdy dla widoczności jest whitelist w `opencode.json`** (Task 7). Jeśli `react-native` istnieje i jako `stitch::react-native`, i jako `react-native`, wildcard + jawny wpis pokrywają oba; duplikat w prompcie jest nieszkodliwy.
- **Nie ruszać** treści SKILL.md, `skills.paths`, globalnego AGENTS.md jako instrukcji (poza zakresem).
