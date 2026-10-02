#!/usr/bin/env python3
"""audit-bash-permissions.py

Extract every bash command OpenCode has ever executed from its SQLite database
and classify each *simple* command as READ-ONLY vs MUTATING, aggregated by an
(executable + subcommand) signature such as `git log`, `kubectl get`,
`aws ec2 describe-*`.

Why: `permission.bash` in opencode.json is a curated allowlist with a catch-all
`"*": "ask"`. Deciding what to auto-allow by hand is guesswork; this reports the
commands that actually run, sorted by frequency, so the allowlist can be tuned
against real usage instead of intuition.

Source of truth: the OpenCode SQLite DB (default
~/.local/share/opencode/opencode.db). Tool-call parts live in table `part`, with
the command at JSON path `$.state.input.command` for rows where `$.tool` is
`bash`. The same data is reachable ad hoc via:

    opencode db "SELECT json_extract(data,'$.state.input.command') FROM part \\
      WHERE json_extract(data,'$.tool')='bash'" --format json

Usage:
    scripts/audit-bash-permissions.py                 # query the default DB
    scripts/audit-bash-permissions.py --db PATH       # query a specific DB
    scripts/audit-bash-permissions.py --from-json F   # reuse an exported list
    scripts/audit-bash-permissions.py --json OUT      # also write full report
    scripts/audit-bash-permissions.py --top 120       # rows per section

Exit: 0 on success; 2 if the input can't be read.

Caveats: command splitting and the read-only/mutating classification are
heuristic. A command is only as safe as its worst flag (e.g. `sed -i`, `find
-delete`, `git branch -D`), which a prefix glob cannot express. Treat the
MUTATING list as "review before allowing", not as an auto-allow list.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
import sys
from collections import Counter, defaultdict

DEFAULT_DB = os.path.expanduser("~/.local/share/opencode/opencode.db")

# --------------------------------------------------------------------------
# shell splitting / tokenising
# --------------------------------------------------------------------------

ASSIGN_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=")
PREFIXES = {"sudo", "command", "builtin", "nohup", "time", "env", "nice",
            "doas", "exec", "\\", "gtimeout", "timeout"}
CONTROL = {"do", "done", "then", "else", "fi", "if", "while", "until", "esac",
           "case", "in", "for", "{", "}", "(", ")", "!", "local", "declare",
           "readonly", "shift", "return", "break", "continue", "export", "set",
           "unset", "true", "false", ":", "function", "elif", "select", "trap"}
REDIR = re.compile(r"^\d*(>>?|<<?|>&|&>>?|<&|<>|>&)$")
HEREDOC_RE = re.compile(r"<<-?\s*(['\"]?)([A-Za-z_][A-Za-z0-9_]*)\1")

# Options that take a value. Needed so `--context X get` / `-C path status` /
# `--profile Y ec2` don't mistake the value for the subcommand.
VALUE_OPTS = set("""
-n --namespace -c --container -s --server --context --kube-context --kubeconfig
-f --filename -o --output -l --selector --field-selector --as --as-group --token
--user --cluster --tail --since --port --type --image --replicas --patch
--grace-period --timeout --request-timeout --profile --profile-output --region
--endpoint-url --query --cli-input-json --cli-read-timeout --cli-connect-timeout
--color -C --git-dir --work-tree --config-env --values --repo -R --limit -L
--json -q --jq -t --template --format --filter --dry-run --from-file
--from-literal --image-pull-policy --target-port --name --set --set-string
--set-file --version --app-version --description --max-history --reset-values
--reuse-values --output-dir --destination --path --source --revision --uri
--url --address --local-port -m --message -b --body --base --head --title
--label -a --assignee --milestone --state --author --search --branch --field
--raw-field --input --method -X --header -H --data --data-raw --data-binary
--form --user-agent -A --referer -e --cookie --account --vault-name --secret-id
--wait --interval --worktree --config-file --log-level
""".split())


def split_simple(s: str) -> list[str]:
    """Split a shell string on ; | && || & and newlines. Quote-aware and
    heredoc-aware; drops backslash-newline line continuations."""
    out: list[str] = []
    buf: list[str] = []
    i, n = 0, len(s)
    quote: str | None = None
    while i < n:
        c = s[i]
        if quote:
            if c == "\\" and quote == '"':
                buf.append(c); i += 1
                if i < n:
                    buf.append(s[i]); i += 1
                continue
            if c == quote:
                quote = None
            buf.append(c); i += 1
            continue
        if c in ('"', "'"):
            quote = c; buf.append(c); i += 1; continue
        if c == "\\":
            if i + 1 < n and s[i + 1] == "\n":          # line continuation
                i += 2; buf.append(" "); continue
            buf.append(c); i += 1
            if i < n:
                buf.append(s[i]); i += 1
            continue
        if c == "<" and s.startswith("<<", i):          # heredoc body
            m = HEREDOC_RE.match(s, i)
            if m:
                delim = m.group(2)
                buf.append(s[i:m.end()]); i = m.end()
                nl = s.find("\n", i)
                i = n if nl == -1 else nl + 1
                while i <= n:
                    nl = s.find("\n", i)
                    if nl == -1:
                        i = n + 1
                        break
                    line = s[i:nl]; i = nl + 1
                    if line.strip() == delim:
                        break
                continue
        if c == "\n" or c == ";":
            out.append("".join(buf)); buf = []; i += 1; continue
        if s.startswith("&&", i) or s.startswith("||", i):
            out.append("".join(buf)); buf = []; i += 2; continue
        if c == "|":
            out.append("".join(buf)); buf = []; i += 1; continue
        if c == "&":
            prev = s[i - 1] if i else ""
            nxt = s[i + 1] if i + 1 < n else ""
            if prev in "><" or nxt in "><" or (nxt.isdigit() and s[i + 2:i + 3] == ">"):
                buf.append(c); i += 1; continue
            out.append("".join(buf)); buf = []; i += 1; continue
        buf.append(c); i += 1
    out.append("".join(buf))
    return [x.strip() for x in out if x.strip()]


def argv_of(simple: str) -> list[str]:
    """Return argv for a simple command: strip redirections, leading VAR=val
    assignments and wrapper prefixes / shell control keywords."""
    toks = simple.split()
    clean: list[str] = []
    skip = False
    for t in toks:
        if skip:
            skip = False
            continue
        if REDIR.match(t):
            skip = True
            continue
        clean.append(t)
    toks = clean
    while toks and (ASSIGN_RE.match(toks[0]) or toks[0] in PREFIXES or toks[0] in CONTROL):
        toks = toks[1:]
    return [t.strip("'\"") for t in toks]


def positionals(argv: list[str]) -> list[str]:
    """Non-option arguments, skipping the values of value-taking options."""
    out: list[str] = []
    i = 1
    while i < len(argv):
        t = argv[i]
        if t.startswith("-"):
            if "=" in t:
                i += 1; continue
            i += 2 if t in VALUE_OPTS else 1
            continue
        out.append(t); i += 1
    return out


# --------------------------------------------------------------------------
# classification
# --------------------------------------------------------------------------

GIT_RO = {"log", "status", "diff", "show", "rev-parse", "ls-files", "ls-tree",
          "blame", "shortlog", "reflog", "describe", "cat-file", "for-each-ref",
          "whatchanged", "grep", "name-rev", "symbolic-ref", "show-ref",
          "show-branch", "ls-remote", "cherry", "count-objects", "var",
          "check-ignore", "check-attr", "merge-base", "diff-tree",
          "diff-index", "diff-files", "rev-list", "fsck", "verify-commit",
          "verify-tag", "range-diff", "patch-id"}
KUBECTL_RO = {"get", "describe", "logs", "top", "explain", "api-resources",
              "api-versions", "events", "version", "cluster-info", "diff",
              "wait", "completion", "options", "kustomize"}
HELM_RO = {"list", "ls", "status", "history", "get", "template", "show",
           "search", "version", "env", "lint", "help"}
FLUX_RO = {"get", "logs", "trace", "stats", "version", "export", "events"}
GH_RO_ACT = {"view", "list", "diff", "checks", "status"}
GH_RO_GRP = {"pr", "run", "workflow", "issue", "repo", "release", "cache",
             "status", "gist", "label", "ruleset", "codespace", "search"}
DOCKER_RO = {"ps", "images", "logs", "inspect", "version", "info", "stats",
             "top", "port", "history", "df", "events", "context"}
AWS_RO_PREFIX = ("describe", "list", "get", "head", "lookup", "search",
                 "batch-get", "estimate", "preview", "scan", "query", "wait",
                 "filter", "tail", "select")


def classify(head: str, argv: list[str]) -> tuple[str | None, str]:
    """Return (verdict, signature). verdict is 'readonly'|'review'|None."""
    if head == "git":
        pos = positionals(argv)
        if not pos:
            return "readonly", "git"
        sub, rest, raw = pos[0], pos[1:], argv[2:]
        if sub == "config":
            ro = any(a.startswith("--get") or a in ("-l", "--list") for a in raw)
            return ("readonly" if ro else "review"), "git config"
        if sub == "branch":
            ro = not any(a in ("-d", "-D", "-m", "-M", "--delete", "--move",
                               "--set-upstream-to", "-u", "--unset-upstream") for a in raw)
            return ("readonly" if ro else "review"), "git branch"
        if sub == "tag":
            ro = any(a in ("-l", "--list") or a.startswith("-l") for a in raw)
            return ("readonly" if ro else "review"), "git tag"
        if sub == "stash":
            ro = bool(rest) and rest[0] in ("list", "show")
            return ("readonly" if ro else "review"), "git stash"
        if sub == "remote":
            ro = any(a in ("-v", "--verbose", "show", "get-url") for a in rest)
            return ("readonly" if ro else "review"), "git remote"
        if sub == "worktree":
            ro = bool(rest) and rest[0] == "list"
            return ("readonly" if ro else "review"), "git worktree"
        if sub == "notes":
            ro = bool(rest) and rest[0] == "list"
            return ("readonly" if ro else "review"), "git notes"
        return ("readonly" if sub in GIT_RO else "review"), f"git {sub}"
    if head == "kubectl":
        pos = positionals(argv)
        sub = pos[0] if pos else None
        return ("readonly" if sub in KUBECTL_RO else "review"), f"kubectl {sub}"
    if head == "helm":
        pos = positionals(argv)
        sub = pos[0] if pos else None
        if sub == "dependency" and len(pos) > 1 and pos[1] == "list":
            return "readonly", "helm dependency list"
        return ("readonly" if sub in HELM_RO else "review"), f"helm {sub}"
    if head == "flux":
        pos = positionals(argv)
        sub = pos[0] if pos else None
        return ("readonly" if sub in FLUX_RO else "review"), f"flux {sub}"
    if head == "gh":
        pos = positionals(argv)
        if len(pos) >= 2:
            grp, act = pos[0], pos[1]
            if grp == "api":
                ro = not any(a in ("-X", "--method", "-f", "--field",
                                   "--raw-field", "-F", "--input") for a in argv[2:])
                return ("readonly" if ro else "review"), "gh api"
            if grp in ("auth", "config", "alias", "extension"):
                return "readonly", f"gh {grp}"
            if grp in GH_RO_GRP and act in GH_RO_ACT:
                return "readonly", f"gh {grp} {act}"
            return "review", f"gh {grp} {act}"
        return "review", "gh"
    if head in ("docker", "podman"):
        pos = positionals(argv)
        sub = pos[0] if pos else None
        if sub in ("network", "volume"):
            if len(pos) > 1 and pos[1] in ("ls", "list", "inspect"):
                return "readonly", f"{head} {sub} {pos[1]}"
            return "review", f"{head} {sub}"
        if sub == "system":
            if len(pos) > 1 and pos[1] in ("df", "info", "events"):
                return "readonly", f"{head} system {pos[1]}"
            return "review", f"{head} system"
        return ("readonly" if sub in DOCKER_RO else "review"), f"{head} {sub}"
    if head == "aws":
        pos = positionals(argv)
        if len(pos) >= 2:
            service, op = pos[0], pos[1]
            if service == "s3" and op == "ls":
                return "readonly", "aws s3 ls"
            if service == "configure" and op == "list":
                return "readonly", "aws configure list"
            ro = op.startswith(AWS_RO_PREFIX)
            return ("readonly" if ro else "review"), f"aws {service} {op.split('-')[0]}"
        return "review", "aws"
    if head == "kustomize":
        pos = positionals(argv)
        ro = "build" in pos or "cfg" in pos
        return ("readonly" if ro else "review"), "kustomize build" if ro else "kustomize"
    return None, head


READONLY = {
    "ls", "cat", "head", "tail", "grep", "rg", "wc", "sort", "uniq", "cut",
    "tr", "nl", "tac", "rev", "fold", "paste", "join", "comm", "column",
    "diff", "cmp", "od", "xxd", "hexdump", "strings", "file", "stat", "tree",
    "fd", "mdfind", "mdls", "basename", "dirname", "realpath", "readlink",
    "pwd", "cd", "echo", "printf", "which", "type", "whereis", "date", "cal",
    "seq", "jq", "yq", "plutil", "shasum", "sha256sum", "md5", "md5sum",
    "cksum", "less", "more", "man", "info", "help", "id", "whoami", "groups",
    "hostname", "uname", "sw_vers", "arch", "locale", "df", "du", "mount",
    "diskutil", "system_profiler", "ps", "pgrep", "lsof", "netstat", "ss",
    "arp", "ifconfig", "ip", "route", "dig", "nslookup", "host", "ping",
    "traceroute", "whois", "vm_stat", "sysctl", "nproc", "tput", "uptime",
    "w", "who", "last", "printenv", "env", "getconf", "clear", "true", "false",
    "sleep", "wait", "read", "yamllint", "logcli",
}
RUNTIMES = {
    "python", "python3", "node", "bun", "deno", "npx", "npm", "pip", "pip3",
    "uv", "java", "ruby", "go", "cargo", "mvn", "gradle", "make", "bash", "sh",
    "zsh", "source", "eval", "perl", "gawk", "awk", "sed", "curl", "wget",
    "ssh", "scp", "rsync", "tar", "zip", "unzip", "gzip", "gunzip", "bzip2",
    "xargs", "kill", "pkill", "killall", "launchctl", "defaults", "systemctl",
    "tmux", "screen", "brew", "terraform", "tofu", "ansible",
    "ansible-playbook", "rm", "mv", "cp", "mkdir", "touch", "chmod", "chown",
    "chgrp", "ln", "install", "tee", "truncate", "dd", "rmdir", "script",
    "open", "pbcopy", "pbpaste", "osascript", "nc", "ncat", "socat", "base64",
    "find", "openssl", "pytest", "flutter", "opencode", "talosctl", "argocd",
    "kubeseal", "jenkinscli", "jk",
}


def walk(commands: list[str]):
    """Yield (head, argv, simple) for every simple command across all inputs."""
    for cmd in commands:
        for simple in split_simple(cmd):
            argv = argv_of(simple)
            if not argv:
                continue
            head = argv[0].split("/")[-1]
            if not re.match(r"^[A-Za-z0-9_][A-Za-z0-9_.:+-]*$", head):
                continue
            yield head, argv, simple


# --------------------------------------------------------------------------
# input
# --------------------------------------------------------------------------


def load_from_db(path: str) -> list[str]:
    if not os.path.exists(path):
        sys.exit(f"error: database not found: {path}")
    uri = f"file:{path}?mode=ro"
    try:
        conn = sqlite3.connect(uri, uri=True)
    except sqlite3.Error as exc:
        sys.exit(f"error: cannot open {path}: {exc}")
    try:
        cur = conn.cursor()
        try:
            cur.execute(
                "SELECT json_extract(data,'$.state.input.command') FROM part "
                "WHERE json_extract(data,'$.tool')='bash' "
                "AND json_extract(data,'$.state.input.command') IS NOT NULL"
            )
            rows = cur
        except sqlite3.Error:
            # JSON1 unavailable: fall back to a coarse LIKE filter + parse.
            print("note: json_extract unavailable, falling back to LIKE scan",
                  file=sys.stderr)
            cur.execute("SELECT data FROM part WHERE data LIKE '%\"tool\":\"bash\"%'")
            rows = (json.loads(r[0]).get("state", {}).get("input", {}).get("command")
                    for r in cur)
        out: list[str] = []
        for row in rows:
            cmd = row[0] if isinstance(row, tuple) else row
            if cmd:
                out.append(cmd)
            if len(out) % 10000 == 0 and len(out):
                print(f"  ... {len(out)} commands", file=sys.stderr, end="\r")
        print(f"  ... {len(out)} commands", file=sys.stderr)
        return out
    finally:
        conn.close()


def load_from_json(path: str) -> list[str]:
    if not os.path.exists(path):
        sys.exit(f"error: file not found: {path}")
    data = json.load(open(path))
    out: list[str] = []
    for item in data:
        if isinstance(item, dict):
            cmd = item.get("command")
        else:
            cmd = item
        if cmd:
            out.append(cmd)
    return out


# --------------------------------------------------------------------------
# report
# --------------------------------------------------------------------------


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    src = ap.add_mutually_exclusive_group()
    src.add_argument("--db", default=DEFAULT_DB, help="OpenCode SQLite DB (default: %(default)s)")
    src.add_argument("--from-json", metavar="FILE",
                     help="reuse an exported list of commands instead of querying the DB")
    ap.add_argument("--json", metavar="OUT", help="write the full report as JSON")
    ap.add_argument("--top", type=int, default=80, help="rows per section (default: %(default)s)")
    args = ap.parse_args()

    if args.from_json:
        commands = load_from_json(args.from_json)
    else:
        commands = load_from_db(args.db)

    counts: Counter[str] = Counter()
    verdicts: dict[str, Counter[str]] = defaultdict(Counter)
    example: dict[str, str] = {}
    for head, argv, simple in walk(commands):
        verdict, sig = classify(head, argv)
        if verdict is None:
            if head in READONLY:
                verdict = "readonly"
            elif head in RUNTIMES:
                verdict = "review"
            else:
                verdict = "unknown"
        counts[sig] += 1
        verdicts[verdict][sig] += 1
        example.setdefault(sig, simple[:240])

    if args.json:
        with open(args.json, "w") as fh:
            json.dump({"calls": len(commands),
                       "signatures": {k: {"count": c, "example": example.get(k, "")}
                                      for k, c in counts.most_common()}},
                      fh, indent=2)
        print(f"wrote {args.json}", file=sys.stderr)

    print(f"# bash tool calls: {len(commands)}")
    print(f"# distinct signatures: {len(counts)}")
    for name in ("readonly", "review", "unknown"):
        print(f"\n=== {name.upper()} ===")
        for sig, n in verdicts[name].most_common(args.top):
            print(f"{n:7d}  {sig}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
