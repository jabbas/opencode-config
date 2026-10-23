// Effect classifier (spec §3, §4.1–§4.5): Invocation + Target + Config -> Classification.
//
//   Classification = { cls, reason, verb?, detail? }
//   cls ∈ local-read | local-write | local-ask | ext-read | ext-write | irreversible
//         | secret-ask | secret-deny | own-config | opaque
//
// NOT implemented (spec §4.3 / §7): "git push to main/master of a repo that is not the user's own".
// Recognising "own" needs the remote URL (`git remote get-url`), i.e. I/O the classifier does not do;
// `git push` is ext-write (target class `home` per target.js), force/delete/mirror are irreversible.
//
// Pure function: no I/O besides `canonical()` (realpath of existing ancestors) from paths.js.
// Rule order (first match wins) is documented at `classify()`.

import * as paths from "./paths.js"
import { matchAny, wildcardToRegExp } from "./match.js"

export { matchAny }

// ---------------------------------------------------------------------------------------------
// small helpers

const baseName = (t) => {
  const s = String(t ?? "")
  const i = s.lastIndexOf("/")
  return i >= 0 && i < s.length - 1 ? s.slice(i + 1) : s
}

// `$VAR`, `${VAR}`, `$(…)`, backticks — except $HOME / $TMPDIR, which are resolved best-effort.
const DYN = /\$(?!\{?(?:HOME|TMPDIR)\b)|`/
const isDyn = (w) => DYN.test(String(w ?? ""))
const isFlag = (w) => typeof w === "string" && w.startsWith("-") && w.length > 1

const canonical =
  paths.canonical ??
  ((p, base, home) => {
    let s = String(p ?? "")
    if (home && (s === "~" || s.startsWith("~/"))) s = home + s.slice(1)
    if (s.startsWith("/")) return s
    return `${base ?? ""}/${s}`
  })

const underRoot = (abs, roots) => roots.some((r) => abs === r || abs.startsWith(r.endsWith("/") ? r : r + "/"))

function res(cls, reason, extra = {}) {
  const out = { cls, reason }
  for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== "") out[k] = v
  return out
}

// ---------------------------------------------------------------------------------------------
// verbOf — verb extraction that is blind to global flags and flag order

const GLOBALS = {
  kubectl: ["--context", "-n", "--namespace", "--kubeconfig", "--request-timeout"],
  helm: ["--kube-context", "-n", "--namespace", "--kubeconfig"],
  flux: ["--context", "-n", "--namespace", "--kubeconfig"],
  git: ["-C", "-c", "--git-dir", "--work-tree"],
  aws: ["--profile", "--region", "--output", "--endpoint-url"],
  talosctl: ["-n", "--nodes", "-e", "--endpoints", "--context", "--talosconfig"],
  gh: ["-R", "--repo"],
  jk: ["--context"],
}

// First word of two-word verbs ("pr create", "rollout status", "etcd members" …) — display only;
// matching always runs on the full text.
const GROUPS = {
  kubectl: ["config", "rollout", "auth", "set", "certificate"],
  helm: ["dependency", "repo", "plugin", "show", "get"],
  flux: ["create", "bootstrap"],
  talosctl: ["config", "etcd", "inspect", "image", "cluster"],
  gh: ["pr", "run", "workflow", "issue", "repo", "release", "auth", "secret", "variable", "cache", "label", "gist", "project", "ruleset"],
  jk: ["job", "run", "context", "auth", "artifact", "test", "cred", "node", "queue", "plugin"],
  wrangler: ["versions", "deployments", "kv", "d1", "r2", "secret"],
  ant: ["auth"],
}

const S3_BOOL_FLAGS = new Set([
  "--recursive", "--delete", "--dryrun", "--quiet", "--only-show-errors", "--no-progress", "--follow-symlinks",
  "--no-follow-symlinks", "--exact-timestamps", "--size-only", "--no-guess-mime-type", "--no-paginate",
  "--no-sign-request", "--debug", "--human-readable", "--summarize", "--no-verify-ssl", "--no-cli-pager",
  "--force-glacier-transfer", "--ignore-glacier-warnings", "--no-cli-auto-prompt",
])

function s3Direction(rest) {
  const pos = []
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]
    if (a === "--") continue
    if (a.startsWith("--")) {
      if (!a.includes("=") && !S3_BOOL_FLAGS.has(a)) i++
      continue
    }
    if (a.startsWith("-") && a.length > 1) continue
    pos.push(a)
  }
  if (pos.length < 2) return undefined
  const rem = (s) => s.startsWith("s3://")
  const [src, dst] = pos
  if (rem(src) && rem(dst)) return "remote"
  if (rem(src)) return "down"
  if (rem(dst)) return "up"
  return "local"
}

/**
 * -> { verb, rest, direction? }. `verb` = first 1–2 non-flag words once the tool's global flags
 * (and their values) are removed; `rest` = every remaining token in order. aws: verb = "<svc> <op>";
 * `aws s3 cp|sync|mv` additionally reports `direction` (down|up|remote|local).
 */
export function verbOf(tool, args) {
  return verbFromKept(baseName(tool), stripGlobals(tool, args))
}

/**
 * Candidate verb positions that survive UNKNOWN value-taking global flags (`kubectl -v 6 delete …`,
 * `aws --query x ec2 delete-volume`): the first non-flag token, and — while the previous candidate
 * directly followed a flag, i.e. might merely be that flag's value — the next non-flag token too.
 * -> { kept, cands: [{ idx, v }] } where v = verbOf-style result for kept.slice(idx).
 */
export function verbCandidates(tool, args) {
  const t = baseName(tool)
  const kept = stripGlobals(tool, args)
  const cands = []
  let mightBeValue = true
  let sawFlag = false
  for (let i = 0; i < kept.length; i++) {
    const a = kept[i]
    if (a === "--") break
    if (a.startsWith("-") && a.length > 1) {
      sawFlag = true
      continue
    }
    if (!mightBeValue) break
    cands.push({ idx: i, v: verbFromKept(t, kept.slice(i)) })
    mightBeValue = sawFlag
    sawFlag = false
  }
  return { kept, cands }
}

function stripGlobals(tool, args) {
  const t = baseName(tool)
  const g = GLOBALS[t] ?? []
  const shortG = g.filter((f) => /^-[A-Za-z]$/.test(f))
  const kept = []
  let seenPositional = false
  const list = args ?? []
  for (let i = 0; i < list.length; i++) {
    const a = list[i]
    if (a === "--") {
      kept.push(...list.slice(i))
      break
    }
    if (a.startsWith("-") && (t !== "git" || !seenPositional)) {
      const name = a.startsWith("--") && a.includes("=") ? a.slice(0, a.indexOf("=")) : a
      if (g.includes(name)) {
        if (name === a) i++
        continue
      }
      if (a.length > 2 && a[1] !== "-" && shortG.includes(a.slice(0, 2))) continue
    }
    if (!a.startsWith("-")) seenPositional = true
    kept.push(a)
  }
  return kept
}

function verbFromKept(t, kept) {
  const idx = kept.findIndex((a) => a === "--" || !a.startsWith("-"))
  if (idx < 0 || kept[idx] === "--") return { verb: "", rest: kept }
  const words = [kept[idx]]
  const next = kept[idx + 1]
  if (next !== undefined && !next.startsWith("-") && (t === "aws" || (GROUPS[t] ?? []).includes(kept[idx]))) {
    words.push(next)
  }
  const rest = kept.filter((_, j) => j < idx || j >= idx + words.length)
  const out = { verb: words.join(" "), rest }
  if (t === "aws" && words[0] === "s3" && ["cp", "sync", "mv"].includes(words[1])) {
    const d = s3Direction(rest)
    if (d) out.direction = d
  }
  return out
}

const verbText = (t, v) => [t, v.verb, v.rest.join(" ")].filter(Boolean).join(" ")

// config verb pattern -> full-text pattern. Patterns without `*` are exact in v2, so make
// them prefix patterns ("drain" must match "kubectl drain node1").
const patList = (tool, list) => (list ?? []).map((p) => (p.includes("*") ? `${tool} ${p}` : `${tool} ${p} *`))

const literalTokens = (p) => p.split(/\s+/).filter((x) => x && !x.includes("*") && !x.includes("?")).length

function firstMatch(texts, pats) {
  for (const p of pats) for (const t of texts) if (matchAny(t, [p])) return p
  return null
}

// ---------------------------------------------------------------------------------------------
// tables

const GIT_READ = new Set([
  "status", "log", "diff", "show", "blame", "ls-files", "ls-tree", "rev-parse", "describe", "shortlog", "grep",
  "cat-file", "reflog", "ls-remote", "name-rev", "for-each-ref", "rev-list", "merge-base", "show-ref", "version",
  "help", "whatchanged", "diff-tree", "diff-files", "diff-index", "check-ignore", "check-attr", "count-objects",
  "fsck", "verify-commit", "var", "range-diff", "cherry",
])
const GIT_LISTY = new Set(["branch", "tag", "remote", "stash", "config", "worktree", "submodule", "notes"])

// local tools that mutate state even without a visible path argument
const LOCAL_WRITE_TOOLS = new Set([
  "make", "npm", "pnpm", "yarn", "cargo", "go", "pip", "pip3", "uv", "podman", "docker", "kind", "cmake", "mvn",
  "gradle", "mkdir", "touch", "rm", "rmdir", "mv", "cp", "ln", "install", "tee", "chmod", "chown", "chgrp",
  "truncate", "unlink", "shred", "dd", "zip", "gzip", "gunzip", "unzip", "tar", "patch", "ansible-playbook",
])

// tools whose own flags (--profile, --context, URLs …) must never be read as an external target
const NO_TARGET_TOOLS = new Set([
  "python", "python3", "node", "npm", "npx", "pnpm", "yarn", "bun", "deno", "ruby", "perl", "make", "cargo", "go",
  "uv", "uvx", "pip", "pip3", "pipx", "pytest", "busted", "luacheck", "sh", "bash", "zsh", "dash", "ksh", "echo",
  "printf", "cat", "grep", "rg", "jq", "yq", "head", "tail", "wc", "sed", "awk", "sort", "uniq", "tr", "cut", "ls",
  "find", "test", "[", "true", "false", "cd", "export", "set", "unset", "open", "xdg-open", "man", "which", "type",
  "podman", "docker", "kind", "cmake", "mvn", "gradle", "diff", "cp", "mv", "rm", "mkdir", "touch", "tee", "cmp",
  "file", "stat", "du", "df", "sleep", "date", "basename", "dirname", "realpath",
])

const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh"])
const INTERPRETERS = /^(?:python[\d.]*|node|ruby|perl|php|bun|deno)$/

const GENERIC_READ =
  /^(?:get|describe|list|ls|show|status|logs?|view|watch|history|diff|explain|top|events?|search|version|whoami|info|help|inspect|ps|(?:describe|list|get|head|search|lookup|filter|select)-.+)$/

const EXT_TARGET_FLAGS = ["--context", "--kube-context", "--profile", "--kubeconfig"]

// flags that name WHERE a known CLI acts; a variable here makes the target unknown
const TARGET_FLAGS = {
  kubectl: ["--context", "--kubeconfig"],
  helm: ["--kube-context", "--kubeconfig"],
  flux: ["--context", "--kubeconfig"],
  aws: ["--profile"],
  talosctl: ["-n", "--nodes", "-e", "--endpoints", "--context", "--talosconfig"],
  gh: ["-R", "--repo"],
}

const K8S_ALIASES = {
  namespaces: "namespace", nses: "ns", persistentvolumes: "pv", persistentvolume: "pv", persistentvolumeclaims: "pvc",
  persistentvolumeclaim: "pvc", pvs: "pv", pvcs: "pvc", crds: "crd", customresourcedefinitions: "crd",
  customresourcedefinition: "crd",
}

function flagValue(args, names) {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === "--") return undefined
    for (const n of names) {
      if (a === n) return args[i + 1]
      if (n.startsWith("--") && a.startsWith(n + "=")) return a.slice(n.length + 1)
      if (!n.startsWith("--") && a.length > 2 && a.startsWith(n) && a[1] !== "-") return a.slice(2)
    }
  }
  return undefined
}

function flagValues(args, names) {
  const out = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === "--") break
    for (const n of names) {
      if (a === n && i + 1 < args.length) out.push(args[i + 1])
      else if (n.startsWith("--") && a.startsWith(n + "=")) out.push(a.slice(n.length + 1))
    }
  }
  return out
}

// ---------------------------------------------------------------------------------------------
// write targets (shell-level writes, spec §4.4)

const isWriteRedirect = (r) => {
  const op = String(r?.op ?? "")
  if (!op || op.includes(">&") || op === "<" || op.startsWith("<")) return false
  return op.includes(">")
}

const positionals = (args) => {
  const out = []
  let dd = false
  for (const a of args) {
    if (dd) out.push(a)
    else if (a === "--") dd = true
    else if (!isFlag(a) && a !== "") out.push(a)
  }
  return out
}

function tarTargets(args) {
  let letters = ""
  let file
  let dir
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a.startsWith("--")) {
      if (a === "--extract" || a === "--get") letters += "x"
      else if (a === "--create") letters += "c"
      else if (a === "--file") file = args[++i]
      else if (a.startsWith("--file=")) file = a.slice(7)
      else if (a === "--directory") dir = args[++i]
      else if (a.startsWith("--directory=")) dir = a.slice(12)
      continue
    }
    const cluster = a.startsWith("-") ? a.slice(1) : i === 0 ? a : ""
    if (!cluster) continue
    for (const ch of cluster) {
      if (ch === "f") {
        file = args[++i]
        break
      }
      if (ch === "C") {
        dir = args[++i]
        break
      }
      letters += ch
    }
  }
  const out = []
  if (/[cru]/.test(letters) && file) out.push({ p: file })
  if (letters.includes("x")) {
    if (dir) out.push({ p: dir, dir: true })
    out.push({ p: "", marker: true })
  }
  return out
}

const CURL_VALUE_LETTERS = new Set("AbcCdDeEFHKmoPQrTuUwxXyYz")

function outputFiles(base, args) {
  const out = []
  if (base === "curl") {
    for (let i = 0; i < args.length; i++) {
      const a = args[i]
      if (a === "--output" && args[i + 1] !== undefined) out.push(args[++i])
      else if (a.startsWith("--output=")) out.push(a.slice(9))
      else if (a.startsWith("-") && !a.startsWith("--")) {
        const cl = a.slice(1)
        for (let k = 0; k < cl.length; k++) {
          if (CURL_VALUE_LETTERS.has(cl[k])) {
            if (cl[k] === "o") out.push(cl.slice(k + 1) || args[i + 1])
            if (!cl.slice(k + 1)) i++
            break
          }
        }
      }
    }
  } else if (base === "wget") {
    for (let i = 0; i < args.length; i++) {
      const a = args[i]
      if ((a === "-O" || a === "--output-document" || a === "-P" || a === "--directory-prefix") && args[i + 1] !== undefined) {
        out.push(args[++i])
      } else if (a.startsWith("--output-document=")) out.push(a.slice(18))
      else if (a.startsWith("--directory-prefix=")) out.push(a.slice(19))
    }
  }
  return out.filter((x) => x !== undefined)
}

/** -> [{ p, dir? , marker? }] literal write targets of this invocation (`marker` = writes cwd/unknown). */
function writeTargets(inv, base, args, verb) {
  const out = []
  for (const r of inv.redirects ?? []) {
    if (isWriteRedirect(r) && r.target && r.target !== "/dev/null" && !/^&?\d+$/.test(r.target)) out.push({ p: r.target })
  }
  const pos = positionals(args)
  const tOpt = flagValue(args, ["-t", "--target-directory"])
  switch (base) {
    case "tee":
      pos.forEach((p) => out.push({ p }))
      break
    case "cp":
    case "install":
      if (base === "install" && args.includes("-d")) pos.forEach((p) => out.push({ p, dir: true }))
      else if (tOpt) out.push({ p: tOpt, dir: true })
      else if (pos.length >= 2) out.push({ p: pos[pos.length - 1] })
      break
    case "mv":
      if (tOpt) out.push({ p: tOpt, dir: true })
      pos.forEach((p) => out.push({ p }))
      break
    case "ln":
      if (pos.length >= 2) out.push({ p: pos[pos.length - 1] })
      break
    case "rm":
    case "rmdir":
    case "unlink":
    case "shred":
    case "truncate":
    case "touch":
    case "mkdir":
      pos.forEach((p) => out.push({ p }))
      break
    case "chmod":
    case "chown":
    case "chgrp":
      pos.slice(1).forEach((p) => out.push({ p }))
      break
    case "zip":
      if (pos[0]) out.push({ p: pos[0] })
      break
    case "sed":
    case "perl": {
      const inPlace = args.some((a) => (base === "sed" ? /^-[A-Za-z]*i/.test(a) || a.startsWith("--in-place") : /^-[A-Za-z]*i/.test(a)))
      if (inPlace) {
        const files = []
        let scriptSeen = args.some((a) => a === "-e" || a === "-f" || a === "--expression" || a === "--file")
        for (let i = 0; i < args.length; i++) {
          const a = args[i]
          if (base === "perl" && /^-[A-Za-z]*e$/.test(a)) {
            i++
            scriptSeen = true
            continue
          }
          if (a === "-e" || a === "-f" || a === "--expression" || a === "--file") {
            i++
            continue
          }
          if (isFlag(a) || a === "") continue
          if (!scriptSeen) {
            scriptSeen = true
            continue
          }
          files.push(a)
        }
        files.forEach((p) => out.push({ p }))
        if (!files.length) out.push({ p: "", marker: true })
      }
      break
    }
    case "unzip": {
      const d = flagValue(args, ["-d"])
      if (d) out.push({ p: d, dir: true })
      else out.push({ p: "", marker: true })
      break
    }
    case "tar":
      out.push(...tarTargets(args))
      break
    case "curl":
    case "wget":
      outputFiles(base, args).forEach((p) => out.push({ p }))
      break
    case "dd":
      for (const a of args) if (a.startsWith("of=")) out.push({ p: a.slice(3) })
      break
    case "git": {
      const writes = verb && !GIT_READ.has(verb) && !(GIT_LISTY.has(verb) && gitListy(verb, args))
      if (writes) {
        const vi = args.indexOf(verb)
        for (const d of flagValues(args.slice(0, vi < 0 ? 0 : vi), ["-C", "--work-tree"])) out.push({ p: d, dir: true })
      }
      break
    }
    default:
  }
  return out
}

function gitListy(verb, args) {
  const rest = args.slice(args.indexOf(verb) + 1)
  const pos = positionals(rest)
  if (verb === "config") return rest.some((a) => ["--get", "--get-all", "--list", "-l", "--get-regexp"].includes(a))
  if (verb === "stash" || verb === "worktree" || verb === "submodule" || verb === "notes") {
    return pos.length === 0 ? verb === "submodule" || verb === "worktree" || verb === "notes" : ["list", "show", "status"].includes(pos[0])
  }
  if (rest.some((a) => ["-l", "--list", "--show-current", "-v", "-vv", "-a", "-r", "--contains", "--merged", "--no-merged"].includes(a))) {
    return pos.length === 0 || verb === "branch" || verb === "tag"
  }
  if (verb === "remote") return pos.length === 0 || ["show", "get-url"].includes(pos[0])
  return pos.length === 0
}

// ---------------------------------------------------------------------------------------------
// curl / wget / httpie

function hostOf(u) {
  let s = String(u).replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
  s = s.replace(/^[^/@?#]*@/, "")
  s = s.split(/[/?#]/)[0]
  if (s.startsWith("[")) return s.slice(1, s.indexOf("]") > 0 ? s.indexOf("]") : undefined).toLowerCase()
  return s.replace(/:\d+$/, "").toLowerCase()
}

const isLocalHost = (h) => h === "localhost" || h.endsWith(".localhost") || /^127(?:\.\d{1,3}){3}$/.test(h) || h === "::1" || h === "0.0.0.0"

function classifyHttp(base, args) {
  let method = null
  let data = false
  let getFlag = false
  const urls = []
  const extraHosts = [] // proxies / --connect-to targets: where the traffic really goes
  if (base === "curl") {
    for (let i = 0; i < args.length; i++) {
      const a = args[i]
      if (a.startsWith("--")) {
        const eq = a.indexOf("=")
        const name = eq > 0 ? a.slice(0, eq) : a
        const val = () => (eq > 0 ? a.slice(eq + 1) : args[++i])
        if (name === "--request") method = val()
        else if (["--data", "--data-raw", "--data-binary", "--data-urlencode", "--data-ascii", "--json", "--form", "--form-string", "--upload-file"].includes(name)) {
          data = true
          val()
        } else if (name === "--get") getFlag = true
        else if (name === "--head") method = "HEAD"
        else if (name === "--url") urls.push(val())
        else if (["--proxy", "--preproxy", "--socks4", "--socks4a", "--socks5", "--socks5-hostname"].includes(name)) extraHosts.push(hostOf(val()))
        else if (name === "--connect-to") {
          // HOST1:PORT1:HOST2:PORT2 — traffic for HOST1 really goes to HOST2
          const parts = String(val()).split(":")
          if (parts[2]) extraHosts.push(parts[2].toLowerCase())
        } else if (eq < 0 && ["--output", "--header", "--user", "--user-agent", "--referer", "--cookie", "--cookie-jar", "--max-time", "--connect-timeout", "--retry", "--cacert", "--cert", "--key", "--write-out", "--config", "--resolve", "--limit-rate", "--retry-delay", "--retry-max-time", "--dump-header", "--trace", "--trace-ascii"].includes(name)) i++
      } else if (a.startsWith("-") && a.length > 1) {
        const cl = a.slice(1)
        for (let k = 0; k < cl.length; k++) {
          const ch = cl[k]
          if (ch === "I") method = "HEAD"
          else if (ch === "G") getFlag = true
          else if (CURL_VALUE_LETTERS.has(ch)) {
            const attached = cl.slice(k + 1)
            const v = attached || args[++i]
            if (ch === "X") method = v
            else if (ch === "x" && v) extraHosts.push(hostOf(v))
            else if ("dFT".includes(ch)) data = true
            break
          }
        }
      } else urls.push(a)
    }
  } else if (base === "wget") {
    for (let i = 0; i < args.length; i++) {
      const a = args[i]
      if (a.startsWith("--")) {
        const eq = a.indexOf("=")
        const name = eq > 0 ? a.slice(0, eq) : a
        if (["--post-data", "--post-file", "--body-data", "--body-file"].includes(name)) {
          data = true
          if (eq < 0) i++
        } else if (name === "--method") method = eq > 0 ? a.slice(eq + 1) : args[++i]
        else if (eq < 0 && ["--header", "--user", "--password", "--output-document", "--directory-prefix", "--output-file", "--timeout", "--tries", "--user-agent", "--referer"].includes(name)) i++
      } else if (a.startsWith("-") && a.length > 1) {
        if (["-O", "-P", "-o", "-a", "-t", "-T", "-U", "-e", "-w", "-i"].includes(a)) i++
      } else urls.push(a)
    }
  } else {
    // httpie: [METHOD] URL [ITEM…]
    for (const a of args) {
      if (isFlag(a)) continue
      if (/^(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/i.test(a) && !urls.length && !method) method = a
      else if (/^[A-Za-z0-9_.-]+(?::=|=@|=)/.test(a) && !/^[a-z][a-z0-9+.-]*:\/\//i.test(a) && !/^[A-Za-z0-9_.-]+==/.test(a)) data = true
      else if (/^[A-Za-z0-9_.-]+@/.test(a) || /^[A-Za-z0-9_.-]+:=@/.test(a)) data = true
      else urls.push(a)
    }
  }
  if (getFlag) data = false
  const m = method == null ? null : String(method).toUpperCase()
  const write = data || (m !== null && !/^(?:GET|HEAD)$/.test(m))
  // every positional of curl/wget is a URL: a dot-less bare host (`curl http://localhost evil`) counts too
  const hosts = [...urls.filter((u) => u !== "").map(hostOf), ...extraHosts]
  const local = urls.length > 0 && hosts.length > 0 && hosts.every(isLocalHost)
  return { write, local, method: m, hosts }
}

