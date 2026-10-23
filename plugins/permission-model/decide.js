// Decision engine (spec §3, §4.3 "Always" per class, §4.6a, §5.2–5.3).
//
//   decide(classification, target, cfg, { agent, inv }) -> Decision
//   reconcile(decision, incomingEffect, cfg)            -> final effect ("allow"|"ask"|"deny")
//   decideShell(command, ctx)                           -> Decision of the strictest invocation
//
//   Decision = { effect, cls, target, targetCls, reason, message?, passthrough?, classification }
//
// `passthrough: true` = the agent is in `cfg.restrictedAgents`: the plugin does not intervene, the
// incoming (native) effect stands — except for `secret-deny`, which is always a deny.
//
// Note: classify() does not record WHICH namespace made a kubectl/helm/flux operation protected
// (its `detail` is the matched irreversible pattern, e.g. "kubectl delete ns *"), so decide() also
// inspects `inv.args` for `cfg.protectedNamespaces` / `-A` / `--all-namespaces` when it has `inv`.

import path from "node:path"
import { parseCommand } from "./parse.js"
import { unwrap } from "./unwrap.js"
import { resolveTarget } from "./target.js"
import { classify, matchAny, SEVERITY } from "./classify.js"
import * as msg from "./messages.js"

const RANK = { allow: 0, ask: 1, deny: 2 }
// shell grammar headers that must never be judged as commands (unwrap skips them already)
const PSEUDO = new Set(["for", "case", "while", "until", "select", "if", "elif", "then", "else", "do", "done", "fi", "esac"])

const baseName = (t) => path.basename(String(t ?? ""))

/** Class of the target as the engine treats it: dev | home | prod | unknown | local. */
function effectiveTargetCls(target, tool) {
  const cls = target?.cls ?? "unknown"
  if (target?.kind === "cloud") return tool === "gh" || tool === "git" ? "home" : "prod"
  return cls
}

function isProtectedHit(classification, inv, cfg) {
  const prot = cfg?.protectedNamespaces ?? []
  const detail = String(classification?.detail ?? "")
  if (/protected namespace|all namespaces/.test(detail)) return true
  if (prot.some((p) => detail.split(/[\s,=/]+/).includes(p))) return true
  for (const a of inv?.args ?? []) {
    const s = String(a)
    if (s === "-A" || s === "--all-namespaces" || s === "--all-namespaces=true") return true
    if (prot.some((p) => s.split(/[=,/]/).includes(p))) return true
  }
  return false
}

function opaqueReason(classification) {
  switch (classification?.reason) {
    case "context-switch":
      return msg.OPAQUE_REASONS.context
    case "tmp-script":
    case "xargs-eval":
      return msg.OPAQUE_REASONS.tmpScript
    default:
      return msg.OPAQUE_REASONS.variable
  }
}

/** What is being acted on, for the free-text messages (path or command). */
function describe(classification, inv, tool) {
  const d = classification?.detail
  if (d !== undefined && d !== "") return String(d)
  if (inv?.raw) return String(inv.raw)
  return [tool, ...(inv?.args ?? [])].filter(Boolean).join(" ")
}

