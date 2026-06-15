# Global Rules

> Safety hard rules (reboot/destructive-command protections) live canonically in
> `AGENTS.md` ("Global Hard Rules") — loaded via the most robust channel.

## Filesystem Safety

- NEVER guess, assume, or fabricate filesystem paths — especially usernames in paths like `/Users/<name>/`
- ALWAYS run `pwd` to determine the current working directory before any filesystem operation
- The current user's home directory is available via `$HOME` — never hardcode or guess usernames
- If you need the home directory path, run `echo $HOME` — do not invent it

## Web Content Rules

Do NOT use WebFetch for scraping, searching, or extracting web content. Always delegate to the appropriate Firecrawl subagent instead:

- **Scrape/extract content from a URL** → delegate to `webscraper` subagent
- **Search the web / research a topic** → delegate to `webresearcher` subagent
- **Monitor a page for changes** → delegate to `webmonitor` subagent

WebFetch is only acceptable for quick one-off URL checks when no extraction or analysis is needed. For any task involving "scrape", "extract", "crawl", "search the web", "find information online", or "monitor for changes" — you MUST delegate to the appropriate subagent above.

> Full, current agent list: see "Agent Roster" in `AGENTS.md`.
