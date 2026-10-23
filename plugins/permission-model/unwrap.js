import path from "node:path"
import { parseCommand } from "./parse.js"

// Unwrapper (spec §4.1 "Nierozpoznawalne", §5.2): turns the Simple[] from parse.js into
// Invocation[] — wrappers (timeout/env/time/nice/nohup/command/builtin/exec/xargs/sh -c/eval)
// peeled off, `K=V cmd` folded into `env`, `cd` tracked, context switches flagged.
//
// Invocation = { tool, args, env, cwd, unresolved, wrapped, contextSwitch,
//                redirects, heredoc, raw, stdinFrom?, pipeTo? }
//   pipeTo        words of the command this one is piped into (`env | grep ^X` → ["grep","^X"])
//   tool          command word after wrappers, `$HOME`/`$TMPDIR`/`~` expanded
//   args          remaining words, RAW (not expanded; use expandVars() when a path is needed)
//   env           K=V from leading assignments and `env K=V`, values expanded (safe vars only)
//   cwd           tracked working directory when the command starts; null = unknown
//   unresolved    tool or one of the first 3 args holds an unexpanded $VAR / $( ) / `…`,
//                 or the command went through xargs / eval
//   wrapped       outermost → innermost: "timeout"|"env"|"time"|"nice"|"nohup"|"xargs"|"shell-c"|"eval"
//   contextSwitch an EARLIER simple of the same command switched kube context / AWS profile
//                 (`use-context`, `asp`, or a DYNAMIC `export KUBECONFIG=$X` — a literal
//                 `export KUBECONFIG=…`/`AWS_PROFILE=…` is instead carried into later `env`)
//   vars          literal `NAME=value` assignments made earlier in the same command (only when any)
// Assignment-only simples (`FOO=1`) are not emitted unless they have redirects (then tool "").
// `for`/`case`/`while` header pseudo-commands and function definitions are skipped.

const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh"])
const KEYWORDS = new Set(["for", "case", "while", "until", "select"])
const ASSIGN_RE = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s
const SAFE_VAR_RE = /\$(?:\{(?:HOME|TMPDIR|PWD|USER)\}|(?:HOME|TMPDIR|PWD|USER)(?![A-Za-z0-9_])|[!?])/g
const EXPAND_RE = /\$\{(HOME|TMPDIR|PWD|USER)\}|\$(HOME|TMPDIR|PWD|USER)(?![A-Za-z0-9_])/g
const MAX_DEPTH = 10

const stripSlash = (p) => (typeof p === "string" && p.length > 1 ? p.replace(/\/+$/, "") || "/" : p)
const cmdName = (w) => (w.startsWith("/") ? path.basename(w) : w)

/**
 * Expand `~`, `$HOME`, `${HOME}`, `$TMPDIR`, `${TMPDIR}`, `$PWD`, `$USER` when the value is known;
 * anything else (and unknown values) stays as written.
 */
export function expandVars(text, { home, tmpDir, cwd, user } = {}) {
  let s = String(text)
  if (home && (s === "~" || s.startsWith("~/"))) s = stripSlash(home) + s.slice(1)
  const values = { HOME: stripSlash(home), TMPDIR: stripSlash(tmpDir), PWD: cwd ?? undefined, USER: user }
  return s.replace(EXPAND_RE, (m, a, b) => {
    const v = values[a ?? b]
    return v === undefined || v === null || v === "" ? m : v
  })
}

/** True when `text` still holds an unexpanded variable / substitution (safe vars excluded). */
export function hasUnresolved(text, dynFlag) {
  if (dynFlag === false) return false
  const rest = String(text).replace(SAFE_VAR_RE, "")
  return rest.includes("$") || rest.includes("`")
}

const XARGS_VALUE_SHORT = new Set(["-I", "-n", "-P", "-L", "-d", "-E", "-s", "-a", "-J"])
const XARGS_VALUE_LONG = new Set(["--arg-file", "--delimiter", "--max-args", "--max-procs", "--max-lines", "--eof", "--max-chars"])

