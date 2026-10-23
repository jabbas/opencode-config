// Independent labeler for the permission-model corpus: "what SHOULD the decision be", derived from the
// spec (docs/superpowers/specs/2026-10-22-permission-model-v2-design.md §3–§4) — NOT from the plugin.
// It shares no code with plugins/permission-model; it is a deliberately simple, coarse re-reading of the
// spec used to detect disagreements (every disagreement is then triaged by hand: code bug or label bug).
//
//   label(entry, { home, tmpDir }) -> { expected: "allow"|"ask"|"deny", why: "§…", note? }
//
// Policy decisions made when the spec is silent are marked with `note` so the user can overrule them:
//   * unknown verb on a KNOWN external CLI = write (spec §4.1 "zapisy = reszta"),
//   * a command word that is a variable / substitution = "nie da się ocenić" = ask (§4.1 "Nierozpoznawalne"),
//   * running a script that lives in tmp (also: relative script with a tmp working dir) = ask (§4.1),
//   * `home` (admin@k8s) allows exactly the verbs of §3.1; anything else external = ask.
import os from "node:os"
import path from "node:path"

const RANK = { allow: 0, ask: 1, deny: 2 }
const DEV = ["kind-*", "*-dev", "*-test", "*-sandbox"]
const PROD = ["*-prod", "*-prd", "*-production"]
const HOME_CTX = ["admin@k8s"]