// ---------------------------------------------------------------------------------------------
// gh api

function ghApiWrites(rest) {
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]
    if (a === "--") break
    if (a === "-X" || a === "--method") {
      if (String(rest[i + 1] ?? "").toUpperCase() !== "GET") return true
    } else if (a.startsWith("--method=")) {
      if (a.slice(9).toUpperCase() !== "GET") return true
    } else if (/^-X./.test(a)) {
      if (a.slice(2).toUpperCase() !== "GET") return true
    } else if (["-f", "-F", "--field", "--raw-field", "--input"].includes(a)) return true
    else if (/^-[fF]./.test(a) || /^--(?:field|raw-field|input)=/.test(a)) return true
  }
  return false
}

// ---------------------------------------------------------------------------------------------
// kubectl helpers

// kubectl flags that take a separate value (so the value is not a resource/name positional)
const KUBECTL_VALUE_FLAGS = new Set([
  "--timeout", "--grace-period", "-o", "--output", "--cascade", "-l", "--selector", "--field-selector", "-f",
  "--filename", "-k", "--kustomize", "--as", "--as-group", "--token", "--user", "--cluster", "--server", "-s", "--raw",
  "--propagation-policy", "--request-timeout", "--certificate-authority", "--client-certificate", "--client-key",
  "--cache-dir", "--username", "--password", "--tls-server-name", "--field-manager", "--subresource", "--context",
  "--kubeconfig", "-n", "--namespace", "--wait-timeout",
])