/** Peel wrappers off the front of `words`. Returns the remaining words plus what was learned. */
function stripWrappers(words, dyn, ctx) {
  let w = words
  let d = dyn
  const wrapped = []
  const env = {}
  let unresolved = false
  let cwd // from `env -C DIR`
  const drop = (n) => {
    w = w.slice(n)
    d = d.slice(n)
  }
  outer: for (let guard = 0; guard < 20 && w.length > 0; guard++) {
    switch (cmdName(w[0])) {
      case "timeout":
      case "gtimeout": {
        let i = 1
        while (i < w.length && w[i].startsWith("-") && w[i] !== "--") {
          i += ["-s", "--signal", "-k", "--kill-after"].includes(w[i]) ? 2 : 1
        }
        if (w[i] === "--") i++
        i++ // DURATION
        if (i >= w.length) break outer
        wrapped.push("timeout")
        drop(i)
        continue
      }
      case "time": {
        let i = 1
        while (i < w.length && w[i].startsWith("-")) i++
        if (i >= w.length) break outer
        wrapped.push("time")
        drop(i)
        continue
      }
      case "nice": {
        let i = 1
        while (i < w.length && w[i].startsWith("-")) i += w[i] === "-n" || w[i] === "--adjustment" ? 2 : 1
        if (i >= w.length) break outer
        wrapped.push("nice")
        drop(i)
        continue
      }
      case "nohup": {
        if (w.length < 2) break outer
        wrapped.push("nohup")
        drop(1)
        continue
      }
      case "env": {
        let i = 1
        const local = {}
        for (; i < w.length; i++) {
          const a = w[i]
          const m = ASSIGN_RE.exec(a)
          if (m) {
            local[m[1]] = expandVars(m[2], ctx)
          } else if (a === "--") {
            i++
            break
          } else if (["-u", "--unset", "-C", "--chdir", "-P", "-S", "--split-string"].includes(a)) {
            if (a === "-C" || a === "--chdir") cwd = w[i + 1]
            if (a === "-S" || a === "--split-string") unresolved = true
            i++
          } else if (a.startsWith("--chdir=")) {
            cwd = a.slice(8)
          } else if (a.startsWith("-S") || a.startsWith("--split-string=")) {
            unresolved = true
          } else if (a.startsWith("-")) {
            // -i, -0, -v, -uX …
          } else {
            break
          }
        }
        if (i >= w.length) break outer // `env`, `env K=V` alone: prints the environment
        Object.assign(env, local)
        wrapped.push("env")
        drop(i)
        continue
      }
      case "command": {
        let i = 1
        while (i < w.length && w[i].startsWith("-") && w[i] !== "--") {
          if (/^-[A-Za-z]*[vV]/.test(w[i])) break outer // `command -v x` only queries
          i++
        }
        if (w[i] === "--") i++
        if (i >= w.length) break outer
        drop(i)
        continue
      }
      case "builtin": {
        if (w.length < 2) break outer
        drop(1)
        continue
      }
      case "exec": {
        let i = 1
        while (i < w.length && w[i].startsWith("-") && w[i] !== "--") i += w[i] === "-a" ? 2 : 1
        if (w[i] === "--") i++
        if (i >= w.length) break outer
        drop(i)
        continue
      }
      case "xargs": {
        let i = 1
        while (i < w.length && w[i].startsWith("-") && w[i] !== "--") {
          i += XARGS_VALUE_SHORT.has(w[i]) || XARGS_VALUE_LONG.has(w[i]) ? 2 : 1
        }
        if (w[i] === "--") i++
        wrapped.push("xargs")
        unresolved = true
        if (i >= w.length) break outer // bare xargs (echo)
        drop(i)
        continue
      }
      case "eval": {
        wrapped.push("eval")
        unresolved = true
        break outer
      }
      default:
        break outer
    }
  }
  return { words: w, dyn: d, wrapped, env, unresolved, cwd }
}

function switchesContext(tool, args) {
  const name = cmdName(tool)
  if (name === "asp" || name === "kubectx" || name === "kubens") return true
  if (name === "kubectl") {
    const ci = args.indexOf("config")
    return ci >= 0 && args.slice(ci + 1).some((a) => a === "use-context" || a === "set-context" || a === "set-cluster")
  }
  return false
}

// Target-selecting variables: a LITERAL value assigned earlier in the same command is carried into the
// later invocations as `inv.env` (so target resolution sees it); a dynamic value is a context switch.
const TARGET_VARS = new Set(["AWS_PROFILE", "KUBECONFIG"])
const DECLARE_LIKE = new Set(["export", "declare", "typeset", "local", "readonly"])
const USER_VAR_RE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g

/** Replace `$NAME` / `${NAME}` by the literal values recorded earlier in this command (unknown names stay). */
function expandUser(text, vars) {
  if (!vars || typeof text !== "string" || !text.includes("$")) return text
  return text.replace(USER_VAR_RE, (m, a, b) => {
    const v = vars[a ?? b]
    return v === undefined ? m : v
  })
}

/**
 * Record `NAME=value` made by an assignment-only simple or by `export`/`declare`/… — vars for literal
 * values, `exports` (target variables) and the context switch for dynamic target values.
 */