const glob = (pat, s) => new RegExp(`^${pat.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`, "s").test(s)
const anyGlob = (pats, s) => pats.some((p) => glob(p, s))
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** Class of a kube context / aws profile name. */
export function targetClass(name) {
  if (name === undefined || name === "" || /[$`]/.test(name)) return "unknown"
  if (anyGlob(HOME_CTX, name)) return "home"
  if (anyGlob(DEV, name)) return "dev"
  if (anyGlob(PROD, name)) return "prod"
  return "unknown"
}

// ---------------------------------------------------------------- tokenizer
/**
 * Splits a script into simple commands: [{ words: [{text, dyn}], redirs: [{op, target}] , raw }]
 * Heredoc bodies are dropped (spec: heredoc = data); `$(…)`/backticks/`<(…)` bodies are returned in `subs`.
 */
export function scan(text) {
  const cmds = []
  const subs = []
  let cur = { words: [], redirs: [], raw: "" }
  let word = null // {text, dyn}
  let pendingRedir = null
  const heredocs = [] // delimiters waiting for their body
  let i = 0
  const n = text.length
  const pushWord = () => {
    if (word === null) return
    if (pendingRedir) {
      cur.redirs.push({ op: pendingRedir, target: word.text, dyn: word.dyn })
      pendingRedir = null
    } else cur.words.push(word)
    word = null
  }
  const endCmd = (pipe = false) => {
    pushWord()
    if (cur.words.length || cur.redirs.length) {
      cur.pipe = pipe
      cmds.push(cur)
    }
    cur = { words: [], redirs: [], raw: "" }
    pendingRedir = null
  }
  const add = (ch, dyn = false) => {
    if (word === null) word = { text: "", dyn: false }
    word.text += ch
    if (dyn) word.dyn = true
  }
  const readSub = (open, close) => {
    // i points just after the opening token; returns inner text, advances i past the closer
    let depth = 1
    let j = i
    let inner = ""
    let q = null
    while (j < n && depth > 0) {
      const c = text[j]
      if (q) {
        if (c === q) q = null
        else if (c === "\\" && q === '"') {
          inner += c
          j++
        }
      } else if (c === "'" || c === '"') q = c
      else if (c === open) depth++
      else if (c === close) {
        depth--
        if (depth === 0) break
      }
      inner += text[j]
      j++
    }
    i = j + 1
    return inner
  }
  while (i < n) {
    const c = text[i]
    if (c === "\n") {
      // heredoc bodies start after the newline of the command that declared them
      i++
      endCmd()
      while (heredocs.length) {
        const d = heredocs.shift()
        for (;;) {
          if (i >= n) break
          let e = text.indexOf("\n", i)
          if (e === -1) e = n
          const line = text.slice(i, e)
          i = Math.min(e + 1, n)
          if ((d.strip ? line.replace(/^\t+/, "") : line) === d.tag) break
        }
      }
      continue
    }
    if (c === " " || c === "\t") {
      pushWord()
      i++
      continue
    }
    if (c === "\\") {
      if (text[i + 1] === "\n") i += 2
      else {
        add(text[i + 1] ?? "")
        i += 2
      }
      continue
    }
    if (c === "#" && word === null) {
      while (i < n && text[i] !== "\n") i++
      continue
    }
    if (c === "'") {
      const e = text.indexOf("'", i + 1)
      const body = e === -1 ? text.slice(i + 1) : text.slice(i + 1, e)
      if (word === null) word = { text: "", dyn: false }
      word.text += body
      word.quoted = true
      i = e === -1 ? n : e + 1
      continue
    }
    if (c === '"') {
      i++
      if (word === null) word = { text: "", dyn: false }
      word.quoted = true
      while (i < n && text[i] !== '"') {
        if (text[i] === "\\" && i + 1 < n) {
          word.text += text[i + 1]
          i += 2
        } else if (text[i] === "$" && text[i + 1] === "(" && text[i + 2] === "(") {
          i += 3
          let depth = 2
          while (i < n && depth > 0) {
            if (text[i] === "(") depth++
            else if (text[i] === ")") depth--
            i++
          }
          word.dyn = true
          word.text += "$((…))"
        } else if (text[i] === "$" && text[i + 1] === "(") {
          i += 2
          subs.push(readSub("(", ")"))
          word.dyn = true
          word.text += "$(…)"
        } else if (text[i] === "`") {
          const e = text.indexOf("`", i + 1)
          subs.push(text.slice(i + 1, e === -1 ? n : e))
          i = e === -1 ? n : e + 1
          word.dyn = true
          word.text += "`…`"
        } else {
          if (text[i] === "$" && /[A-Za-z_{@*#?!0-9]/.test(text[i + 1] ?? "")) word.dyn = true
          word.text += text[i]
          i++
        }
      }
      i++
      continue
    }
    if (c === "$" && text[i + 1] === "(" && text[i + 2] === "(") {
      // arithmetic expansion $(( … )): not a command
      i += 3
      let depth = 2
      while (i < n && depth > 0) {
        if (text[i] === "(") depth++
        else if (text[i] === ")") depth--
        i++
      }
      add("$((…))", true)
      continue
    }
    if (c === "$" && text[i + 1] === "(") {
      i += 2
      subs.push(readSub("(", ")"))
      add("$(…)", true)
      continue
    }
    if (c === "`") {
      const e = text.indexOf("`", i + 1)
      subs.push(text.slice(i + 1, e === -1 ? n : e))
      i = e === -1 ? n : e + 1
      add("`…`", true)
      continue
    }
    if ((c === "<" || c === ">") && text[i + 1] === "(") {
      i += 2
      subs.push(readSub("(", ")"))
      add("/dev/fd/63")
      continue
    }
    if (c === "$" && /[A-Za-z_{@*#?!0-9]/.test(text[i + 1] ?? "")) {
      add(c, true)
      i++
      continue
    }
    if (c === "<" && text[i + 1] === "<" && text[i + 2] === "<") {
      pushWord()
      pendingRedir = "<<<"
      i += 3
      continue
    }
    if (c === "<" && text[i + 1] === "<") {
      // heredoc: <<[-]'TAG' / "TAG" / TAG
      pushWord()
      let j = i + 2
      let strip = false
      if (text[j] === "-") {
        strip = true
        j++
      }
      while (text[j] === " ") j++
      let tag = ""
      let q = null
      if (text[j] === "'" || text[j] === '"') {
        q = text[j]
        j++
      }
      while (j < n && (q ? text[j] !== q : /[\w.-]/.test(text[j]))) {
        tag += text[j]
        j++
      }
      if (q) j++
      heredocs.push({ tag, strip })
      i = j
      continue
    }
    if (c === ">" || c === "<" || (c === "&" && text[i + 1] === ">")) {
      // fd-prefixed redirects: the digits already sit in `word`
      if (word && /^\d+$/.test(word.text)) word = null
      pushWord()
      let op = c
      i++
      if (c === "&" && text[i] === ">") {
        op = "&>"
        i++
      }
      if (text[i] === ">" && c === ">") {
        op = ">>"
        i++
      }
      if (text[i] === "&" && /[\d-]/.test(text[i + 1] ?? "")) {
        // 2>&1 / >&2 — no file
        i += 2
        continue
      }
      if (text[i] === "|") i++
      pendingRedir = op
      continue
    }
    if (c === ";" || c === "|" || c === "&" || c === "\n") {
      const single = c === "|" && text[i + 1] !== "|"
      endCmd(single)
      i++
      if ((c === "&" || c === "|") && text[i] === c) i++
      continue
    }
    if (c === "(" && (word === null || word.text === "")) {
      endCmd()
      i++
      continue
    }
    if (c === ")" && (word === null || word.text === "" || !word.text.includes("("))) {
      endCmd()
      i++
      continue
    }
    if (c === "{" && word === null && /\s/.test(text[i + 1] ?? " ")) {
      endCmd()
      i++
      continue
    }
    if (c === "}" && word === null) {
      endCmd()
      i++
      continue
    }
    add(c)
    i++
  }
  endCmd()
  return { cmds, subs }
}

// ---------------------------------------------------------------- helpers
const HOME_RE = (home) => new RegExp(`^(~|\\$HOME|\\$\\{HOME\\}|${esc(home)})(?=/|$)`)
const KEYWORDS = new Set(["do", "then", "else", "elif", "if", "while", "until", "!", "time", "coproc"])
const FLOW = new Set(["for", "case", "select", "done", "fi", "esac", "in", "function"])
const WRAPPERS = new Set(["timeout", "nohup", "nice", "command", "builtin", "exec", "stdbuf", "caffeinate", "sudo-n"])
const INTERPS = new Set(["bash", "sh", "zsh", "dash", "ksh", "python", "python3", "node", "bun", "deno", "ruby", "perl", "php", "lua", "luajit", "tsx", "ts-node"])
const SCRIPT_EXT = /\.(sh|bash|zsh|py|js|mjs|cjs|ts|mts|rb|pl|lua|php)$/

function maxEff(a, b) {
  if (RANK[b.expected] > RANK[a.expected]) return b
  // a more specific citation wins over the generic "§3" default when both allow
  if (b.expected === "allow" && a.expected === "allow" && a.why === "§3" && b.why !== "§3") return b
  return a
}

export function label(entry, opts = {}) {
  const home = opts.home ?? os.homedir()
  const tmpDirRaw = (opts.tmpDir ?? process.env.TMPDIR ?? "/tmp").replace(/\/+$/, "")
  const tmpDirs = new Set(["/tmp", "/private/tmp", tmpDirRaw, tmpDirRaw.replace(/^\/private/, ""), "/var/folders", "/private/var/folders"])
  const configDir = path.join(home, ".config", "opencode")
  const homeRe = HOME_RE(home)

  // Literal expansion: only ~, $HOME and $TMPDIR (the plugin knows these). Used for TARGETS (context, profile,
  // kubeconfig): a user variable there is "zmienna" => unknown target (§4.1 A2) even if assigned in the same command.
  const expandLit = (p) => {
    let s = p
    s = s.replace(/^\$\{?TMPDIR\}?(?=\/|$)/, tmpDirRaw)
    s = s.replace(homeRe, home)
    return s
  }
  // Full expansion (also variables assigned earlier in the same command): used for PATHS (cd, scripts, redirects).
  const expand = (p, vars) => {
    let s = expandLit(p)
    s = s.replace(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g, (m, name) => (vars.has(name) && !/[$`]/.test(vars.get(name)) ? vars.get(name) : m))
    return expandLit(s)
  }
  const isTmp = (abs) => [...tmpDirs].some((t) => abs === t || abs.startsWith(t + "/"))
  const absOf = (p, cwd, vars) => {
    const e = expand(p, vars)
    if (/\$|`/.test(e)) return undefined
    return path.isAbsolute(e) ? path.normalize(e) : path.resolve(cwd || home, e)
  }

  // ---- path rules (§4.2, §4.4, §4.5) ------------------------------------------------------
  const denyPath = (abs) => (/\/\.ssh\/id_[^/]*$/.test(abs) && !/\.pub$/.test(abs) && abs.startsWith(home)) || abs === path.join(home, ".local/share/opencode/auth.json")
  const secretPath = (abs) => {
    const base = path.basename(abs)
    if (/(^|\/)\.env(\.|$)/.test(abs) && base !== ".env.example") return true
    if (base === ".env" || (/^\.env\./.test(base) && base !== ".env.example")) return true
    if (/(^|\/)secrets(\/|$)/.test(abs)) return true
    if (/\.(pem|key|token)$/.test(base)) return true
    const h = (rel) => abs === path.join(home, rel) || abs.startsWith(path.join(home, rel) + "/")
    return h(".kube/config") || h(".aws/credentials") || h(".config/gcloud") || h(".claude.json") || h(".gemini") || h(".config/anthropic") || h(".cf-turnstile-token")
  }
  const ownConfigPath = (abs) => {
    if (abs.startsWith(configDir + "/")) {
      const rel = abs.slice(configDir.length + 1)
      if (/^opencode\.json[^/]*$/.test(rel) || /^opencode\.[^/]+\.json$/.test(rel)) return true
      if (/^(agents|secrets|plugins)(\/|$)/.test(rel)) return true
      if (rel === "scripts/check-skill-whitelists.sh" || /^permission-model[^/]*\.json$/.test(rel)) return true
    }
    if (/(^|\/)\.opencode(\/|$)/.test(abs)) return true
    return abs === path.join(home, ".zsh") || abs.startsWith(path.join(home, ".zsh") + "/")
  }

  if (entry.tool !== "shell") {
    const p = entry.path ?? ""
    const abs = path.isAbsolute(p) ? path.normalize(p) : path.resolve(entry.cwd || home, expand(p, new Map()))
    if (denyPath(abs)) return { expected: "deny", why: "§4.2" }
    const writing = entry.tool === "edit" || entry.tool === "write"
    if (writing && ownConfigPath(abs)) return { expected: "ask", why: "§4.4" }
    if (secretPath(abs)) return { expected: "ask", why: "§4.5" }
    return { expected: "allow", why: entry.tool === "read" ? "§3 (odczyt)" : "§3 (lokalnie)" }
  }

  const command = String(entry.command ?? "")
  let best = { expected: "allow", why: "§3" }
  const bump = (expected, why, note) => {
    best = maxEff(best, { expected, why, ...(note ? { note } : {}) })
  }

  // Hard denies are judged per command / per argument below — prose such as commit messages is not a command.

  // ---- analyse the command word by word ------------------------------------------------------
  const vars = new Map()
  const lit = new Map() // literal-only values (targets)
  const fnames = new Set()
  const state = { cwd: entry.cwd || home }

  const analyseScript = (script, depth) => {
    if (depth > 4) return bump("ask", "§4.1", "zbyt głębokie zagnieżdżenie")
    const { cmds, subs } = scan(script)
    cmds.forEach((c, i) => {
      c.next = cmds[i + 1]
      analyseCmd(c, depth)
    })
    for (const s of subs) analyseScript(s, depth + 1) // after the main commands: variables / cwd are known by then
  }

  const analyseCmd = (c, depth) => {
    let words = c.words.map((w) => ({ ...w }))
    // redirect targets: own-config / secret writes
    for (const r of c.redirs) {
      if (r.op === ">" || r.op === ">>" || r.op === "&>") {
        const abs = absOf(r.target, state.cwd, vars)
        if (abs && ownConfigPath(abs)) bump("ask", "§4.4", `przekierowanie do ${path.basename(abs)}`)
        else if (abs && denyPath(abs)) bump("deny", "§4.2")
      } else if (r.op === "<" || r.op === "<<<") {
        const abs = absOf(r.target, state.cwd, vars)
        if (abs && r.op === "<" && denyPath(abs)) bump("deny", "§4.2")
        else if (abs && r.op === "<" && secretPath(abs)) bump("ask", "§4.5")
      }
    }
    // leading assignments / keywords / wrappers
    const assigns = []
    for (;;) {
      while (words.length && (KEYWORDS.has(words[0].text) && !words[0].quoted)) words.shift()
      const w = words[0]
      if (!w) break
      const m = w.text.match(/^([A-Za-z_][A-Za-z0-9_]*)\+?=(.*)$/s)
      if (m) {
        assigns.push([m[1], m[2], w.dyn])
        words.shift()
        continue
      }
      break
    }
    for (const [k, v] of assigns) {
      vars.set(k, expand(v, vars))
      lit.set(k, expandLit(v))
    }
    // (#17, decyzja użytkownika 2026-10-24, bramka 1): a literal `export AWS_PROFILE=x` / `AWS_PROFILE=x;` is a resolvable
    // target, not an invisible switch — the later `aws …` command is judged against that profile (see case "aws": lit.get)
    if (!words.length) return
    if (words[0].text === "asp" || words[0].text === "kubectx") bump("ask", "§4.6", "przełączenie kontekstu/profilu (A6)")
    if (words[0].text === "export" || words[0].text === "declare" || words[0].text === "local" || words[0].text === "readonly") {
      for (const w of words.slice(1)) {
        const m = w.text.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s)
        if (m) {
          vars.set(m[1], expand(m[2], vars))
          lit.set(m[1], expandLit(m[2]))
        }
      }
      if (words[1]?.text === "-p") bump("ask", "§4.5", "export -p drukuje całe środowisko")
      return
    }
    if (FLOW.has(words[0].text) && !words[0].quoted) return
    // function definition: name() or name () {
    if (/^[A-Za-z_][\w-]*\(\)$/.test(words[0].text) || (words[1] && words[1].text === "()" && /^[A-Za-z_][\w-]*$/.test(words[0].text))) {
      fnames.add(words[0].text.replace(/\(\)$/, ""))
      const rest = words.slice(words[1]?.text === "()" ? 2 : 1)
      if (rest.length) analyseCmd({ words: rest, redirs: [] }, depth)
      return
    }
    let local = words
    const envAssign = Object.fromEntries(assigns.map(([k, v]) => [k, expandLit(v)]))
    // wrappers
    for (;;) {
      const t = local[0]?.text
      if (t === "env") {
        local = local.slice(1)
        while (local.length && (local[0].text.startsWith("-") || /^[A-Za-z_]\w*=/.test(local[0].text))) {
          const m = local[0].text.match(/^([A-Za-z_]\w*)=(.*)$/s)
          if (m) envAssign[m[1]] = expandLit(m[2])
          if (local[0].text === "-u" || local[0].text === "-C" || local[0].text === "-S") local = local.slice(1)
          local = local.slice(1)
        }
        if (!local.length) {
          // decyzja użytkownika 2026-10-24 (bramka 1, pkt „reszta pytać”): only `env | grep ^NAME…` / `env | grep -i ^NAME…`
          // (a ^-anchored variable-name prefix) is a filter; `env | grep PATTERN` can match values ⇒ ask
          const nw = c.pipe ? (c.next?.words ?? []).map((w) => w.text) : []
          const anchored = /^grep$/.test(path.basename(nw[0] ?? "")) && (nw[1] === "-i" ? /^\^.+/.test(nw[2] ?? "") && nw.length === 3 : /^\^.+/.test(nw[1] ?? "") && nw.length === 2)
          if (!anchored) bump("ask", "§4.5", "env bez filtra zakotwiczonego ^")
          return
        }
        continue
      }
      if (t === "command" && /^-[vV]$/.test(local[1]?.text ?? "")) return // lookup only, nothing runs
      if (WRAPPERS.has(t) || t === "time") {
        local = local.slice(1)
        while (local.length && (local[0].text.startsWith("-") || /^\d+[smhd]?$/.test(local[0].text))) local = local.slice(1)
        continue
      }
      break
    }
    if (!local.length) return
    const cmdWord = local[0]
    const args = local.slice(1)
    const argT = args.map((a) => a.text)
    const base = path.basename(cmdWord.text)

    // dynamic command word
    if (cmdWord.dyn || /^\$/.test(cmdWord.text)) {
      // `$VAR …` / `$TMPDIR/x`: even when resolvable the spec treats a variable command word as unevaluable ($K …)
      bump("ask", "§4.1", "słowo komendy ze zmiennej/podstawienia (Nierozpoznawalne)")
      return
    }
    // (calls of shell functions: the function BODY was analysed where it was defined)
    if (fnames.has(cmdWord.text)) return
    if (cmdWord.text === "alias") return
    if (cmdWord.text === "cd" || cmdWord.text === "pushd") {
      const t = argT.find((a) => !a.startsWith("-"))
      if (t === undefined) state.cwd = home
      else {
        const abs = absOf(t, state.cwd, vars)
        if (abs) state.cwd = abs
      }
      return
    }
    if (cmdWord.text === "eval") return bump("ask", "§4.1", "eval")
    if (cmdWord.text === "source" || cmdWord.text === ".") {
      const abs = absOf(argT[0] ?? "", state.cwd, vars)
      if (abs && isTmp(abs)) bump("ask", "§4.1", "source skryptu z tmp")
      if (abs && denyPath(abs)) bump("deny", "§4.2")
      else if (abs && secretPath(abs)) bump("ask", "§4.5")
      return
    }

    {
      const joined = argT.join(" ")
      if (base === "gcloud" && /\bprint-(access|identity)-token\b/.test(joined)) bump("deny", "§4.2")
      if (base === "aws" && (/\b(get-secret-value|get-session-token)\b/.test(joined) || /\becr\s+get-login-password\b/.test(joined))) bump("deny", "§4.2")
      if (base === "ant" && /\bauth\s+print-credentials\b/.test(joined)) bump("deny", "§4.2")
    }
    const absCmd = absOf(cmdWord.text, state.cwd, vars)
    // direct execution of something in tmp
    if (cmdWord.text.includes("/") && absCmd && isTmp(absCmd) && !INTERPS.has(base)) {
      bump("ask", "§4.1", "uruchomienie pliku z tmp")
      return
    }
    // relative executable with tmp cwd
    if (cmdWord.text.startsWith("./") && absCmd && isTmp(absCmd)) {
      bump("ask", "§4.1", "uruchomienie pliku z tmp")
      return
    }

    // paths in arguments: §4.2 deny / §4.5 secrets (best-effort A7) and §4.4 for commands that WRITE them
    const progLike = /^(grep|egrep|fgrep|rg|sed|awk|gawk|jq|yq|ack|perl)$/.test(base)
    const nonFlag = args.filter((a) => !a.text.startsWith("-"))
    let patternSkipped = !progLike
    const writeTargets = new Set()
    if (/^(mv|rm|tee|touch|chmod|chown|mkdir|rmdir|truncate|unlink)$/.test(base)) nonFlag.forEach((a) => writeTargets.add(a))
    else if (/^(cp|install|ln)$/.test(base) && nonFlag.length) writeTargets.add(nonFlag[nonFlag.length - 1])
    else if (base === "sed" && argT.some((x) => /^-[a-zA-Z]*i/.test(x))) nonFlag.slice(1).forEach((a) => writeTargets.add(a))
    else if (base === "perl" && argT.some((x) => /^-[a-zA-Z]*i/.test(x))) nonFlag.slice(1).forEach((a) => writeTargets.add(a))
    else if (base === "git" && /^(mv|rm)$/.test(argT.find((x) => !x.startsWith("-")) ?? "")) nonFlag.slice(1).forEach((a) => writeTargets.add(a))
    if (!(base === "gh" || base === "curl" || base === "wget")) {
      for (const a of nonFlag) {
        if (!patternSkipped) {
          patternSkipped = true // first operand of grep/sed/awk/jq is a pattern / program, not a path
          continue
        }
        if (a.dyn && /\$\(|`/.test(a.text)) continue
        if (/\s/.test(a.text) || a.text.includes("://") || !/[/~.]/.test(a.text)) continue
        if (/^\.[A-Za-z]+$/.test(a.text) && !/^\.env/.test(a.text)) continue // jq-style `.key`
        const abs = absOf(a.text, state.cwd, vars)
        if (!abs) continue
        if (denyPath(abs)) bump("deny", "§4.2", "ścieżka w argumencie")
        else if (secretPath(abs)) bump("ask", "§4.5", "ścieżka w argumencie")
        if (writeTargets.has(a) && ownConfigPath(abs)) bump("ask", "§4.4", "zapis do własnej konfiguracji")
      }
    }

    const verbOf = (list, valueFlags) => {
      for (let i = 0; i < list.length; i++) {
        const t = list[i]
        if (t.startsWith("-")) {
          if (!t.includes("=") && valueFlags.has(t)) i++
          continue
        }
        return { verb: t, idx: i }
      }
      return { verb: undefined, idx: -1 }
    }
    const flagVal = (names) => {
      for (let i = 0; i < args.length; i++) {
        for (const nme of names) {
          if (args[i].text === nme && args[i + 1]) return args[i + 1]
          if (args[i].text.startsWith(nme + "=")) return { text: args[i].text.slice(nme.length + 1), dyn: args[i].dyn }
        }
      }
      return undefined
    }
    // ---- interpreters: scripts in tmp ----------------------------------------------------
    if (INTERPS.has(base)) {
      if (["bash", "sh", "zsh", "dash", "ksh"].includes(base)) {
        const ci = argT.findIndex((a) => /^-[a-zA-Z]*c$/.test(a))
        if (ci !== -1 && args[ci + 1]) {
          analyseScript(args[ci + 1].text, depth + 1)
          return
        }
      }
      if (["node", "bun", "deno"].includes(base) && argT.some((a) => a === "-e" || a === "--eval" || a === "-p")) return // inline code is data
      if (["python3", "python"].includes(base) && argT[0] === "-m") return
      const scriptArg = args.find((a) => !a.text.startsWith("-") && (SCRIPT_EXT.test(a.text) || ["bash", "sh", "zsh", "dash", "ksh"].includes(base)))
      if (scriptArg && scriptArg.text !== "-") {
        const abs = absOf(scriptArg.text, state.cwd, vars)
        if (abs === undefined) bump("ask", "§4.1", "skrypt o nieznanej ścieżce (zmienna)")
        else if (isTmp(abs)) bump("ask", "§4.1", "skrypt z tmp")
        else if (denyPath(abs)) bump("deny", "§4.2")
        else if (secretPath(abs)) bump("ask", "§4.5")
      }
      return
    }

    // ---- local risky commands (§3 'Lokalnie') -----------------------------------------------
    switch (base) {
      case "sudo":
        return bump("ask", "§3")
      case "brew": {
        // decyzja użytkownika 2026-10-24 (bramka 1, pkt 3): brew tap/untap/services ask like install/uninstall/upgrade;
        // `brew info|list|search|…` are reads ⇒ allow
        const v = argT.find((a) => !a.startsWith("-"))
        if (["install", "uninstall", "upgrade", "reinstall", "remove", "tap", "untap", "services"].includes(v)) bump("ask", "§3", "brew: zmiana stanu systemu (decyzja 2026-10-24, pkt 3)")
        return
      }
      case "pip":
      case "pip3": {
        // decyzja użytkownika 2026-10-24 (bramka 1, pkt 3): `pip install` keeps asking
        if (argT.find((a) => !a.startsWith("-")) === "install") bump("ask", "§3", "pip install (decyzja 2026-10-24, pkt 3)")
        return
      }
      case "softwareupdate":
      case "tmutil":
      case "osascript":
        return bump("ask", "§3")
      case "defaults":
        if (argT[0] === "write" || argT.includes("write")) bump("ask", "§3")
        return
      case "launchctl":
        if (!["list", "print"].includes(argT[0])) bump("ask", "§3")
        return
      case "kill":
      case "pkill":
      case "killall": {
        const targets = argT.filter((a) => !a.startsWith("-"))
        if (base === "kill" && targets.length && targets.every((t) => t === "$!" || /^%\d+$/.test(t))) return
        return bump("ask", "§3")
      }
      case "ssh":
      case "scp":
      case "sftp":
        if (argT.includes("-V")) return
        if (entry.agent === "ha" && /\besp\.iot\b/.test(argT.join(" "))) return
        return bump("ask", "§3")
      case "rsync":
        // decyzja użytkownika 2026-10-24 (bramka 1, pkt 3): every rsync asks, local→local included
        return bump("ask", "§3", "rsync (decyzja 2026-10-24, pkt 3)")
      case "hs":
        if (argT.includes("-c")) bump("ask", "§3")
        return
      case "diskutil":
        if (!["list", "info"].includes(argT[0])) bump("ask", "§3")
        return
      case "security":
        return bump("deny", "§4.2")
      case "printenv": {
        const nxt = c.pipe ? path.basename(c.next?.words?.[0]?.text ?? "") : ""
        if (argT.length === 0 && !/^(grep|egrep|rg|fgrep)$/.test(nxt)) bump("ask", "§4.5", "printenv bez filtra")
        return
      }
      case "xargs": {
        const rest = args.filter((a) => !a.text.startsWith("-"))
        const t = rest[0]?.text
        if (t && /^(kubectl|helm|flux|talosctl|gh|aws|wrangler|jk|cf|ant|crane|git)$/.test(path.basename(t))) bump("ask", "§4.1", "xargs + znane zewnętrzne CLI")
        // decyzja użytkownika 2026-10-24 (bramka 1, pkt 3): rsync always asks, also when run through xargs
        if (t && path.basename(t) === "rsync") bump("ask", "§3", "xargs rsync (decyzja 2026-10-24, pkt 3)")
        return
      }
      default:
    }

    // ---- known external CLIs (§4.1) ---------------------------------------------------------
    if (argT.includes("--help")) return // help output only
    const ctxWord = flagVal(["--context", "--kube-context"])
    const kcWord = flagVal(["--kubeconfig"])
    const kcEnv = envAssign.KUBECONFIG ?? lit.get("KUBECONFIG")
    const protectedNs = (list) => list.some((t, i) => ((t === "-n" || t === "--namespace") && /^(flux-system|kube-system)$/.test(list[i + 1] ?? "")) || /^--namespace=(flux-system|kube-system)$/.test(t) || /^-n(flux-system|kube-system)$/.test(t) || t === "-A" || t === "--all-namespaces")
    const secretGet = (list) => {
      // `kubectl get secret(s)[/name] … -o <anything but name>` (§4.5)
      const verbI = list.indexOf("get")
      if (verbI === -1) return false
      const after = list.slice(verbI + 1)
      const res = after.find((a) => !a.startsWith("-"))
      if (!res || !res.split(",").some((r) => /^secrets?(\.v1)?(\/|$)/.test(r))) return false
      const oi = after.findIndex((a) => a === "-o" || a === "--output" || /^-o./.test(a) || a.startsWith("--output="))
      if (oi === -1) return false
      const val = after[oi] === "-o" || after[oi] === "--output" ? after[oi + 1] : after[oi].replace(/^-o|^--output=/, "")
      return (val ?? "").split("=")[0] !== "name"
    }
    const kubeTarget = () => {
      if (ctxWord) {
        const v = expandLit(ctxWord.text)
        if (/[$`]/.test(v)) return { cls: "unknown", name: v, dynamic: true }
        return { cls: targetClass(v), name: v }
      }
      const kc = kcWord ? expandLit(kcWord.text) : kcEnv
      if (kc !== undefined) {
        // a kubeconfig whose literal prefix is inside tmp is a tmp kubeconfig, even with a variable suffix
        if (/[$`]/.test(kc)) return [...tmpDirs].some((t) => kc.startsWith(t + "/")) ? { cls: "dev", name: kc } : { cls: "unknown", name: kc, dynamic: true }
        const abs = path.isAbsolute(kc) ? kc : path.resolve(state.cwd, kc)
        return isTmp(abs) ? { cls: "dev", name: kc } : { cls: "unknown", name: kc }
      }
      return { cls: "home", name: "admin@k8s", source: "current-context" }
    }
    const writeDecision = (tool, verb, target, irreversible, homeAllowed) => {
      if (target.dynamic && !irreversible) return bump("ask", "§4.1", `${tool} ${verb}: cel ze zmiennej`)
      if (irreversible) {
        if (target.cls === "dev" && !irreversible.protected) return bump("allow", "§3")
        return bump("ask", "§4.3", `${tool} ${verb} @ ${target.name}`)
      }
      if (target.cls === "dev") return bump("allow", "§3")
      if (target.cls === "home") return homeAllowed ? bump("allow", "§3.1") : bump("ask", "§3.1", `${tool} ${verb} nie jest na liście §3.1`)
      return bump("ask", "§3", `${tool} ${verb} @ ${target.cls} (${target.name})`)
    }

    switch (base) {
      case "kubectl": {
        const flagsWithVal = new Set(["--context", "-n", "--namespace", "--kubeconfig", "-o", "--output", "-l", "--selector", "-f", "--filename", "-c", "--container", "--request-timeout", "--field-selector", "-p", "--patch", "--type", "-k", "--cluster", "--user", "--as", "--timeout", "--sort-by", "-L", "--for", "--template", "--raw", "--grace-period", "-t"])
        const { verb, idx } = verbOf(argT, flagsWithVal)
        const target = kubeTarget()
        if (!verb) return
        const rest = argT.slice(idx + 1)
        if (/[$`]/.test(verb) || args[idx]?.dyn) return bump("ask", "§4.1", "czasownik kubectl ze zmiennej")
        if (secretGet(argT)) bump("ask", "§4.5", "kubectl get secret -o …")
        if (verb === "config") {
          const sub = rest.find((a) => !a.startsWith("-"))
          if (["use-context", "set-context", "set-cluster", "set-credentials", "delete-context", "set", "unset", "rename-context"].includes(sub)) return bump("ask", "§4.1", "zmiana kontekstu w tej samej komendzie (A6)")
          return
        }
        if (["get", "describe", "logs", "top", "events", "explain", "api-resources", "api-versions", "version", "cluster-info", "diff", "wait", "kustomize", "port-forward", "completion", "help", "options", "plugin"].includes(verb)) return
        if (verb === "auth" && rest[0] === "can-i") return
        if (verb === "rollout" && ["status", "history"].includes(rest[0])) return
        if (verb === "create" && rest.some((a) => /^--dry-run(=(client|server))?$/.test(a)) && !target.dynamic) {
          // client dry-run is local
          if (rest.some((a) => a === "--dry-run=client" || a === "--dry-run")) return
        }
        if (verb === "apply" && rest.some((a) => a === "--dry-run=client")) return
        if (verb === "delete") {
          const resI = args.slice(idx + 1).findIndex((a) => !a.text.startsWith("-"))
          if (resI !== -1 && args[idx + 1 + resI].dyn) return bump("ask", "§4.1", "kubectl delete $KIND $NS: czasownik/zasób ze zmiennej (Nierozpoznawalne)")
          const res = rest.find((a) => !a.startsWith("-"))
          const irr = /^(namespaces?|ns|pvs?|persistentvolumes?|pvc|persistentvolumeclaims?|crds?|customresourcedefinitions?)(\/|,|$)/.test(res ?? "") || rest.some((a) => a === "--all" || a === "-f" || a === "-k" || a === "--filename" || a === "--kustomize")
          const prot = protectedNs(argT)
          if (irr || prot) return writeDecision("kubectl", verb, target, { protected: prot }, false)
          return writeDecision("kubectl", verb, target, false, false)
        }
        if (["drain", "cordon", "taint"].includes(verb)) return writeDecision("kubectl", verb, target, { protected: false }, false)
        // `create`, `cp`: decyzja użytkownika 2026-10-24 (bramka 1, pkt 2) — allowed on home (spec §3.1 table); `port-forward` is
        // handled above as a read verb (same decision: allowed everywhere it is a read, on home it is also listed in §3.1)
        return writeDecision("kubectl", verb, target, false, ["apply", "exec", "rollout", "scale", "patch", "label", "annotate", "create", "cp"].includes(verb))
      }
      case "helm": {
        const flagsWithVal = new Set(["--kube-context", "--kubeconfig", "-n", "--namespace", "-f", "--values", "--set", "--set-string", "--version", "--timeout", "-d", "--destination", "--repo"])
        const { verb, idx } = verbOf(argT, flagsWithVal)
        if (!verb) return
        const rest = argT.slice(idx + 1)
        const kctx = flagVal(["--kube-context"])
        const target = (() => {
          if (kctx) {
            const v = expandLit(kctx.text)
            return /[$`]/.test(v) ? { cls: "unknown", name: v, dynamic: true } : { cls: targetClass(v), name: v }
          }
          const kc = kcWord ? expandLit(kcWord.text) : kcEnv
          if (kc !== undefined) {
            if (/[$`]/.test(kc)) return { cls: "unknown", name: kc, dynamic: true }
            const abs = path.isAbsolute(kc) ? kc : path.resolve(state.cwd, kc)
            return isTmp(abs) ? { cls: "dev", name: kc } : { cls: "unknown", name: kc }
          }
          return { cls: "home", name: "admin@k8s" }
        })()
        if (["list", "ls", "status", "history", "get", "template", "show", "search", "lint", "version", "env", "package", "pull", "create", "completion", "help", "verify", "plugin"].includes(verb)) return
        if (verb === "dependency" || verb === "dep") return
        if (verb === "repo" && ["list"].includes(rest[0])) return
        // decyzja użytkownika 2026-10-24 (bramka 1, pkt 2): `helm repo add|update` allowed on home (spec §3.1 table); they only touch the local repo cache
        if (verb === "repo" && ["add", "update", "remove"].includes(rest[0])) return
        if (verb === "registry" || verb === "push") return writeDecision("helm", verb, { cls: "prod", name: "registry" }, false, false)
        if (["uninstall", "delete", "del", "un"].includes(verb)) return writeDecision("helm", verb, target, { protected: protectedNs(argT) }, false)
        return writeDecision("helm", verb, target, false, ["upgrade", "install", "rollback"].includes(verb))
      }
      case "flux": {
        const flagsWithVal = new Set(["--context", "-n", "--namespace", "--kubeconfig", "--timeout", "--interval", "--source", "--path", "--url", "--branch", "--export", "-s"])
        const { verb, idx } = verbOf(argT, flagsWithVal)
        if (!verb) return
        const target = kubeTarget()
        if (["get", "logs", "trace", "stats", "version", "export", "events", "check", "tree", "diff", "help", "completion", "build", "push"].includes(verb) && verb !== "push") return
        if (["uninstall", "delete"].includes(verb)) return writeDecision("flux", verb, target, { protected: true }, false)
        return writeDecision("flux", verb, target, false, ["reconcile", "suspend", "resume"].includes(verb))
      }
      case "talosctl": {
        const flagsWithVal = new Set(["-n", "--nodes", "-e", "--endpoints", "--talosconfig", "--context", "-o", "--output", "-d", "--depth", "--with-secrets", "--install-disk", "--install-image", "--kubernetes-version", "--additional-sans", "--output-types", "-p", "--patch", "-t", "--tail", "-f", "--follow", "--namespace", "--config-patch", "--config-patch-control-plane", "--config-patch-worker"])
        const { verb, idx } = verbOf(argT, flagsWithVal)
        if (!verb) return
        const rest = argT.slice(idx + 1)
        const readList = ["usage", "mounts", "disks", "list", "ls", "logs", "dmesg", "services", "service", "containers", "processes", "ps", "stats", "memory", "netstat", "events", "time", "version", "health", "get", "config", "etcd", "cgroups", "inspect", "read", "cat", "copy", "dashboard", "image"]
        if (verb === "get") {
          const res = rest.find((a) => !a.startsWith("-"))
          if (res && /secret|^osroot|machineconfig/i.test(res)) bump("ask", "§4.5", "talosctl get secret|osroot|machineconfig")
          return
        }
        // decyzja użytkownika 2026-10-24 (bramka 1, pkt 4): verbs that only work on local files / print defaults are reads (no
        // cluster mutation) — `gen config`, `machineconfig patch`, `validate`, `image default|list`. `gen secrets` creates secret
        // material and keeps asking (reszta pytać).
        if (verb === "gen") return rest[0] === "config" ? undefined : bump("ask", "§4.1", `talosctl gen ${rest[0] ?? ""}: poza listą odczytu`)
        if (verb === "machineconfig") return rest[0] === "patch" ? undefined : bump("ask", "§4.1", `talosctl machineconfig ${rest[0] ?? ""}: poza listą odczytu`)
        if (verb === "validate") return
        if (verb === "image") return ["default", "list"].includes(rest[0]) ? undefined : bump("ask", "§4.1", `talosctl image ${rest[0] ?? ""}: poza listą odczytu`)
        if (verb === "etcd") {
          if (["snapshot", "remove-member", "leave"].includes(rest[0])) return bump("ask", "§4.3")
          return
        }
        if (verb === "config") {
          if (["info", "contexts", "context"].includes(rest[0])) return
          return bump("ask", "§4.1", "talosctl config: czasownik spoza listy odczytu")
        }
        if (["reset", "upgrade", "upgrade-k8s", "apply-config", "patch", "edit", "bootstrap", "reboot", "shutdown", "wipe", "leave"].includes(verb)) return bump("ask", "§4.3")
        if (readList.includes(verb) && verb !== "image") return
        return bump("ask", "§4.1", `talosctl ${verb}: czasownik spoza listy odczytu (zapis wg zasady „reszta”)`)
      }
      case "gh": {
        const { verb, idx } = verbOf(argT, new Set(["--repo", "-R", "--jq", "-q", "--json", "-t", "--template", "--limit", "-L", "--branch", "-b", "--workflow", "-w", "--title", "--body", "--base", "--head", "-F", "-f", "--field", "--raw-field", "--input", "-X", "--method", "-H", "--header", "--body-file", "-p", "--pattern", "-O", "--output", "-s", "--state", "--label", "--paginate"]))
        if (!verb) return
        const rest = argT.slice(idx + 1)
        const sub = rest.find((a) => !a.startsWith("-"))
        if (verb === "api") {
          const hasWrite = argT.some((a, i) => a === "-X" || a === "--method" || a === "-f" || a === "-F" || a === "--field" || a === "--raw-field" || a === "--input" || /^--(method|field|raw-field|input)=/.test(a)) && !argT.some((a, i) => (a === "-X" || a === "--method") && /^GET$/i.test(argT[i + 1] ?? ""))
          return hasWrite ? bump("ask", "§3", "gh api z metodą zapisu") : undefined
        }
        if (verb === "repo" && ["delete", "archive", "edit", "deploy-key"].includes(sub)) return bump("ask", "§4.3")
        if (verb === "secret" || verb === "ssh-key" && sub !== "list") return verb === "secret" ? bump("ask", "§4.3") : bump("ask", "§3", "gh ssh-key: poza listą odczytu")
        if (verb === "release" && sub === "delete") return bump("ask", "§4.3")
        const readPairs = { pr: ["view", "list", "diff", "checks", "status"], run: ["view", "list", "watch", "download"], workflow: ["view", "list"], issue: ["view", "list"], repo: ["view", "list"], release: ["view", "list", "download"], // decyzja użytkownika 2026-10-24 (bramka 1, pkt 4): `run|release download` writes local files only
          auth: ["status"], ssh: [], "ssh-key": ["list"] }
        if (verb === "search" || verb === "status" || verb === "browse") return
        if (readPairs[verb]?.includes(sub)) return
        if (verb === "pr") return bump("allow", "§3.1")
        if (verb === "issue" && ["create", "comment", "edit"].includes(sub)) return bump("allow", "§3.1")
        return bump("ask", "§3", `gh ${verb} ${sub ?? ""}: poza listą odczytu i §3.1`)
      }
      case "git": {
        const flagsWithVal = new Set(["-C", "-c", "--git-dir", "--work-tree"])
        const { verb, idx } = verbOf(argT, flagsWithVal)
        if (!verb) return
        const rest = argT.slice(idx + 1)
        if (verb === "push") {
          const flags = rest.filter((a) => a.startsWith("-"))
          const refs = rest.filter((a) => !a.startsWith("-")).slice(1) // after the remote
          const force = flags.some((a) => a === "--force" || a === "-f" || a === "--mirror" || a.startsWith("--force") || /^-[a-z]*f[a-z]*$/.test(a))
          const del = flags.some((a) => a === "--delete" || a === "-d" || /^-[a-z]*d[a-z]*$/.test(a))
          const testRef = (r) => /^(:)?(refs\/tags\/)?test-/.test(r) && (del || r.startsWith(":refs/tags/test-"))
          const badRefs = refs.filter((r) => r.startsWith("+") || r.startsWith(":") || del).filter((r) => !testRef(r))
          if (force || badRefs.length) return bump("ask", "§4.3", "git push siłowy/usuwający")
          return bump("allow", "§3.1")
        }
        return
      }
      case "aws": {
        const { verb, idx } = verbOf(argT, new Set(["--profile", "--region", "--output", "--query", "--endpoint-url", "--filters", "--max-items"]))
        if (!verb) return
        const valueFlags = new Set(["--profile", "--region", "--output", "--query", "--endpoint-url", "--exclude", "--include", "--storage-class", "--acl", "--filters", "--max-items"])
        const rest = argT.slice(idx + 1).filter((a, i, arr) => !(i > 0 && valueFlags.has(arr[i - 1])))
        const op = rest.find((a) => !a.startsWith("-"))
        const prof = expandLit(flagVal(["--profile"])?.text ?? envAssign.AWS_PROFILE ?? lit.get("AWS_PROFILE") ?? "default")
        const tcls = /[$`]/.test(prof) ? "unknown" : targetClass(prof)
        if (verb === "s3") {
          if (op === "ls") return
          if (op === "cp" || op === "sync" || op === "mv") {
            const ops = rest.filter((a) => !a.startsWith("-"))
            const dst = ops[ops.length - 1] ?? ""
            const toRemote = /^s3:\/\//.test(dst)
            if (!toRemote) return
            if (op === "sync" && rest.some((a) => a === "--delete")) return bump("ask", "§4.3")
            return tcls === "dev" ? bump("allow", "§3") : bump("ask", "§3", `aws s3 ${op} → s3 @ ${prof}`)
          }
          if (["rm", "rb"].includes(op)) return bump("ask", "§4.3")
          return bump("ask", "§3", `aws s3 ${op}`)
        }
        if (verb === "configure") return rest[0] === "list" || rest[0] === "get" ? undefined : bump("ask", "§3")
        if (verb === "sts" && op === "get-caller-identity") return
        if (/^(describe|list|get|head|search|lookup|filter|select)-/.test(op ?? "") || ["scan", "query"].includes(op)) return
        if (/^(delete|terminate|deregister|disable)-/.test(op ?? "") || ["put-bucket-policy"].includes(op) || (verb === "iam" && /^(attach|put)-|^create-access-key$/.test(op ?? "")) || (verb === "ec2" && /^(authorize-security-group|revoke)/.test(op ?? "")) || (verb === "rds" && ["modify-db-instance", "delete-db-instance"].includes(op)) || (verb === "cloudformation" && op === "delete-stack")) return bump("ask", "§4.3")
        return tcls === "dev" ? bump("allow", "§3") : bump("ask", "§3", `aws ${verb} ${op} @ ${prof}`)
      }
      case "wrangler":
      case "cf":
      case "jk":
      case "ant": {
        const verb = argT.find((a) => !a.startsWith("-"))
        const reads = { wrangler: ["whoami", "tail", "dev", "versions", "deployments", "kv", "d1", "r2", "secret", "types", "login", "docs"], cf: ["whoami", "list", "get", "status"], jk: ["--version", "version", "auth", "context", "search", "job", "run", "log", "artifact", "test", "cred", "node", "queue", "plugin"], ant: ["auth", "help", "--version"] }
        const sub2 = argT.filter((a) => !a.startsWith("-"))[1]
        const isRead = (() => {
          if (!verb) return true
          if (base === "wrangler") {
            if (["whoami", "tail", "dev", "types", "docs"].includes(verb)) return true
            if (["versions", "deployments"].includes(verb)) return sub2 === "list"
            if (["kv", "d1", "r2", "secret"].includes(verb)) return /^(list|get)$|key|bucket/.test(sub2 ?? "") && !/delete|put/.test(argT.join(" "))
            return false
          }
          if (base === "jk") {
            if (["--version", "version", "search", "log"].includes(verb)) return true
            return ["ls", "view", "config", "params", "status", "report", "list"].includes(sub2)
          }
          if (base === "cf") return reads.cf.includes(verb)
          return (verb === "auth" && sub2 === "status") || verb === "help"
        })()
        if (isRead) return
        const joinedArgs = argT.join(" ")
        const irr = (base === "wrangler" && /^(delete|rollback)$/.test(verb ?? "")) || (base === "wrangler" && /secret delete/.test(joinedArgs)) || (base === "cf" && /\bdelete/.test(joinedArgs)) || (base === "jk" && (/^job (delete|configure)/.test(joinedArgs.replace(/^-\S+\s+/, "")) || verb === "cred" || /\bnode rm\b/.test(joinedArgs) || verb === "plugin"))
        return bump("ask", irr ? "§4.3" : "§3", `${base} ${verb}: zapis na zewnątrz (zawsze prod)`)
      }
      case "crane": {
        const verb = argT.find((a) => !a.startsWith("-"))
        if (["ls", "digest", "manifest", "config", "export", "validate", "version", "catalog"].includes(verb)) return
        if (verb === "delete") return bump("ask", "§4.3")
        return bump("ask", "§3", `crane ${verb}`)
      }
      case "docker":
      case "podman": {
        const verb = argT.find((a) => !a.startsWith("-"))
        if (verb === "push" || (verb === "manifest" && argT.includes("push"))) return bump("ask", "§3", "push do rejestru")
        return
      }
      case "curl":
      case "wget":
      case "http":
      case "https":
      case "xh": {
        const urls = args.filter((a) => /^https?:\/\//.test(a.text) || /^[\w.-]+\.[a-z]{2,}(\/|$)/.test(a.text))
        const external = urls.some((u) => !/^(https?:\/\/)?(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:|\/|$)/.test(u.text))
        const writes = argT.some((a, i) => /^(-d|--data.*|--json|-F|--form.*|-T|--upload-file|--post-data|--post-file)$/.test(a) || ((a === "-X" || a === "--request") && !/^(GET|HEAD)$/i.test(argT[i + 1] ?? "")) || /^-X(?!GET$|HEAD$)/.test(a) || /^--request=(?!GET$|HEAD$)/i.test(a) || /^-[a-zA-Z]*d$/.test(a))
        if (base === "wget" && argT.some((a) => /^--(method)/.test(a))) return bump("ask", "§3")
        if (external && writes) return bump("ask", "§3", `${base} z metodą zapisu`)
        if (!external && urls.length === 0 && writes && args.some((a) => a.dyn)) return bump("ask", "§4.1", "curl zapis, cel ze zmiennej")
        return
      }
      case "xargs":
      default:
    }

    // ---- unknown CLI with an external target in its flags (§4.1) ---------------------------------
    if (ctxWord || kcWord || flagVal(["--profile"])) {
      const verb = argT.find((a) => !a.startsWith("-"))
      if (/^(get|describe|list|ls|show|status|logs|view|watch|history|diff|explain|top|events|search|version)$/.test(verb ?? "")) return
      const t = ctxWord ? targetClass(expandLit(ctxWord.text)) : kcWord ? (isTmp(absOf(kcWord.text, state.cwd, new Map()) ?? "") ? "dev" : "unknown") : targetClass(expandLit(flagVal(["--profile"]).text))
      if (t === "dev") return
      if (base === "kind") return
      return bump("ask", "§4.1", `${base}: nieznane CLI z celem zewnętrznym (${t})`)
    }
  }

  analyseScript(command, 0)

  return best
}
