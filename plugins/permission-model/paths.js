import fs from "node:fs"
import path from "node:path"

// Path classification for the read/edit/write tools (spec §4.2, §4.4, §4.5).

const CASE_INSENSITIVE = process.platform === "darwin" || process.platform === "win32"

function expandHome(p, home) {
  if (!home) return p
  if (p === "~" || p.startsWith("~/")) return home + p.slice(1)
  if (p === "$HOME" || p.startsWith("$HOME/")) return home + p.slice(5)
  if (p === "${HOME}" || p.startsWith("${HOME}/")) return home + p.slice(7)
  return p
}

function realpathOfAncestor(abs) {
  let head = abs
  const tail = []
  for (;;) {
    try {
      const real = fs.realpathSync(head)
      return tail.length ? path.join(real, ...tail.reverse()) : real
    } catch {
      const parent = path.dirname(head)
      if (parent === head) return abs
      tail.push(path.basename(head))
      head = parent
    }
  }
}

/**
 * Absolute, normalized path: expands `~`/`$HOME`/`${HOME}`, resolves relative to `base`,
 * then realpath()s the nearest existing ancestor (so /tmp -> /private/tmp). Never throws.
 */
export function canonical(p, base, home) {
  try {
    const expanded = expandHome(String(p ?? ""), home)
    const abs = path.resolve(base || process.cwd(), expanded)
    return realpathOfAncestor(abs)
  } catch {
    try {
      return path.resolve(String(p ?? ""))
    } catch {
      return String(p ?? "")
    }
  }
}

function escapeRe(s) {
  return s.replace(/[.+^${}()|[\]\\]/g, "\\$&")
}

function globToRegExp(pattern) {
  let re = ""
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        i++
        if (pattern[i + 1] === "/") {
          i++
          re += "(?:.*/)?" // `**/` = zero or more directories
        } else {
          re += ".*"
        }
      } else {
        re += ".*" // v2 wildcard: anything, including `/`
      }
    } else if (c === "?") {
      re += "."
    } else {
      re += escapeRe(c)
    }
  }
  return new RegExp(`^${re}$`, CASE_INSENSITIVE ? "is" : "s")
}

/** Glob match of an absolute path. `~` in the pattern is the home dir (raw and realpath'd). */
export function globMatch(pattern, abs, home) {
  const candidates = [pattern]
  if (home && (pattern === "~" || pattern.startsWith("~/"))) {
    const rawHome = home
    const realHome = canonical(home, "/", undefined)
    candidates.length = 0
    candidates.push(rawHome + pattern.slice(1))
    if (realHome !== rawHome) candidates.push(realHome + pattern.slice(1))
  }
  return candidates.some((c) => globToRegExp(c).test(abs))
}

function anyMatch(patterns, abs, home) {
  return Array.isArray(patterns) && patterns.some((p) => globMatch(p, abs, home))
}

function isSecretDeny(abs, cfg, home) {
  const s = cfg.secretDeny ?? {}
  return anyMatch(s.paths, abs, home) && !anyMatch(s.pathAllow, abs, home)
}

function isSecretAsk(abs, cfg, home) {
  const s = cfg.secretAsk ?? {}
  return anyMatch(s.paths, abs, home) && !anyMatch(s.pathAllow, abs, home)
}

function isOwnConfig(abs, cfg, home) {
  return anyMatch(cfg.ownConfig, abs, home)
}

/** -> "secret-deny" | "secret-ask" | "own-config" | null (priority in that order). */
export function pathClass(abs, cfg, { home, sessionDir } = {}) {
  const a = canonical(abs, sessionDir, home)
  if (isSecretDeny(a, cfg, home)) return "secret-deny"
  if (isSecretAsk(a, cfg, home)) return "secret-ask"
  if (isOwnConfig(a, cfg, home)) return "own-config"
  return null
}

const PREFIX = "permission-model: "

/**
 * action: "read" | "edit" | "write". -> { effect: "allow"|"ask"|"deny", cls, message }
 * effect "allow" means "do not interfere".
 */
export function decidePathAction(action, resource, cfg, ctx = {}) {
  const { home, sessionDir } = ctx
  const abs = canonical(resource, sessionDir, home)
  if (isSecretDeny(abs, cfg, home)) {
    return { effect: "deny", cls: "secret-deny", message: `${PREFIX}twardy zakaz — dane wrażliwe: ${abs}` }
  }
  const writing = action === "edit" || action === "write"
  if (writing && isOwnConfig(abs, cfg, home)) {
    return { effect: "ask", cls: "own-config", message: `${PREFIX}zapis własnej konfiguracji: ${abs}` }
  }
  if (isSecretAsk(abs, cfg, home)) {
    return { effect: "ask", cls: "secret-ask", message: `${PREFIX}dane wrażliwe: ${abs}` }
  }
  return { effect: "allow", cls: null, message: "" }
}