function kubectlPositionals(rest) {
  const out = []
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]
    if (a === "--") break
    if (a.startsWith("-") && a.length > 1) {
      if (KUBECTL_VALUE_FLAGS.has(a)) i++
      continue
    }
    out.push(a)
  }
  return out
}

/** `ns/x`, `namespace.v1`, `customresourcedefinitions.apiextensions.k8s.io` -> canonical short resource name. */
function normResource(tok) {
  let r = String(tok).toLowerCase()
  if (r.includes("/")) r = r.split("/")[0]
  r = r.split(".")[0]
  return K8S_ALIASES[r] ?? r
}

/** Every value given to -n / --namespace (also `-n=x`, `-nx`, `--namespace=x`), in order. */
function namespaceValues(args) {
  const out = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === "--") break
    if (a === "-n" || a === "--namespace") {
      if (i + 1 < args.length) out.push(args[++i])
    } else if (a.startsWith("--namespace=")) out.push(a.slice(12))
    else if (a.startsWith("-n=")) out.push(a.slice(3))
    else if (/^-n[^-=]/.test(a)) out.push(a.slice(2))
  }
  return out
}

function kubectlDeleteInfo(v, allArgs) {
  const rest = v.rest
  const pos = kubectlPositionals(rest)
  const resources = [...new Set(pos.flatMap((p) => p.split(",")).map(normResource).filter(Boolean))]
  const flags = new Set()
  for (const a of rest) {
    if (a === "--") break
    if (a === "--all" || a.startsWith("--all=")) flags.add("--all")
    else if (a === "-f" || a === "--filename" || a.startsWith("--filename=") || /^-f./.test(a)) flags.add("-f")
    else if (a === "-k" || a === "--kustomize" || a.startsWith("--kustomize=") || /^-k./.test(a)) flags.add("-k")
  }
  const allNs = allArgs.some((a) => a === "-A" || a === "--all-namespaces" || a === "--all-namespaces=true")
  const nsAll = namespaceValues(allArgs)
  return {
    resources,
    flags: [...flags],
    allNs,
    ns: nsAll[nsAll.length - 1], // kubectl uses the last one
    nsAll,
    dynResource: isDyn(pos[0] ?? ""),
    dynNs: nsAll.some(isDyn),
  }
}