function noteAssign(st, state, name, rawValue, dynamic, ctx) {
  // `$$` (the shell's pid, e.g. `spike_$$.sh`) only varies the file name: a stand-in digit keeps the path usable
  const e = expandVars(dynamic === false ? rawValue : expandUser(rawValue, st.vars), { ...ctx, cwd: st.cwd }).replace(/\$\$/g, "0")
  const literal = !hasUnresolved(e, dynamic === false ? false : undefined)
  if (literal) st.vars[name] = e
  else delete st.vars[name]
  if (!TARGET_VARS.has(name)) return
  if (literal) {
    st.exports[name] = e
  } else {
    delete st.exports[name]
    st.contextSwitch = true
    state.contextSwitch = true
  }
}

/** Next cwd after `cd`/`pushd`/`popd`; null = unknown. */
function cdTarget(tool, args, st, ctx) {
  const name = cmdName(tool)
  if (name === "popd") return null
  const idx = args.findIndex((a) => !a.startsWith("-") || a === "-")
  if (idx < 0) return ctx.home ?? null
  const arg = args[idx]
  if (arg === "-") return null
  return resolveCwd(arg, st, ctx)
}

/** Find the `-c` script of `sh -c …`; returns { index (in args), script } or undefined. */
function shellScript(args) {
  for (let j = 0; j < args.length; j++) {
    const a = args[j]
    if (/^-[A-Za-z]+$/.test(a) && a.includes("c")) return j + 1 < args.length ? { index: j + 1, script: args[j + 1] } : { index: -1, script: undefined }
    if (a === "-o" || a === "-O" || a === "+o" || a === "+O") {
      j++
      continue
    }
    if (!a.startsWith("-") && !a.startsWith("+")) return undefined
  }
  return undefined
}

