# Firecrawl Subagents Design

**Date:** 2025-07-18
**Status:** Approved

## Problem

Firecrawl is available as an MCP server (self-hosted at `<firecrawl-host>`) but all agents have unrestricted access to all Firecrawl tools. This creates two risks:

1. **Token waste** — a careless `scrape` without `onlyMainContent` or a blind `crawl` can burn 25,000-50,000+ tokens in a single call, consuming 10-25% of the context window.
2. **No specialization** — agents don't have guidance on efficient Firecrawl usage patterns, leading to suboptimal tool selection (e.g., crawling when map+scrape would suffice).

## Solution

Disable Firecrawl globally and create three purpose-built subagents, each with only the Firecrawl tools needed for its specific job. Parent agents delegate web tasks to these subagents via the Task tool.

Context7 remains the primary source for library/framework documentation. Firecrawl is the secondary, broader web tool.

## Architecture

```
Parent agent (coder, devops, general, designer, debugger)
  |
  +-- Need library docs? --> context7 (first choice)
  |
  +-- Need web content extracted? --> @webscraper (Haiku 4.5)
  |     firecrawl: scrape, map, crawl, check_crawl_status, interact, interact_stop
  |
  +-- Need to find/research something? --> @webresearcher (Sonnet 4.6)
  |     firecrawl: search, search_feedback, scrape, map, agent, agent_status
  |
  +-- Need to watch for changes? --> @webmonitor (Haiku 4.5)
        firecrawl: monitor_create, monitor_get, monitor_list, monitor_update,
        monitor_delete, monitor_run, monitor_checks, monitor_check
```

## Agent Definitions

### webscraper — Content Extraction Agent

- **Model:** claude-haiku-4-5
- **Firecrawl tools:** scrape, map, crawl, check_crawl_status, interact, interact_stop
- **Permissions:** Read-only (bash denied, no write, no edit)
- **Purpose:** Extract content from known URLs — single pages, multi-page crawls, or interactive JS-heavy pages

**System prompt responsibilities:**

- Default to `formats: ["json"]` with a schema when the parent specifies what data they need (~200-1,000 tokens vs ~5,000 for markdown)
- Fall back to `formats: ["markdown"]` with `onlyMainContent: true` only when the parent asks for full page content
- Use `map` before `crawl` — discover URLs first, then selectively scrape rather than blind-crawling
- Cap crawls at `limit: 10` and `maxDiscoveryDepth: 2` unless the parent explicitly overrides
- Try `waitFor: 5000` before resorting to `interact` for JS-rendered pages
- Always call `interact_stop` when done with an interaction session
- Return distilled results to the parent — not raw page dumps

### webresearcher — Search & Discovery Agent

- **Model:** claude-sonnet-4-6
- **Firecrawl tools:** search, search_feedback, scrape, map, agent, agent_status
- **Permissions:** Read-only (bash denied, no write, no edit)
- **Purpose:** Find information across the web — search, discover relevant pages, synthesize findings

**System prompt responsibilities:**

- Start with `search` without `scrapeOptions` — get URLs and snippets first (~2,000 tokens), then selectively scrape the top 1-2 most relevant results
- Always call `search_feedback` after a search to reclaim 1 credit
- Use `scrape` with `onlyMainContent: true` and `formats: ["json"]` when extracting specific info from a search result
- Use `map` with the `search` parameter to find specific pages within a site
- Reserve `agent` (autonomous research) for complex multi-source questions — it's the most expensive and slowest path (1-5 minutes)
- When using `agent`, poll `agent_status` every 20-30 seconds, be patient for 2-3 minutes
- Synthesize findings into a clear, structured answer with cited URLs
- Do not return raw search results

### webmonitor — Change Tracking Agent