function kubectlTexts(v, main, allArgs) {
  const texts = [main]
  if (v.verb !== "delete") return { texts, info: null }
  const info = kubectlDeleteInfo(v, allArgs)
  const others = v.rest.join(" ")
  for (const r of info.resources) texts.push(`kubectl delete ${r} ${others}`.trim())
  for (const f of info.flags) texts.push(`kubectl delete ${f} ${others}`.trim())
  return { texts, info }
}

// ---------------------------------------------------------------------------------------------
// path-argument helpers

const CONFIG_FLAGS = new Set(["--kubeconfig", "--talosconfig", "--config", "--kube-config"])
const KEY_FILE_TOOLS = new Set(["ssh", "scp", "sftp"])

/** Raw candidate path words: [{ w, cfgVal }] (dynamic words are filtered later, after variants). */
function pathWords(base, args) {
  const out = []
  for (let i = 0; i < args.length; i++) {
    let a = args[i]
    if (a === "") continue
    let cfgVal = false
    if (a.startsWith("--") && a.includes("=")) {
      const name = a.slice(0, a.indexOf("="))
      cfgVal = CONFIG_FLAGS.has(name)
      a = a.slice(a.indexOf("=") + 1)
    } else if (CONFIG_FLAGS.has(a)) {
      const nxt = args[i + 1]
      if (nxt !== undefined) out.push({ w: nxt, cfgVal: true })
      i++
      continue
    } else if (KEY_FILE_TOOLS.has(base) && a === "-i") {
      i++
      continue
    } else if (a.startsWith("-")) {
      // `-d@~/.ssh/id_rsa`, `-o/tmp/x`: short flag with an attached path-like value
      if (!a.startsWith("--") && a.length > 2 && /^[@~./<]|\$/.test(a.slice(2))) out.push({ w: a.slice(2), cfgVal: false })
      continue
    }
    if (!a) continue
    out.push({ w: a, cfgVal })
  }
  return out
}

