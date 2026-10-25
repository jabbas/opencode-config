// Read-only shell profile for restricted agents (spec §4.7a).
//
//   checkRestricted(inv, cfg) -> { ok: true } | { ok: false, what, why }
//
// Judges ONE invocation (after parse + unwrap) against `cfg.restrictedShell`. The classifier's
// `local-read` class means "does not reach outside", not "does not write" (`find -delete`,
// `python3 -c`, `sort -o`, `>&file` … are local-read), so the profile is an allowlist of TOOLS
// plus per-tool argument rules; redirections are judged here from the parsed redirect list.
// Missing/empty config section -> nothing passes (fail closed).

import { matchAny } from "./match.js"

const DYN = /\$(?!\{?(?:HOME|TMPDIR)\b)|`/
const isDyn = (w) => DYN.test(String(w ?? ""))
const isFlag = (w) => typeof w === "string" && w.startsWith("-") && w.length > 1

const baseName = (t) => {
  const s = String(t ?? "")
  const i = s.lastIndexOf("/")
  return i >= 0 && i < s.length - 1 ? s.slice(i + 1) : s
}

// A tool given by path must live in a system bin dir — `./docs/cat` (a file the agent wrote) is not `cat`.
const SYSTEM_BIN = /^\/(?:usr\/(?:local\/)?)?s?bin\/[^/]+$|^\/opt\/homebrew\/s?bin\/[^/]+$/

// git global options (before the verb) that take a value
const GIT_VALUE_GLOBALS = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--config-env", "--exec-path", "--super-prefix"])

const fail = (what, why) => ({ ok: false, what, why })

/**
 * `-X` / `-X*` patterns also match inside a short-flag cluster (`sort -no out` hides `-o`).
 * Multi-letter single-dash options (`find -delete`) are matched as whole words only.
 */
function argMatches(token, patterns) {
  if (matchAny(token, patterns)) return true
  if (!/^-[A-Za-z0-9]{2,}/.test(token) || token.startsWith("--")) return false
  const cluster = token.slice(1).match(/^[A-Za-z0-9]+/)?.[0] ?? ""
  for (const p of patterns ?? []) {
    const m = /^-([A-Za-z0-9])\*?$/.exec(String(p))
    if (m && cluster.includes(m[1])) return true
  }
  return false
}

/** Positional tokens (non-flags; everything after `--`). */
function positionals(args) {
  const out = []
  let dd = false
  for (const a of args) {
    if (dd) out.push(a)
    else if (a === "--") dd = true
    else if (!isFlag(a)) out.push(a)
  }
  return out
}

function checkRedirects(redirects) {
  for (const r of redirects ?? []) {
    const op = String(r?.op ?? "")
    const target = String(r?.target ?? "")
    if (op.includes("<>")) return fail(`przekierowanie ${op}`, "redirect")
    if (!op.includes(">")) continue // input redirections, heredocs, here-strings
    if (target === "/dev/null") continue
    // fd duplication: 2>&1, >&2, 1>&-, >&- (but `>&file` / `&>file` write a file)
    if (op.includes(">&") && /^(?:\d+-?|-)$/.test(target)) continue
    return fail(`przekierowanie ${op} ${target}`.trim(), "redirect")
  }
  return null
}

function checkEnv(env, safe) {
  for (const k of Object.keys(env ?? {})) {
    if (!matchAny(k, safe ?? [])) return fail(`zmienna ${k}=`, "env")
  }
  return null
}

function checkGit(args, rules) {
  // locate the verb; refuse config injection through global options
  let verbIdx = -1
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    const name = a.startsWith("--") && a.includes("=") ? a.slice(0, a.indexOf("=")) : a
    if (name === "-c" || name === "--config-env" || name === "--exec-path") return fail(`git ${name}`, "git-global")
    if (GIT_VALUE_GLOBALS.has(name)) {
      if (name === a) i++
      continue
    }
    if (isFlag(a)) continue
    verbIdx = i
    break
  }
  if (verbIdx < 0) return null // `git --version`, `git` alone
  const verb = args[verbIdx]
  const rule = rules?.verbs?.[verb]
  if (!rule) return fail(`git ${verb}`, "git-verb")
  const rest = args.slice(verbIdx + 1)
  if (rest.some(isDyn)) return fail(`git ${verb} (argument dynamiczny)`, "dynamic-arg")
  const deny = [...(rules.denyAll ?? []), ...(rule.deny ?? [])]
  const bad = rest.find((t) => argMatches(t, deny))
  if (bad) return fail(`git ${verb} ${bad}`, "git-arg")
  const pos = positionals(rest)
  if (rule.first) {
    if (pos.length === 0) {
      if (!rule.bare) return fail(`git ${verb}`, "git-sub")
    } else if (!rule.first.includes(pos[0])) return fail(`git ${verb} ${pos[0]}`, "git-sub")
  }
  if (rule.positionalNeeds && pos.length > 0 && !rest.some((t) => argMatches(t, rule.positionalNeeds))) {
    return fail(`git ${verb} ${pos[0]}`, "git-sub")
  }
  if (rule.requireAny && !rest.some((t) => matchAny(t, rule.requireAny))) return fail(`git ${verb}`, "git-sub")
  return null
}

export function checkRestricted(inv, cfg) {
  const rs = cfg?.restrictedShell
  const rawTool = String(inv?.tool ?? "")
  const tool = baseName(rawTool)
  const args = Array.isArray(inv?.args) ? inv.args.map(String) : []
  if (!rs || !Array.isArray(rs.tools)) return fail(tool || "?", "no-profile")
  if (isDyn(rawTool)) return fail(rawTool, "dynamic-tool")
  if (rawTool.includes("/") && !SYSTEM_BIN.test(rawTool)) return fail(rawTool, "tool-path")
  if (!rs.tools.includes(tool)) return fail([tool, args.find((a) => !isFlag(a))].filter(Boolean).join(" "), "tool")

  const env = checkEnv(inv?.env, rs.safeEnv)
  if (env) return env
  const red = checkRedirects(inv?.redirects)
  if (red) return red

  if (tool === "git") return checkGit(args, rs.git) ?? { ok: true }

  const denyArgs = rs.denyArgs?.[tool]
  const maxPos = rs.maxPositionals?.[tool]
  if (denyArgs || maxPos !== undefined) {
    // arguments we cannot see (variables, xargs input) could be any forbidden option
    if (args.some(isDyn) || (inv?.wrapped ?? []).includes("xargs")) return fail(`${tool} (argument dynamiczny)`, "dynamic-arg")
    const bad = denyArgs ? args.find((t) => argMatches(t, denyArgs)) : undefined
    if (bad) return fail(`${tool} ${bad}`, "arg")
    if (maxPos !== undefined && positionals(args).length > maxPos) return fail(`${tool} ${positionals(args).slice(maxPos).join(" ")}`, "arg")
  }
  return { ok: true }
}