function run(simples, state, ctx, base, out, depth) {
  const wrapMap = new Map()
  let scope = null
  for (let i = 0; i < simples.length; i++) {
    const s = simples[i]
    let st = state
    if (s.nested) {
      if (!scope) scope = { ...state, vars: { ...state.vars }, exports: { ...state.exports } }
      st = scope
    } else {
      scope = null
    }
    if (s.funcDef) continue
    let words = s.words ?? []
    let wordDyn = s.dynamic ?? []
    if (words.length > 0 && KEYWORDS.has(words[0])) continue
    if (words.length > 1 && words[0].startsWith("-") && /^\s*time\b/.test(s.raw ?? "")) {
      // parse.js drops the `time` keyword but leaves its flags (`time -p make`)
      let n = 0
      while (n < words.length - 1 && words[n].startsWith("-")) n++
      words = words.slice(n)
      wordDyn = wordDyn.slice(n)
    }
    const setSwitch = () => {
      st.contextSwitch = true
      state.contextSwitch = true
    }
    const inherited = wrapMap.get(i) ?? base
    const env = { ...inherited.env, ...st.exports }
    for (const a of s.assigns ?? []) env[a.name] = expandVars(a.dynamic ? expandUser(a.value, st.vars) : a.value, ctx)

    if (words.length === 0) {
      // assignment-only (or redirect-only) simple
      for (const a of s.assigns ?? []) noteAssign(st, state, a.name, a.value, !!a.dynamic, ctx)
      if ((s.redirects ?? []).length > 0) out.push(makeInv(s, "", [], env, st.cwd, false, [...inherited.wrapped], st.contextSwitch))
      continue
    }

    const dyn = wordDyn.slice(0, words.length)
    while (dyn.length < words.length) dyn.push(undefined)
    const stripped = stripWrappers(words, dyn, { ...ctx, cwd: st.cwd })
    if (stripped.words.length === 0) continue
    Object.assign(env, stripped.env)
    const ownWrapped = stripped.wrapped
    const fullWrapped = [...inherited.wrapped, ...ownWrapped]
    const tool = stripped.words[0]
    const args = stripped.words.slice(1)
    const adyn = stripped.dyn.slice(1)
    const invCwd = stripped.cwd !== undefined ? resolveCwd(stripped.cwd, st, ctx) : st.cwd

    // sh -c '…'
    if (SHELLS.has(cmdName(tool))) {
      const sc = shellScript(args)
      if (sc) {
        const run_ = []
        for (let k = i + 1; k < simples.length && simples[k].nested; k++) run_.push(k)
        const firstShellC = run_.find((k) => simples[k].nested === "shell-c")
        const scriptDyn = sc.index >= 0 ? adyn[sc.index] : undefined
        if (firstShellC !== undefined) {
          const w = { wrapped: [...fullWrapped, "shell-c"], env }
          for (const k of run_) if (k >= firstShellC) wrapMap.set(k, w)
          if ((s.redirects ?? []).length > 0 || s.heredoc) out.push(makeInv(s, tool, args, env, invCwd, true, [...fullWrapped, "shell-c"], st.contextSwitch))
          continue
        }
        if (sc.script !== undefined && sc.script.trim() !== "" && depth < MAX_DEPTH) {
          // only exported variables reach the child shell; its own assignments do not leak back
          const inner = { ...st, cwd: invCwd, vars: {}, exports: { ...st.exports } }
          run(parseCommand(sc.script), inner, ctx, { wrapped: [...fullWrapped, "shell-c"], env }, out, depth + 1)
          if (inner.contextSwitch) setSwitch()
          if ((s.redirects ?? []).length > 0 || s.heredoc) out.push(makeInv(s, tool, args, env, invCwd, hasUnresolved(sc.script, scriptDyn), [...fullWrapped, "shell-c"], st.contextSwitch))
          continue
        }
        // empty script or nothing to look into: emit the shell itself, flagged
        out.push(makeInv(s, tool, args, env, invCwd, sc.script === undefined || depth >= MAX_DEPTH, [...fullWrapped, "shell-c"], st.contextSwitch))
        continue
      }
    }

    const expTool = expandVars(tool, ctx)
    let unresolved = stripped.unresolved || /^[$`]/.test(expTool) || hasUnresolved(expTool, dyn[words.length - stripped.words.length])
    // `$VAR` inside `[[ … ]]` / `[ … ]` / `test` is a comparison operand, not a command word
    const conditional = expTool === "[[" || expTool === "[" || expTool === "test"
    for (let k = 0; k < Math.min(3, args.length) && !unresolved && !conditional; k++) {
      if (hasUnresolved(args[k], adyn[k])) unresolved = true
    }
    const inv = makeInv(s, expTool, args, env, invCwd, unresolved, fullWrapped, st.contextSwitch)
    // literal variables assigned earlier in the same command (the classifier resolves script paths with them)
    if (Object.keys(st.vars).length > 0) inv.vars = { ...st.vars }
    // `env | grep ^X`: the classifier needs to know what this command is piped into
    for (let k = i + 1; k < simples.length; k++) {
      if ((simples[k].nested ?? null) !== (s.nested ?? null)) continue // commands nested deeper (`$( )`) come in between
      if (simples[k].stdinFrom === "pipe") inv.pipeTo = [...(simples[k].words ?? [])]
      break
    }
    out.push(inv)

    const name = cmdName(expTool)
    if (name === "cd" || name === "pushd" || name === "popd") st.cwd = cdTarget(expTool, args, st, ctx)
    if (DECLARE_LIKE.has(name)) {
      for (let k = 0; k < args.length; k++) {
        const m = ASSIGN_RE.exec(args[k])
        if (m) noteAssign(st, state, m[1], m[2], adyn[k] !== false, ctx)
      }
    } else if (name === "unset") {
      for (const a of args) {
        delete st.vars[a]
        delete st.exports[a]
      }
    } else if (switchesContext(expTool, args)) setSwitch()
  }
}

function resolveCwd(dir, st, ctx) {
  const e = expandVars(dir, { ...ctx, cwd: st.cwd })
  if (hasUnresolved(e) || e.startsWith("~")) return null
  if (path.isAbsolute(e)) return path.resolve(e)
  return st.cwd ? path.resolve(st.cwd, e) : null
}

function makeInv(s, tool, args, env, cwd, unresolved, wrapped, contextSwitch) {
  const inv = {
    tool,
    args,
    env,
    cwd,
    unresolved,
    wrapped,
    contextSwitch: !!contextSwitch,
    redirects: s.redirects ?? [],
    heredoc: !!s.heredoc,
    raw: s.raw ?? "",
  }
  if (s.stdinFrom) inv.stdinFrom = s.stdinFrom
  return inv
}

/**
 * @param {object[]} simples output of parseCommand()
 * @param {{cwd?: string|null, home?: string, tmpRoots?: string[], env?: Record<string,string>}} opts
 */
export function unwrap(simples, { cwd = null, home, tmpRoots = [], env = {} } = {}) {
  const tmpDir = stripSlash(env.TMPDIR ?? tmpRoots[0])
  const ctx = { home: stripSlash(home), tmpDir, user: env.USER }
  const state = { cwd: cwd === undefined ? null : cwd, contextSwitch: false, vars: {}, exports: {} }
  const out = []
  run(simples, state, ctx, { wrapped: [], env: {} }, out, 0)
  return out
}