/** `@path`, `key=@path`, `if=path`, `key=<path`, `name@path` (curl) -> the path-like variants of one word. */
function wordVariants(w) {
  const out = new Set([w])
  let s = w
  const eq = s.indexOf("=")
  if (eq > 0 && !s.startsWith("-")) s = s.slice(eq + 1)
  s = s.replace(/^[@<]+/, "")
  if (s) out.add(s)
  const at = /^[^@/\s:]+@(.+)$/.exec(w)
  if (at) out.add(at[1].replace(/^[@<]+/, ""))
  return [...out].filter(Boolean)
}

// ---- glob helpers (can a shell glob word reach a protected path?) -----------------------------

const GLOB_CH = /[*?[]/
const isGlobWord = (w) => GLOB_CH.test(w)

function segCompat(a, b) {
  const ga = GLOB_CH.test(a)
  const gb = GLOB_CH.test(b)
  if (!ga && !gb) return a.toLowerCase() === b.toLowerCase()
  const re = (g) => new RegExp(wildcardToRegExp(g).source, "is")
  if (!ga) return re(b).test(a)
  if (!gb) return re(a).test(b)
  const pre = (s) => s.split(GLOB_CH)[0].toLowerCase()
  const suf = (s) => s.slice(lastGlob(s) + 1).toLowerCase()
  const [pa, pb, sa, sb] = [pre(a), pre(b), suf(a), suf(b)]
  return (pa.startsWith(pb) || pb.startsWith(pa)) && (sa.endsWith(sb) || sb.endsWith(sa))
}

function lastGlob(s) {
  for (let i = s.length - 1; i >= 0; i--) if (GLOB_CH.test(s[i])) return i
  return -1
}

function segsMatch(g, d, i = 0, j = 0) {
  if (i === g.length && j === d.length) return true
  if (i < g.length && g[i] === "**") {
    for (let k = j; k <= d.length; k++) if (segsMatch(g, d, i + 1, k)) return true
    return false
  }
  if (j < d.length && d[j] === "**") {
    for (let k = i; k <= g.length; k++) if (segsMatch(g, d, k, j + 1)) return true
    return false
  }
  if (i >= g.length || j >= d.length) return false
  return segCompat(g[i], d[j]) && segsMatch(g, d, i + 1, j + 1)
}

const segs = (p) => String(p).split("/").filter(Boolean)

/** Absolute pattern strings for a config path pattern (`~` expanded with raw and real home). */
function expandPattern(p, home) {
  if (home && (p === "~" || p.startsWith("~/"))) {
    const realHome = canonical(home, "/", undefined)
    return [...new Set([home + p.slice(1), realHome + p.slice(1)])]
  }
  return [p]
}

/** Could the glob path `g` (absolute) match something in `denyPatterns` that `allowPatterns` do not cover? */
function globReaches(g, denyPatterns, allowPatterns, home) {
  const gs = segs(g)
  const lastSuf = (ss) => (ss.length ? ss[ss.length - 1].slice(lastGlob(ss[ss.length - 1]) + 1).toLowerCase() : "")
  for (const d of denyPatterns ?? []) {
    for (const dp of expandPattern(d, home)) {
      if (!segsMatch(gs, segs(dp))) continue
      const covered = (allowPatterns ?? []).some((a) =>
        expandPattern(a, home).some((ap) => {
          const as = lastSuf(segs(ap))
          return as !== "" && segsMatch(gs, segs(ap)) && lastSuf(gs).endsWith(as)
        }),
      )
      if (!covered) return true
    }
  }
  return false
}

/** Is the (non-glob) absolute path `a` an ancestor-or-equal of a directory holding a denied/own-config path? */
function containsProtected(a, patterns, home) {
  const as = segs(a)
  for (const p of patterns ?? []) {
    for (const pp of expandPattern(p, home)) {
      const ps = segs(pp)
      const lit = []
      for (const s of ps) {
        if (s === "**" || GLOB_CH.test(s)) break
        lit.push(s)
      }
      if (as.length <= lit.length && as.every((s, i) => s.toLowerCase() === lit[i].toLowerCase())) return true
    }
  }
  return false
}

const RECURSIVE_TOOLS = new Set(["rg", "ag", "ack", "zip"])
const RECURSIVE_FLAG_TOOLS = new Set(["cp", "grep", "egrep", "fgrep", "scp"])
const isExtractingTar = (args) => args.some((a) => a === "--extract" || a === "--get" || (!a.startsWith("--") && /^-?[A-Za-z]*x[A-Za-z]*$/.test(a)))
/** Does this command read whole directory trees given as arguments (so `~/.ssh` itself is a read of id_*)? */
const isRecursiveRead = (base, args) =>
  RECURSIVE_TOOLS.has(base) ||
  (base === "tar" && !isExtractingTar(args.slice(0, 1).concat(args.filter((a) => a.startsWith("-") && !a.startsWith("--"))))) ||
  (RECURSIVE_FLAG_TOOLS.has(base) && args.some((a) => a === "--recursive" || (/^-[A-Za-z]*[rRa][A-Za-z]*$/.test(a) && !a.startsWith("--"))))

const DESTRUCTIVE_TOOLS = new Set(["rm", "rmdir", "unlink", "shred", "mv"])

// ---------------------------------------------------------------------------------------------
// classify

const KNOWN_EXT_EXTRA = new Set(["git", "curl", "wget", "http", "docker", "podman"])

/**
 * Rule order (first match wins), see the module header and spec §4.1–4.5:
 *  1 secret-deny   2 agentExceptions   3 own-config write   4 secret-ask   5 opaque
 *  6 localAsk      7 known CLI (git / curl / docker push handled alongside)   8 unknown CLI with
 *  an external target   9–11 local read/write.
 */
export function classify(inv, target, cfg, ctx = {}) {
  const { home, tmpRoots = [], sessionDir, agent } = ctx
  const pathClassFn = ctx.pathClass ?? paths.pathClass
  const tool = String(inv?.tool ?? "")
  const args = Array.isArray(inv?.args) ? inv.args : []
  const base = baseName(tool)
  const cwd = inv?.cwd || sessionDir
  const pctx = { home, sessionDir: cwd }
  const redirects = inv?.redirects ?? []
  const pipeTo = Array.isArray(inv?.pipeTo) && inv.pipeTo.length ? inv.pipeTo.join(" ") : ""
  const argText = [base, ...args].join(" ").trim()
  // `env | grep ^X` is allowed by an `env | grep *` rule: pipe variants only feed the allow lists
  const withPipe = (texts) => (pipeTo ? [...texts, ...texts.map((t) => `${t} | ${pipeTo}`)] : texts)
  const known = Object.prototype.hasOwnProperty.call(cfg.readVerbs ?? {}, base)
  const knownExt = known || KNOWN_EXT_EXTRA.has(base)
  const v = verbOf(base, args)
  const abs = (p) => canonical(p, cwd, home)
  const realTmp = tmpRoots.map((r) => abs(r))
  const inTmp = (p) => {
    if (/^(?:\$TMPDIR|\$\{TMPDIR\})(?:\/|$)/.test(p)) return true
    if (isDyn(p)) return false
    const a = abs(p)
    return underRoot(a, tmpRoots) || underRoot(a, realTmp)
  }

  // ---- 1) secret-deny -----------------------------------------------------------------------
  const sd = cfg.secretDeny ?? {}
  if (matchAny(argText, sd.commands)) {
    return res("secret-deny", "secret-command", { detail: argText })
  }
  const redirectWords = redirects.filter((r) => r?.target && !isDyn(r.target) && !String(r.op).includes(">&") && !/^\d+$/.test(r.target) && r.target !== "/dev/null").map((r) => ({ w: r.target, read: r.op === "<" || String(r.op).startsWith("<") }))
  const tmp0 = tmpRoots[0] ? tmpRoots[0].replace(/\/+$/, "") : undefined
  /** `$TMPDIR/x` -> `<tmpRoot>/x`; undefined when it cannot be expanded. */
  const expandTmp = (s) => {
    const m = /^(?:\$TMPDIR|\$\{TMPDIR\})(?=\/|$)/.exec(s)
    if (!m) return s
    return tmp0 === undefined ? undefined : tmp0 + s.slice(m[0].length)
  }
  const recursive = isRecursiveRead(base, args)
  const candidates = []
  for (const c of [...pathWords(base, args), ...redirectWords]) {
    for (const variant of wordVariants(c.w)) {
      if (variant.includes("://") || variant.includes("`")) continue
      if (variant.includes("$") && !/^(?:\$HOME|\$\{HOME\}|\$TMPDIR|\$\{TMPDIR\})(?:\/|$)/.test(variant)) continue
      const w = expandTmp(variant)
      if (w) candidates.push({ w, cfgVal: c.cfgVal, read: c.read })
    }
  }
  const pcache = new Map()
  const pc = (w) => {
    if (!pcache.has(w)) pcache.set(w, pathClassFn(abs(w), cfg, pctx))
    return pcache.get(w)
  }
  const denyDirs = sd.paths ?? []
  // the destination of cp/scp is written, not read: `cp -r a ~/` must not look like reading ~/.ssh
  const destWord = ["cp", "scp", "mv", "install"].includes(base) ? positionals(args).at(-1) : undefined
  for (const c of candidates) {
    let hit = false
    if (isGlobWord(c.w)) hit = globReaches(abs(c.w), denyDirs, sd.pathAllow, home)
    else {
      hit = pc(c.w) === "secret-deny"
      if (!hit && recursive && c.w !== destWord && containsProtected(abs(c.w), denyDirs, home)) hit = true
    }
    if (hit) return res("secret-deny", "secret-path", { detail: c.w })
  }

  // ---- 2) per-agent exceptions --------------------------------------------------------------
  if (agent && cfg.agentExceptions?.[agent] && matchAny(argText, cfg.agentExceptions[agent])) {
    return res("local-read", "agent-exception", { detail: agent })
  }

  // ---- 3) shell writes into the agent's own configuration -----------------------------------
  const verbForGit = base === "git" ? v.verb : ""
  const writes = writeTargets(inv ?? {}, base, args, verbForGit)
  const ownPatterns = cfg.ownConfig ?? []
  const isOwn = (a) => {
    if (typeof paths.globMatch === "function") return ownPatterns.some((p) => paths.globMatch(p, a, home))
    return pathClassFn(a, cfg, pctx) === "own-config"
  }
  const mvSources = base === "mv" ? positionals(args).slice(0, -1) : []
  for (const w of writes) {
    if (w.marker || !w.p || isDyn(w.p)) continue
    const expanded = expandTmp(w.p)
    if (!expanded) continue
    const a = abs(expanded) // resolves `..` too
    // a directory target (`cp x ~/.config/opencode/agents/`, `rm -rf …/plugins`) is judged by what it would hold
    if (isOwn(a) || isOwn(a.replace(/\/+$/, "") + "/x")) return res("own-config", "write-own-config", { detail: w.p })
    if (DESTRUCTIVE_TOOLS.has(base) && (base !== "mv" || mvSources.includes(w.p)) && containsProtected(a, ownPatterns, home)) {
      return res("own-config", "remove-own-config-parent", { detail: w.p })
    }
  }

  // ---- 4) secrets to read -------------------------------------------------------------------
  const sa = cfg.secretAsk ?? {}
  const norm = normalizeOutputFlag(base, v)
  const askTexts = [argText, verbText(base, v), norm].filter(Boolean)
  if (askTexts.some((t) => matchAny(t, sa.commands))) {
    if (!withPipe(askTexts).some((t) => matchAny(t, sa.commandAllow))) return res("secret-ask", "secret-command", { detail: argText })
  }
  const askClass = (w) => pc(w) === "secret-ask"
  const askAnchored = (sa.paths ?? []).filter((p) => !p.startsWith("**"))
  for (const c of candidates) {
    if (c.cfgVal || c.read === false) continue
    let hit = false
    if (isGlobWord(c.w)) {
      // probe: let the glob stand for "" and "x" (`.env*` -> .env, `*.pem` -> x.pem)
      const probes = [c.w.replace(/\*+|\?|\[[^\]]*\]/g, ""), c.w.replace(/\*+|\?|\[[^\]]*\]/g, "x")]
      hit = probes.some((p) => askClass(p) || askClass(p.replace(/\/+$/, "") + "/x"))
      // `cat ~/.aws/cred*`, `cat ~/.kube/*`: could the glob reach a secretAsk path? (`**/…` patterns: probes only,
      // otherwise `cat *` would intersect `**/.env`)
      if (!hit) hit = globReaches(abs(c.w), askAnchored, sa.pathAllow, home)
    } else {
      hit = askClass(c.w)
      // `cp -r ~/.kube /tmp/k`, `grep -r token ~/.aws`, `tar czf x ~/.aws`: whole trees are read (names alone — `ls` — are not)
      if (!hit && recursive && c.w !== destWord && containsProtected(abs(c.w), askAnchored, home)) hit = true
      // `ls secrets/`, `grep -r x ./secrets` — the directory itself holds secrets
      if (!hit && (c.w.endsWith("/") || (recursive && /[/~]/.test(c.w)))) hit = askClass(abs(c.w).replace(/\/+$/, "") + "/x")
    }
    if (hit) return res("secret-ask", "secret-path", { detail: c.w })
  }

  // ---- 5) opaque ----------------------------------------------------------------------------
  const toolDyn = isDyn(tool) && !/^(?:\$TMPDIR|\$\{TMPDIR\})(?:\/|$)/.test(tool)
  if (toolDyn) return res("opaque", "unresolved-command", { detail: tool })
  if (base === "eval") return res("opaque", "eval")
  if (base === "xargs") {
    const cmd = xargsCommand(args)
    if (cmd !== undefined && (isDyn(cmd) || knownExt || KNOWN_EXT_EXTRA.has(baseName(cmd)) || Object.prototype.hasOwnProperty.call(cfg.readVerbs ?? {}, baseName(cmd)))) {
      return res("opaque", "xargs", { detail: cmd })
    }
  }
  if ((inv?.wrapped ?? []).some((w) => w === "xargs" || w === "eval") && (knownExt || tool.includes("/"))) {
    return res("opaque", "xargs-eval", { detail: argText })
  }
  const codeFlag = SHELLS.has(base) ? /^-[A-Za-z]*c$/ : /^-[A-Za-z]*[cem]$/ // `-c CODE`: inline code, not a script file
  if ((SHELLS.has(base) || INTERPRETERS.test(base)) && !args.some((a) => codeFlag.test(a))) {
    const script = positionals(args)[0]
    if (script !== undefined && inTmp(script)) return res("opaque", "tmp-script", { detail: script })
  }
  if ((base === "source" || base === ".") && args[0] !== undefined && inTmp(args[0])) {
    return res("opaque", "tmp-script", { detail: args[0] })
  }
  if (tool.includes("/") && inTmp(tool)) return res("opaque", "tmp-script", { detail: tool })

  // ---- 6) local ask list --------------------------------------------------------------------
  const la = cfg.localAsk ?? {}
  if (matchAny(argText, la.commands) && !withPipe([argText]).some((t) => matchAny(t, la.commandAllow))) {
    return res("local-ask", "local-ask-command", { detail: argText })
  }

  // ---- 7) known external CLIs ---------------------------------------------------------------
  if (known || base === "git") return classifyKnown()
  if (base === "curl" || base === "wget" || base === "http" || base === "https") {
    const h = classifyHttp(base === "https" ? "http" : base, args)
    return h.write && !h.local
      ? res("ext-write", "http-write", { verb: h.method ?? "data", detail: h.hosts.join(",") })
      : res("ext-read", "http-read", { verb: h.method ?? "GET", detail: h.hosts.join(",") })
  }
  if ((base === "docker" || base === "podman") && /^(?:push|manifest)$/.test(v.verb) && (v.verb === "push" || positionals(v.rest)[0] === "push")) {
    return res("ext-write", "registry-push", { verb: "push" })
  }

  // ---- 8) unknown CLI with an external target -----------------------------------------------
  if (!NO_TARGET_TOOLS.has(base) && !tool.includes("/")) {
    const ext = externalTarget(args, target)
    if (ext) {
      const first = positionals(withoutTargetFlags(args))[0]
      if (first !== undefined && !isDyn(first) && GENERIC_READ.test(first)) return res("ext-read", "unknown-cli-read", { verb: first, detail: ext })
      return res("ext-write", "unknown-cli-with-target", { verb: first, detail: ext })
    }
  }

  // ---- 9–11) local --------------------------------------------------------------------------
  if (inv?.funcDef) return res("local-write", "function-def")
  const hasWrite = writes.length > 0
  if (hasWrite) return res("local-write", "writes", { detail: writes.find((w) => w.p)?.p })
  if (LOCAL_WRITE_TOOLS.has(base) || tool.includes("/")) return res("local-write", "local-tool", { detail: base })
  if (inv?.unresolved) return res("local-write", "unresolved-args", { detail: argText })
  return res("local-read", "local")

  // ------------------------------------------------------------------------------------------
  function classifyKnown() {
    const allArgs = args
    if (base === "git") return classifyGit()

    // `inv.unresolved` only covers the first few args: look at every argument ourselves
    const unres = !!inv?.unresolved || allArgs.some(isDyn)
    const { cands } = verbCandidates(base, allArgs)
    if (!cands.length) cands.push({ idx: 0, v })
    const infos = cands.map((c) => {
      const main = verbText(base, c.v)
      let texts = [main]
      let kinfo = null
      if (base === "kubectl") ({ texts, info: kinfo } = kubectlTexts(c.v, main, allArgs))
      if (base === "aws" && c.v.verb.includes(" ")) {
        const [, op] = c.v.verb.split(" ")
        texts.push([base, op, c.v.rest.join(" ")].filter(Boolean).join(" "))
      }
      return { ...c, texts, kinfo }
    })
    const verb = infos[0].v.verb

    // helps are always reads
    if (!v.verb && !v.rest.some((a) => a !== "--help" && a !== "-h" && a !== "--version" && a !== "-v")) {
      return res("ext-read", "help", { verb })
    }
    if (allArgs.some((a) => a === "--help" || a === "-h") && !allArgs.includes("--")) return res("ext-read", "help", { verb })

    // irreversible — checked at every candidate verb position
    const irrPats = patList(base, cfg.irreversible?.[base])
    const exPats = patList(base, cfg.irreversibleExceptions?.[base])
    const rdPats = patList(base, cfg.readVerbs?.[base])
    for (const c of infos) {
      let irr = firstMatch(c.texts, irrPats)
      if (c.kinfo && c.v.verb === "delete") {
        const protectedNs = (cfg.protectedNamespaces ?? []).some((p) => c.kinfo.nsAll.includes(p))
        if (c.kinfo.allNs || protectedNs) irr = irr ?? "kubectl delete in protected namespace / all namespaces"
      }
      if (irr && firstMatch(c.texts, exPats)) irr = null
      if (irr) {
        const rd = firstMatch(c.texts, rdPats)
        if (!(rd && literalTokens(rd) > literalTokens(irr))) return res("irreversible", "irreversible", { verb: c.v.verb, detail: irr })
      }
    }

    // dry runs change nothing
    if (base === "kubectl" && allArgs.some((a) => /^--dry-run(?:=(?:client|server|true))?$/.test(a))) return res("ext-read", "dry-run", { verb })
    if (base === "helm" && allArgs.includes("--dry-run")) return res("ext-read", "dry-run", { verb })

    let isRead = false
    let reason = "read-verb"
    let readVerb = verb
    const s3 = base === "aws" ? infos.find((c) => /^s3 (?:cp|sync)$/.test(c.v.verb) && c.v.direction) : undefined
    if (s3) {
      // aws s3 cp/sync: by direction
      isRead = s3.v.direction === "down" || s3.v.direction === "local"
      reason = isRead ? "s3-download" : "s3-upload"
      readVerb = s3.v.verb
    } else {
      for (const c of infos) {
        const rd = firstMatch(c.texts, rdPats)
        if (!rd) continue
        isRead = true
        readVerb = c.v.verb
        if (base === "gh" && /\bapi\b/.test(rd) && ghApiWrites(c.v.rest)) {
          isRead = false
          reason = "gh-api-write"
        }
        break
      }
    }
    if (isRead) return res("ext-read", reason, { verb: readVerb })

    // unrecognisable pieces of a known external CLI (spec §4.1, A2/A6)
    if (inv?.contextSwitch) return res("opaque", "context-switch", { verb })
    if (unres) {
      const targetDyn = flagValues(allArgs, TARGET_FLAGS[base] ?? []).some(isDyn)
      const verbDyn = isDyn(verb) || (!verb && v.rest.some(isDyn))
      // a variable anywhere in `kubectl delete …` (kind, name, namespace, flags) may hide a §4.3 operation
      const kdel = infos.find((c) => c.kinfo && c.v.verb === "delete")
      const delDyn = !!kdel && (kdel.kinfo.dynResource || kdel.kinfo.dynNs || kdel.v.rest.some(isDyn))
      // …and for other tools: could a variable stand for something that turns this into a §4.3 operation?
      const couldIrr = infos.some((c) => couldBecomeIrreversible(c.texts[0], cfg.irreversible?.[base], irrPats))
      if (verbDyn || targetDyn || delDyn || couldIrr) {
        return res("opaque", "unresolved-target", { verb, detail: verbDyn ? "verb" : targetDyn ? "target" : "destructive-args" })
      }
    }
    return res("ext-write", reason === "gh-api-write" ? reason : "write-verb", { verb })
  }

  function classifyGit() {
    const verb = v.verb
    const rest = v.rest
    // `git $CMD …`: the verb itself is a variable — nothing can be judged
    if (isDyn(verb) || (!verb && rest.some(isDyn))) return res("opaque", "unresolved-target", { verb, detail: "verb" })
    if (verb === "push") return classifyPush()
    const irr = firstMatch([verbText("git", v)], patList("git", cfg.irreversible?.git))
    if (irr) return res("irreversible", "irreversible", { verb, detail: irr })
    if (!verb) return res("local-read", "git-help", { verb })
    if (GIT_READ.has(verb) || (GIT_LISTY.has(verb) && gitListy(verb, args))) return res("local-read", "git-read", { verb })
    return res("local-write", "git-write", { verb })
  }

  /**
   * git push: force / mirror / `+ref` and deleting refs (`--delete`, `-d`, `:ref`) are §4.3 operations.
   * Config exceptions (`:refs/tags/test-*`) are applied PER deleted ref — every deleted ref must be
   * covered. A variable in any argument means the flags/refs are unknown -> opaque.
   */
  function classifyPush() {
    const rest = v.rest
    const toks = []
    let hard = false
    let delFlag = false
    const pos = []
    for (let i = 0; i < rest.length; i++) {
      const a = rest[i]
      if (a === "--") {
        pos.push(...rest.slice(i + 1).map((x) => ({ x, i: i + 1 })))
        break
      }
      if (a.startsWith("--")) {
        const name = a.includes("=") ? a.slice(0, a.indexOf("=")) : a
        if (name === "--force" || name.startsWith("--force-") || name === "--mirror") hard = true
        else if (name === "--delete") delFlag = true
        toks.push({ x: a, kind: name === "--delete" ? "delflag" : "flag" })
        if (!a.includes("=") && ["--push-option", "--repo", "--receive-pack", "--exec"].includes(name) && i + 1 < rest.length) toks.push({ x: rest[++i], kind: "flag" })
      } else if (a === "-o") {
        toks.push({ x: a, kind: "flag" })
        if (i + 1 < rest.length) toks.push({ x: rest[++i], kind: "flag" })
      } else if (/^-[A-Za-z]+$/.test(a)) {
        if (a.includes("f")) hard = true
        if (a.includes("d")) delFlag = true
        toks.push({ x: a, kind: a.includes("d") ? "delcluster" : "flag" })
      } else if (a.startsWith("-")) {
        toks.push({ x: a, kind: "flag" })
      } else pos.push({ x: a, i })
    }
    const remote = pos[0]?.x
    const refspecs = pos.slice(1).map((p) => p.x)
    const exPats = patList("git", cfg.irreversibleExceptions?.git)
    const covered = (ref, flagForm) => {
      const forms = flagForm ? [`git push ${remote} --delete ${ref}`, `git push ${remote} -d ${ref}`] : [`git push ${remote} :${ref}`]
      return forms.some((t) => matchAny(t, exPats))
    }
    const deleted = []
    for (const rs of refspecs) {
      if (rs.startsWith("+")) hard = true
      else if (rs.startsWith(":") && rs.length > 1) deleted.push({ rs, ref: rs.slice(1), flagForm: false })
      else if (delFlag) deleted.push({ rs, ref: rs, flagForm: true })
    }
    const uncovered = deleted.filter((d) => !covered(d.ref, d.flagForm))
    // text for the config patterns, without the deletions that an exception covers
    const dropRefs = new Set(deleted.filter((d) => !uncovered.includes(d)).map((d) => d.rs))
    const allCovered = delFlag && deleted.length > 0 && uncovered.length === 0
    const outToks = []
    for (const t of toks) {
      if (allCovered && (t.kind === "delflag" || t.kind === "delcluster")) {
        if (t.kind === "delcluster") {
          const left = t.x.replace(/d/g, "")
          if (left.length > 1) outToks.push(left)
        }
        continue
      }
      outToks.push(t.x)
    }
    const sanitized = ["git", "push", ...outToks, ...(remote ? [remote] : []), ...refspecs.filter((r) => !dropRefs.has(r))].join(" ")
    let irr = null
    if (hard) irr = "push --force/--mirror/+ref"
    else if (uncovered.length) irr = `push deleting ${uncovered.map((d) => d.rs).join(" ")}`
    else irr = firstMatch([sanitized], patList("git", cfg.irreversible?.git))
    if (irr) return res("irreversible", "irreversible", { verb: "push", detail: irr })
    if (args.some(isDyn)) return res("opaque", "unresolved-target", { verb: "push", detail: "push-args" })
    return res("ext-write", "git-push", { verb: "push" })
  }
}