- **Model:** claude-haiku-4-5
- **Firecrawl tools:** monitor_create, monitor_get, monitor_list, monitor_update, monitor_delete, monitor_run, monitor_checks, monitor_check
- **Permissions:** Read-only (bash denied, no write, no edit)
- **Purpose:** Set up, manage, and check web page monitors for change tracking

**System prompt responsibilities:**

- Prefer JSON mode with a schema for structured change detection (price changes, feature list updates) — gives per-field diffs instead of noisy markdown diffs
- Default schedule to `"every 30 minutes"` unless the parent specifies otherwise
- Default `retentionDays: 7`
- Filter `pageStatus: "changed"` when checking results to only surface actual changes
- Report changes in human-readable format: "plans[0].price changed from $19/mo to $24/mo"
- For `monitor_run` (manual trigger), poll `monitor_checks` to wait for results

## Configuration Changes

### opencode.json

**1. Global tool disable** — add to existing `tools` block:

```json
"tools": {
    "playwright_*": false,
    "homeassistant_*": false,
    "chrome-devtools_*": false,
    "firecrawl_*": false
}
```

**2. Three new agent overrides:**

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

**Note:** Tool names use the `{mcp-server}_{tool}` convention. The MCP server is named `firecrawl` and the tools are prefixed `firecrawl_*`, resulting in `firecrawl_firecrawl_*`. This needs verification at implementation time.

### New agent files

Three new files in `agents/`:

- `agents/webscraper.md`
- `agents/webresearcher.md`
- `agents/webmonitor.md`

Each follows the existing frontmatter pattern (name, description, tools).

### Existing agent updates

Add delegation lines to these agents' `.md` files:

| Agent | Delegation targets |
|-------|-------------------|
| general (`default.md`) | `@webscraper`, `@webresearcher`, `@webmonitor` |
| coder | `@webscraper`, `@webresearcher`, `@webmonitor` |
| devops | `@webscraper`, `@webresearcher`, `@webmonitor` |
| designer | `@webresearcher` only |
| debugger | `@webresearcher` only |

Agents not updated: websearch (raw HTTP layer), webdebugger (Playwright), ha (Home Assistant).

## Token Efficiency Guidelines

### Universal rules (all three subagents)

1. Never return raw page content to the parent — always distill, summarize, or extract structured data.
2. Cite source URLs so the parent can reference them without re-fetching.
3. Fail fast — if first attempt returns empty/irrelevant content, try a different strategy (different URL, `waitFor`, `map` to find the right page) rather than retrying the same call.

### Per-agent rules

**webscraper:**
- Default `formats: ["json"]` + schema (~500 tokens vs ~5,000 for markdown)
- Always `onlyMainContent: true` on markdown scrapes
- `map` before `crawl` — never blind-crawl
- Cap crawls: `limit: 10`, `maxDiscoveryDepth: 2` unless overridden
- Try `waitFor: 5000` before `interact`

**webresearcher:**
- Search without `scrapeOptions` first — get URLs + snippets, then selectively scrape
- Scrape only the top 1-2 most relevant results
- Always call `search_feedback` after search (reclaims 1 credit)
- `agent` is last resort only
- Use `map` with `search` parameter for targeted URL discovery

**webmonitor:**
- JSON mode with schema over markdown diffs
- Default `retentionDays: 7`
- Filter `pageStatus: "changed"` when checking results
- Report field-level diffs, not raw output

## Token Cost Estimates

| Scenario | Estimated Tokens |
|----------|-----------------|
| Simple JSON scrape | ~1,300 (including dispatch overhead) |
| Search + scrape 2 results | ~9,700 |
| Map + crawl 10 pages | ~41,500 |
| Research + scrape + set up monitor | ~8,600 |

## What stays the same

- Firecrawl MCP server config (self-hosted at `<firecrawl-host>`)
- context7 as primary documentation source
- Existing `websearch` agent (curl/wget raw HTTP)
- Existing `webdebugger` agent (Playwright browser testing)
- All other agent definitions (except delegation line additions)