export function decide(classification, target, cfg, opts = {}) {
  const { agent, inv } = opts
  const cls = classification?.cls
  const tool = inv?.tool ? baseName(inv.tool) : target?.kind === "cloud" ? String(target.name ?? "") : ""
  const verb = classification?.verb ?? ""
  const tcls = effectiveTargetCls(target, tool)
  const kind = target?.kind
  const name = target?.name ?? (kind === "local" || kind === "none" ? classification?.detail : undefined)
  const out = (effect, reason, message) => {
    const d = { effect, cls, target, targetCls: tcls, reason, classification }
    if (message) d.message = message
    if (agent && (cfg?.restrictedAgents ?? []).includes(agent) && cls !== "secret-deny") d.passthrough = true
    return d
  }

  switch (cls) {
    case "local-read":
    case "local-write":
    case "ext-read":
      return out("allow", cls)
    case "local-ask":
      return out("ask", cls, msg.systemChange(tool))
    case "secret-deny":
      return out("deny", cls, msg.secretDeny(describe(classification, inv, tool)))
    case "secret-ask":
      return out("ask", cls, msg.secretAsk(describe(classification, inv, tool)))
    case "own-config":
      return out("ask", cls, msg.ownConfig(describe(classification, inv, tool)))
    case "opaque":
      return out("ask", cls, msg.unknownTarget(opaqueReason(classification)))
    case "irreversible":
      if (tcls === "dev" && !isProtectedHit(classification, inv, cfg)) return out("allow", cls)
      return out("ask", cls, msg.irreversible({ cls: tcls, kind, name, tool, verb }))
    case "ext-write": {
      if (/context-switch/.test(String(target?.source ?? ""))) return out("ask", cls, msg.unknownTarget(msg.OPAQUE_REASONS.context))
      if (tcls === "dev") return out("allow", cls)
      if (tcls === "home") {
        const allowed = cfg?.homeAllowedWrites?.[tool] ?? []
        if (verb && matchAny(verb, allowed)) return out("allow", cls)
        return out("ask", cls, msg.writeAsk({ cls: tcls, kind, name, tool, verb }))
      }
      // prod / unknown / local (an external write with no recognisable target) -> ask
      return out("ask", cls, msg.writeAsk({ cls: tcls === "prod" ? "prod" : "unknown", kind, name, tool, verb }))
    }
    default:
      // unknown class: fail closed
      return out("ask", cls ?? "unknown", msg.unknownTarget(msg.OPAQUE_REASONS.variable))
  }
}

/**
 * Final effect given the native/merged `incomingEffect` (config + saved "Always" approvals).
 * Never weakens an incoming deny. Saved allows are honoured only for the classes of spec §4.3 "Always".
 */
export function reconcile(decision, incomingEffect, cfg) { // eslint-disable-line no-unused-vars
  const cls = decision?.cls
  if (cls === "secret-deny" || decision?.effect === "deny") return "deny"
  if (incomingEffect === "deny") return "deny"
  if (decision?.passthrough) return incomingEffect ?? decision.effect
  if (incomingEffect === "allow") {
    if (cls === "local-read" || cls === "local-write" || cls === "ext-read") return "allow"
    if (cls === "ext-write" && (decision.targetCls === "dev" || decision.targetCls === "home")) return "allow"
    // every other class (prod/unknown writes, irreversible, secrets, own-config, opaque, local-ask)
    // ignores saved allows and follows decision.effect
  }
  return decision.effect
}

const rankOf = (d) => RANK[d.effect] * 100 + (SEVERITY.length - Math.max(SEVERITY.indexOf(d.cls), 0))

/** Pipeline for a whole shell command line: strictest decision over all invocations. */
export function decideShell(command, ctx = {}) {
  try {
    const { cfg, cwd, home, tmpRoots = [], env = {}, readFile, agent } = ctx
    const sessionDir = ctx.sessionDir ?? cwd
    const simples = parseCommand(String(command ?? ""))
    const invs = unwrap(simples, { cwd, home, tmpRoots, env })
    let best
    for (const inv of invs) {
      if (!inv || inv.tool === undefined || inv.tool === "" || PSEUDO.has(inv.tool)) continue
      const target = resolveTarget(inv, cfg, { home, tmpRoots, readFile, env })
      const classification = classify(inv, target, cfg, { home, tmpRoots, sessionDir, agent })
      const d = decide(classification, target, cfg, { agent, inv })
      d.tool = baseName(inv.tool)
      d.cwd = inv.cwd // tracked working directory of this invocation (after `cd`), for the decision log
      if (!best || rankOf(d) > rankOf(best)) best = d
    }
    if (!best) {
      return { effect: "allow", cls: "local-read", target: { kind: "none", cls: "local", source: "empty" }, targetCls: "local", reason: "empty" }
    }
    return best
  } catch (err) {
    return {
      effect: "ask",
      cls: "ERROR",
      target: undefined,
      reason: "error",
      message: msg.pluginError(err?.message ?? String(err)),
    }
  }
}