// ---------------------------------------------------------------------------------------------

/** `kubectl … get secret x -ojson` / `--output=json` / `-o json` placed anywhere -> "… get secret x -o json". */
function normalizeOutputFlag(base, v) {
  if (base !== "kubectl") return ""
  const rest = []
  let out
  for (let i = 0; i < v.rest.length; i++) {
    const a = v.rest[i]
    if (a === "-o" || a === "--output") {
      out = v.rest[++i]
    } else if (a.startsWith("--output=") || a.startsWith("-o=")) {
      out = a.slice(a.indexOf("=") + 1)
    } else if (/^-o./.test(a) && !a.startsWith("--")) {
      out = a.slice(2)
    } else rest.push(a)
  }
  if (out === undefined) return ""
  return [base, v.verb, ...rest, "-o", out].filter(Boolean).join(" ")
}

function xargsCommand(args) {
  const VAL = new Set(["-I", "-n", "-P", "-L", "-d", "-s", "-E", "-a", "-l", "-i"])
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === "--") return args[i + 1]
    if (a.startsWith("-")) {
      if (VAL.has(a)) i++
      continue
    }
    return a
  }
  return undefined
}

/**
 * Could a variable in `text` (e.g. `kubectl delete $KIND $NS`) stand for a word that makes it match an
 * irreversible pattern? Tries every literal word of the tool's irreversible patterns in each dynamic slot.
 */
