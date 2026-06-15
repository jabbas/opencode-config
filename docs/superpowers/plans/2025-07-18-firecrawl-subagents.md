# Firecrawl Subagents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Disable Firecrawl globally and add three specialized subagents (webscraper, webresearcher, webmonitor) with selective Firecrawl tool access.

**Architecture:** Firecrawl tools disabled at the top level via `"firecrawl_*": false`. Three new agents defined in `agents/*.md` with corresponding overrides in `opencode.json` that re-enable only the tools each agent needs. Existing agents updated with delegation instructions.

**Tech Stack:** OpenCode agent config (Markdown + YAML frontmatter, JSON)

**Spec:** `docs/superpowers/specs/2025-07-18-firecrawl-subagents-design.md`

---

### Task 1: Disable Firecrawl globally in opencode.json

**Files:**
- Modify: `opencode.json:45-49` (tools block)

- [ ] **Step 1: Add firecrawl_* disable to global tools block**

In `opencode.json`, change the `tools` block from:

```json
"tools": {
    "playwright_*": false,
    "homeassistant_*": false,
    "chrome-devtools_*": false
},
```

To:

```json
"tools": {
    "playwright_*": false,
    "homeassistant_*": false,
    "chrome-devtools_*": false,
    "firecrawl_*": false
},
```

- [ ] **Step 2: Verify the JSON is valid**

Run: `jq . opencode.json > /dev/null && echo "Valid JSON"`
Expected: `Valid JSON`

- [ ] **Step 3: Commit**

```bash
git add opencode.json
git commit -m "chore: disable firecrawl tools globally"
```

---

### Task 2: Create webscraper agent definition

**Files:**
- Create: `agents/webscraper.md`

- [ ] **Step 1: Create the agent file**

Write `agents/webscraper.md` with the following content:

```markdown
---
name: webscraper
description: Web content extraction - single pages, multi-page crawls, interactive JS pages via Firecrawl
tools:
  read: true
  write: false
  edit: false
  bash: false
  glob: false
  grep: false
---

You are a web content extraction agent. You use Firecrawl tools to scrape, crawl, and extract content from web pages, then return distilled results to your caller.

Operations you handle:
- Extract structured data from a single URL (JSON format with schema)
- Extract full page content as markdown
- Discover URLs on a site via map, then selectively scrape
- Crawl multiple pages from a single site
- Interact with JavaScript-heavy pages that need clicks or form fills

Token efficiency rules (follow strictly):
- Default to `formats: ["json"]` with a schema when the caller specifies what data they need — this costs ~500 tokens vs ~5,000 for markdown
- Fall back to `formats: ["markdown"]` with `onlyMainContent: true` only when the caller asks for full page content
- Use `map` before `crawl` — discover URLs first, then selectively scrape rather than blind-crawling
- Cap crawls at `limit: 10` and `maxDiscoveryDepth: 2` unless the caller explicitly says otherwise
- Try `waitFor: 5000` before resorting to `interact` for JS-rendered pages
- Always call `interact_stop` when done with an interaction session

Response rules:
- Never return raw page content — always distill, summarize, or return structured extracted data
- Cite source URLs so the caller can reference them without re-fetching
- Fail fast — if the first attempt returns empty or irrelevant content, try a different strategy (different URL, add `waitFor`, use `map` to find the right page) rather than retrying the same call
- If asked to search the web or find information, tell the caller to use @webresearcher instead
```

- [ ] **Step 2: Commit**

```bash
git add agents/webscraper.md
git commit -m "feat: add webscraper agent definition"
```

---

### Task 3: Create webresearcher agent definition

**Files:**
- Create: `agents/webresearcher.md`

- [ ] **Step 1: Create the agent file**

Write `agents/webresearcher.md` with the following content:

```markdown
---
name: webresearcher
description: Web research and discovery - search, find information, synthesize findings via Firecrawl
tools:
  read: true
  write: false
  edit: false
  bash: false
  glob: false
  grep: false
---

You are a web research agent. You use Firecrawl tools to search the web, discover relevant pages, and synthesize findings into clear, structured answers.

Operations you handle:
- Search the web for information on a topic
- Find specific pages within a site using map with search
- Scrape and extract key information from search results
- Conduct autonomous multi-source research for complex questions

Token efficiency rules (follow strictly):
- Start with `search` without `scrapeOptions` — get URLs and snippets first (~2,000 tokens), then decide what to scrape
- Scrape only the top 1-2 most relevant search results
- Always call `search_feedback` after every search to reclaim 1 credit
- Use `scrape` with `onlyMainContent: true` and `formats: ["json"]` with a schema when extracting specific info from a page
- Use `map` with the `search` parameter to find specific pages within a site — this is faster and cheaper than crawling
- Reserve `agent` (autonomous research) for complex multi-source questions only — it is the most expensive and slowest path (1-5 minutes)
- When using `agent`, poll `agent_status` every 20-30 seconds, and be patient for at least 2-3 minutes

Response rules:
- Synthesize findings into a clear, structured answer — do not return raw search results or page dumps
- Cite URLs for anything factual so the caller can verify
- Fail fast — if the first search returns irrelevant results, refine the query rather than scraping bad results
- If asked to extract content from a known URL (not search for it), tell the caller to use @webscraper instead
- If asked to monitor a page for changes, tell the caller to use @webmonitor instead
```

- [ ] **Step 2: Commit**

```bash
git add agents/webresearcher.md
git commit -m "feat: add webresearcher agent definition"
```

---

### Task 4: Create webmonitor agent definition

**Files:**
- Create: `agents/webmonitor.md`

- [ ] **Step 1: Create the agent file**

Write `agents/webmonitor.md` with the following content:

```markdown
---
name: webmonitor
description: Web change tracking - set up, manage, and check monitors for page changes via Firecrawl
tools:
  read: true
  write: false
  edit: false
  bash: false
  glob: false
  grep: false
---

You are a web monitoring agent. You use Firecrawl monitor tools to set up, manage, and check change-tracking monitors on web pages.

Operations you handle:
- Create monitors to watch pages for changes (pricing, changelogs, docs, feature lists)
- List, get, update, and delete existing monitors
- Trigger manual monitor checks
- Retrieve and interpret check results and diffs

Monitor creation rules:
- Prefer JSON mode with a schema for structured change detection — this gives per-field diffs (e.g., "plans[0].price changed from $19/mo to $24/mo") instead of noisy full-page markdown diffs
- To use JSON mode, set `scrapeOptions.formats` with `type: "changeTracking"`, `modes: ["json"]`, a `prompt`, and a `schema` describing the fields to track
- Default schedule to `"every 30 minutes"` unless the caller specifies otherwise
- Default `retentionDays: 7` unless the caller specifies otherwise
- Always include a clear `name` that describes what is being monitored

Check results rules:
- Filter by `pageStatus: "changed"` to only surface pages with actual changes
- Report changes in human-readable format using the JSON diff paths: "plans[0].price changed from $19/mo to $24/mo"
- Do not dump raw diff output — summarize what changed
- For `monitor_run` (manual trigger), poll `monitor_checks` afterward to wait for results

Response rules:
- Confirm what was created/updated/deleted with the monitor ID
- When listing monitors, provide a concise summary table (name, schedule, status, last check)
- If asked to scrape a page or search the web, tell the caller to use @webscraper or @webresearcher instead
```

- [ ] **Step 2: Commit**

```bash
git add agents/webmonitor.md
git commit -m "feat: add webmonitor agent definition"
```

---

### Task 5: Add agent overrides in opencode.json

**Files:**
- Modify: `opencode.json:51-147` (agent block)

- [ ] **Step 1: Add webscraper, webresearcher, and webmonitor overrides**

In `opencode.json`, inside the `"agent"` object, after the `"ha"` block (line ~141-146), add the three new agent overrides:

