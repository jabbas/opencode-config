# Global Rules

> Safety hard rules (reboot/destructive-command protections) live canonically in
> `AGENTS.md` ("Global Hard Rules") — loaded via the most robust channel.

## Filesystem Safety

- NEVER guess, assume, or fabricate filesystem paths — especially usernames in paths like `/Users/<name>/`
- ALWAYS run `pwd` to determine the current working directory before any filesystem operation
- The current user's home directory is available via `$HOME` — never hardcode or guess usernames
- If you need the home directory path, run `echo $HOME` — do not invent it

## File Writes

- Create and modify files with the write/edit tools. For several files, make several write calls (in parallel) — never one heredoc or shell loop
- Do NOT write file contents via the shell: no `cat > f <<EOF`, `echo`/`printf > f`, `tee f`, `sed -i`, `perl -i`, `python3`/`node` scripts that open files for writing, or shell functions/aliases that write files
- Allowed shell writes: scratch files in `$TMPDIR` (never bare `/tmp`); output of real tools (formatters such as `cargo fmt`/`ruff format`, code generators, build artefacts, `git` operations, package managers); downloads with `curl -o`
- NEVER write OpenCode config through the shell (`~/.config/opencode/opencode.json*`, `agents/`, `secrets/`, any `.opencode/`) — use edit/write so the user gets the permission prompt

## Web Content Rules

Do NOT use WebFetch for scraping, searching, or extracting web content. Always delegate to the appropriate Firecrawl subagent instead:

- **Scrape/extract content from a URL** → delegate to `webscraper` subagent
- **Search the web / research a topic** → delegate to `webresearcher` subagent
- **Monitor a page for changes** → delegate to `webmonitor` subagent

WebFetch is only acceptable for quick one-off URL checks when no extraction or analysis is needed. For any task involving "scrape", "extract", "crawl", "search the web", "find information online", or "monitor for changes" — you MUST delegate to the appropriate subagent above.

> Full, current agent list: see "Agent Roster" in `AGENTS.md`.