function couldBecomeIrreversible(text, patterns, irrPats) {
  if (!patterns?.length) return false
  const lits = new Set()
  for (const p of patterns) for (const tok of p.split(/\s+/)) if (tok) lits.add(tok.replace(/[*?]/g, "x"))
  const toks = text.split(" ")
  for (let j = 0; j < toks.length; j++) {
    if (!isDyn(toks[j])) continue
    for (const l of lits) {
      const t = toks.map((x, k) => (k === j ? l : x)).join(" ")
      if (firstMatch([t], irrPats)) return true
    }
  }
  return false
}

function withoutTargetFlags(args) {
  const out = []
  for (let i = 0; i < args.length; i++) {
    if (EXT_TARGET_FLAGS.includes(args[i])) i++
    else out.push(args[i])
  }
  return out
}

function externalTarget(args, target) {
  for (const a of args) {
    if (a === "--") break
    for (const f of EXT_TARGET_FLAGS) if (a === f || a.startsWith(f + "=")) return f
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(a) && !isLocalHost(hostOf(a))) return hostOf(a)
  }
  if (target && ["k8s", "aws", "talos", "cloud"].includes(target.kind)) return `target:${target.kind}`
  return null
}

// ---------------------------------------------------------------------------------------------

export const SEVERITY = [
  "secret-deny", "irreversible", "own-config", "secret-ask", "opaque", "ext-write", "local-ask", "ext-read",
  "local-write", "local-read",
]

/** Most restrictive of several classifications (e.g. one per simple command of a pipeline). */
export function worst(list) {
  let best
  let rank = Infinity
  for (const c of list ?? []) {
    const r = SEVERITY.indexOf(c?.cls)
    if (r >= 0 && r < rank) {
      rank = r
      best = c
    }
  }
  return best
}
