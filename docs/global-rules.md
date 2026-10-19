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

## Shell Command Style

Permissions match the literal command text — follow this or every call triggers a permission prompt:

- Put the verb/subcommand FIRST, flags after: `kubectl get pods -n x --context admin@k8s`, `flux get ks -n flux-system --context admin@k8s`, `flux reconcile ks x --with-source --context admin@k8s`, `helm status x -n y --kube-context admin@k8s`. NEVER `kubectl --context X get …` / `flux --context X reconcile …`.
- Use the shell tool's working directory instead of `git -C dir …` (just `git log`) and instead of `cd dir && …`.
- NEVER wrap commands or flags in shell variables, aliases or functions (`K="kubectl …"; $K get`, `C="--context …"; kubectl $C get`, `k(){ kubectl "$@"; }`). Write the full literal command every time, even if it repeats.
- No `timeout`/`time`/`env X=…`/`VAR=x cmd` prefixes (e.g. `GIT_TERMINAL_PROMPT=0 git …`), no `git -c …`, and no `bash -c '…'` unless strictly required.
- Don't wrap commands in ad-hoc scripts (`$TMPDIR/x.sh`, `zsh snap.sh`, `bash check.sh`) — run the commands directly. Script contents are invisible to permissions, so running a script always asks; only real project/skill scripts are fine.
- Run built binaries by their literal path (`target/debug/x`), not via a variable (`$B`); stop a background process you started in the same command with `kill $!` or `kill %1` (other `kill`/`pkill` asks).
- One simple command per call where practical; avoid long `&&`/`;` chains and `awk/sed … > f.new && mv f.new f` — change files with the edit/write tools.
- Scratch files go under `$TMPDIR`, written literally (not through `$T`-style aliases); do not `rm` them unless cleanup is actually required.
- `rm` of relative project paths runs without asking (several at once is fine); absolute, `~`, `$VAR`, `..` and `.git` paths ask. Exception: ONE literal path under `$TMPDIR`/`/tmp` runs without asking (`rm -rf $TMPDIR/kind`); several tmp paths in one `rm` ask, so remove one scratch directory instead of a list of files.
- `git push` is allowed; force/delete/mirror always ask — don't try to work around that.

## Web Content Rules

Do NOT use WebFetch for scraping, searching, or extracting web content. Always delegate to the appropriate Firecrawl subagent instead:

- **Scrape/extract content from a URL** → delegate to `webscraper` subagent
- **Search the web / research a topic** → delegate to `webresearcher` subagent
- **Monitor a page for changes** → delegate to `webmonitor` subagent

WebFetch is only acceptable for quick one-off URL checks when no extraction or analysis is needed. For any task involving "scrape", "extract", "crawl", "search the web", "find information online", or "monitor for changes" — you MUST delegate to the appropriate subagent above.

> Full, current agent list: see "Agent Roster" in `AGENTS.md`.
