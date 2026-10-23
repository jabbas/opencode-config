// Wildcard matching with OpenCode v2 semantics (spec §3/§4):
//   `*` -> `.*` (spans spaces and `/`), `?` -> `.`, regex flag `s`.
//   A pattern WITHOUT `*` must match the whole text exactly.
//   A trailing ` *` is optional: "kubectl get *" matches "kubectl get" and "kubectl get pods".
// Extension: a MIDDLE ` * ` may also collapse to a single space, so "kubectl * get *secret*"
// matches "kubectl get secret s" (no flags between the tool and the verb).

const cache = new Map()

function escapeRe(c) {
  return /[.+^${}()|[\]\\]/.test(c) ? "\\" + c : c
}

export function wildcardToRegExp(pattern) {
  let p = String(pattern)
  let tail = ""
  if (p.length > 2 && p.endsWith(" *")) {
    p = p.slice(0, -2)
    tail = "(?: .*)?"
  }
  let re = ""
  for (let i = 0; i < p.length; i++) {
    const c = p[i]
    if (c === " " && p[i + 1] === "*" && p[i + 2] === " ") {
      re += "(?: .* | )"
      i += 2
    } else if (c === "*") {
      re += ".*"
    } else if (c === "?") {
      re += "."
    } else {
      re += escapeRe(c)
    }
  }
  return new RegExp(`^${re}${tail}$`, "s")
}

function compiled(pattern) {
  let re = cache.get(pattern)
  if (!re) {
    re = wildcardToRegExp(pattern)
    cache.set(pattern, re)
  }
  return re
}

/** True when `text` matches at least one wildcard pattern. */
export function matchAny(text, patterns) {
  if (!Array.isArray(patterns) || typeof text !== "string") return false
  return patterns.some((p) => typeof p === "string" && compiled(p).test(text))
}