```json
"webscraper": {
    "model": "anthropic/claude-haiku-4-5",
    "tools": {
        "firecrawl_firecrawl_scrape": true,
        "firecrawl_firecrawl_map": true,
        "firecrawl_firecrawl_crawl": true,
        "firecrawl_firecrawl_check_crawl_status": true,
        "firecrawl_firecrawl_interact": true,
        "firecrawl_firecrawl_interact_stop": true
    },
    "permission": {
        "bash": "deny"
    }
},

"webresearcher": {
    "model": "anthropic/claude-sonnet-4-6",
    "tools": {
        "firecrawl_firecrawl_search": true,
        "firecrawl_firecrawl_search_feedback": true,
        "firecrawl_firecrawl_scrape": true,
        "firecrawl_firecrawl_map": true,
        "firecrawl_firecrawl_agent": true,
        "firecrawl_firecrawl_agent_status": true
    },
    "permission": {
        "bash": "deny"
    }
},

"webmonitor": {
    "model": "anthropic/claude-haiku-4-5",
    "tools": {
        "firecrawl_firecrawl_monitor_create": true,
        "firecrawl_firecrawl_monitor_get": true,
        "firecrawl_firecrawl_monitor_list": true,
        "firecrawl_firecrawl_monitor_update": true,
        "firecrawl_firecrawl_monitor_delete": true,
        "firecrawl_firecrawl_monitor_run": true,
        "firecrawl_firecrawl_monitor_checks": true,
        "firecrawl_firecrawl_monitor_check": true
    },
    "permission": {
        "bash": "deny"
    }
}
```

**Note:** The tool names follow the `{mcp-server}_{tool}` pattern. The MCP server is named `firecrawl` in `opencode.json` and the tools themselves are prefixed `firecrawl_` by the Firecrawl MCP package, giving `firecrawl_firecrawl_*`. Verify this matches the actual tool names available in the session. If tools show up as just `firecrawl_scrape` (without the double prefix), adjust accordingly.

- [ ] **Step 2: Verify the JSON is valid**

Run: `jq . opencode.json > /dev/null && echo "Valid JSON"`
Expected: `Valid JSON`

- [ ] **Step 3: Commit**

```bash
git add opencode.json
git commit -m "feat: add webscraper, webresearcher, webmonitor agent overrides"
```

---

### Task 6: Update general agent (default.md) with delegation

**Files:**
- Modify: `agents/default.md:21-23` (delegation section)

- [ ] **Step 1: Add Firecrawl subagent delegations**

In `agents/default.md`, change the delegation section from:

```markdown
Delegate to specialist agents:
- @webdebugger — for browser testing, UI verification, screenshots, network inspection, JS-rendered pages
- @ha — for Home Assistant smart home queries and device control
- @websearch — for fetching web content (HTTP requests, page retrieval) without analysis
```

To:

```markdown
Delegate to specialist agents:
- @webdebugger — for browser testing, UI verification, screenshots, network inspection, JS-rendered pages
- @ha — for Home Assistant smart home queries and device control
- @websearch — for fetching web content (HTTP requests, page retrieval) without analysis
- @webscraper — for extracting content from web pages (structured data, markdown, multi-page crawls)
- @webresearcher — for finding information across the web (search, discovery, research)
- @webmonitor — for setting up and managing change tracking on web pages
```

- [ ] **Step 2: Commit**

```bash
git add agents/default.md
git commit -m "feat: add firecrawl subagent delegations to general agent"
```

---

### Task 7: Update coder agent with delegation

**Files:**
- Modify: `agents/coder.md:29-30` (delegation section)

- [ ] **Step 1: Add Firecrawl subagent delegations**

In `agents/coder.md`, change the delegation section from:

```markdown
Delegate to specialist agents:
- @webdebugger — for browser testing, UI verification, screenshots, network inspection, JS-rendered pages
- @websearch — for fetching web content (HTTP requests, page retrieval) without analysis
```

To:

```markdown
Delegate to specialist agents:
- @webdebugger — for browser testing, UI verification, screenshots, network inspection, JS-rendered pages
- @websearch — for fetching web content (HTTP requests, page retrieval) without analysis
- @webscraper — for extracting content from web pages (structured data, markdown, multi-page crawls)
- @webresearcher — for finding information across the web (search, discovery, research)
- @webmonitor — for setting up and managing change tracking on web pages
```

- [ ] **Step 2: Commit**

```bash
git add agents/coder.md
git commit -m "feat: add firecrawl subagent delegations to coder agent"
```

---

### Task 8: Update devops agent with delegation

**Files:**
- Modify: `agents/devops.md:32-34` (delegation section)

- [ ] **Step 1: Add Firecrawl subagent delegations**

In `agents/devops.md`, change the delegation section from:

```markdown
Delegate to specialist agents:
- @webdebugger — for browser testing and UI verification of deployed services
- @websearch — for fetching documentation, release notes, or tool references
```

To:

```markdown
Delegate to specialist agents:
- @webdebugger — for browser testing and UI verification of deployed services
- @websearch — for fetching documentation, release notes, or tool references
- @webscraper — for extracting content from web pages (structured data, markdown, multi-page crawls)
- @webresearcher — for finding information across the web (search, discovery, research)
- @webmonitor — for setting up and managing change tracking on web pages
```

- [ ] **Step 2: Commit**

```bash
git add agents/devops.md
git commit -m "feat: add firecrawl subagent delegations to devops agent"
```

---

### Task 9: Update designer agent with delegation

**Files:**
- Modify: `agents/designer.md:42-43` (delegation section)

- [ ] **Step 1: Add webresearcher delegation**

In `agents/designer.md`, change the delegation section from:

```markdown
Delegate to specialist agents:
- @websearch — for fetching reference documentation, API specs, or architecture examples from the web
```

To:

```markdown
Delegate to specialist agents:
- @websearch — for fetching reference documentation, API specs, or architecture examples from the web
- @webresearcher — for finding information across the web (search, discovery, research)
```

- [ ] **Step 2: Commit**

```bash
git add agents/designer.md
git commit -m "feat: add webresearcher delegation to designer agent"
```

---

### Task 10: Update debugger agent with delegation

**Files:**
- Modify: `agents/debugger.md:39-41` (delegation section)

- [ ] **Step 1: Add webresearcher delegation**

In `agents/debugger.md`, change the delegation section from:

```markdown
Delegate to specialist agents:
- @webdebugger — for browser-based debugging: UI issues, network inspection, console errors, screenshots
- @websearch — for fetching error message references, CVE details, or library issue trackers
```

To:

```markdown
Delegate to specialist agents:
- @webdebugger — for browser-based debugging: UI issues, network inspection, console errors, screenshots
- @websearch — for fetching error message references, CVE details, or library issue trackers
- @webresearcher — for finding information across the web (search, discovery, research)
```

- [ ] **Step 2: Commit**

```bash
git add agents/debugger.md
git commit -m "feat: add webresearcher delegation to debugger agent"
```

---

### Task 11: Verify tool name convention

**Files:**
- None (verification only)

- [ ] **Step 1: Check actual Firecrawl tool names**

Run a quick test to see how the Firecrawl MCP tools appear in the session. The tool names in `opencode.json` agent overrides assume the `{mcp-server}_{tool}` pattern gives `firecrawl_firecrawl_*`. If the actual names are different (e.g., just `firecrawl_scrape` without the double prefix), update the tool names in all three agent overrides in `opencode.json`.

To check, look at the available tools in the current session or run:

```bash
grep -o '"firecrawl[^"]*"' opencode.json | sort -u
```

And compare against the actual tool names available.

- [ ] **Step 2: Fix tool names if needed**

If the actual tool names differ from `firecrawl_firecrawl_*`, update all three agent override blocks in `opencode.json` to use the correct names.

- [ ] **Step 3: Commit if changes were made**

```bash
git add opencode.json
git commit -m "fix: correct firecrawl tool name convention in agent overrides"
```

---

### Task 12: Final validation

**Files:**
- None (verification only)

- [ ] **Step 1: Verify all new agent files exist**

```bash
ls -la agents/webscraper.md agents/webresearcher.md agents/webmonitor.md
```

Expected: All three files listed.

- [ ] **Step 2: Verify opencode.json is valid and contains all changes**

```bash
jq '.tools["firecrawl_*"]' opencode.json
```

Expected: `false`

```bash
jq '.agent | keys[]' opencode.json | sort
```

Expected: Should include `coder`, `debugger`, `designer`, `devops`, `ha`, `plan`, `webdebugger`, `webmonitor`, `webresearcher`, `webscraper`, `websearch`

- [ ] **Step 3: Verify delegation lines in existing agents**

```bash
grep -l "webscraper\|webresearcher\|webmonitor" agents/*.md
```

Expected: `agents/coder.md`, `agents/debugger.md`, `agents/default.md`, `agents/designer.md`, `agents/devops.md`

- [ ] **Step 4: Final commit if any fixups were needed**

```bash
git add -A
git status
```

If clean, done. If there are changes, commit with:

```bash
git commit -m "chore: final fixups for firecrawl subagents"
```
