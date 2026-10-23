import path from "node:path"
import { expandVars, hasUnresolved } from "./unwrap.js"

// Target resolver (spec §4.6): which cluster / AWS profile / node / remote does an Invocation hit?
//
//   Target = { kind: "k8s"|"aws"|"talos"|"git"|"cloud"|"local"|"none",
//              name?: string, cls: "local"|"dev"|"home"|"prod"|"unknown", source: string }
//
// "unknown" is treated like prod by the decision layer. No caching: kubeconfig files are read
// through the injected `readFile` on every call; no network, no `sts`.

/** Wildcard match, full string: `*` = any run of characters (including `/`), `?` = one character. */
export function matchPattern(text, pattern) {
  const source = String(pattern)
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".")
  return new RegExp(`^${source}$`, "s").test(String(text))
}

const anyMatch = (name, patterns) => (patterns ?? []).some((p) => matchPattern(name, p))
/**
 * Class of a context / profile / node name (ruling R7): `kind-*` → dev; then the user lists, where a
 * name matching several lists gets the STRICTER class (prod > home > dev); nothing matched → unknown.
 */
function classify(name, targets = {}) {
  if (!name || /[$`]/.test(name)) return "unknown"
  if (matchPattern(name, "kind-*")) return "dev"
  if (anyMatch(name, targets.prod)) return "prod"
  if (anyMatch(name, targets.home)) return "home"
  if (anyMatch(name, targets.dev)) return "dev"
  return "unknown"
}

/** Value of `--flag X` / `--flag=X` (first occurrence, stops at `--`). undefined = flag absent. */
function flagValue(args, names) {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === "--") return undefined
    for (const n of names) {
      if (a === n) return i + 1 < args.length ? args[i + 1] : ""
      if (a.startsWith(`${n}=`)) return a.slice(n.length + 1)
    }
  }
  return undefined
}

const norm = (p) => p.replace(/^\/private(?=\/)/, "")

/**
 * Is the absolute path `p` inside (or equal to) one of `tmpRoots`? `/var` ↔ `/private/var` and
 * `/tmp` ↔ `/private/tmp` are treated as the same; `..` is resolved first.
 */
export function inTmp(p, tmpRoots = []) {
  const np = norm(path.resolve(p))
  return tmpRoots.some((root) => {
    const r = norm(path.resolve(root))
    return np === r || np.startsWith(r === "/" ? "/" : `${r}/`)
  })
}

function expandPath(p, inv, rt) {
  const e = expandVars(p, { home: rt.home, tmpDir: rt.tmpRoots?.[0], cwd: inv.cwd, user: rt.env?.USER })
  if (hasUnresolved(e) || e.startsWith("~")) return undefined
  if (path.isAbsolute(e)) return path.resolve(e)
  return inv.cwd ? path.resolve(inv.cwd, e) : undefined
}

function currentContext(text) {
  if (typeof text !== "string") return undefined
  const m = /^current-context:[ \t]*(.*?)[ \t]*$/m.exec(text)
  if (!m) return undefined
  const v = m[1].replace(/^(["'])(.*)\1$/, "$2").trim()
  return v === "" ? undefined : v
}

const KUBE_TOOLS = new Set(["kubectl", "helm", "flux", "kubeseal"])
const CLOUD_TOOLS = new Set(["gh", "wrangler", "cf", "jk", "ant", "crane", "stitch"])
const GIT_REMOTE_SUBS = new Set(["push", "fetch", "pull", "clone"])
const GIT_GLOBAL_VALUE_FLAGS = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path"])
const GIT_VALUE_FLAGS = new Set(["-o", "--push-option", "--repo", "--receive-pack", "--exec", "--upload-pack", "--depth", "-j", "--jobs", "--filter", "-b", "--branch", "--origin", "--config", "--reference", "--template", "--separate-git-dir"])

function kubeTarget(inv, cfg, rt) {
  const args = inv.args ?? []
  const ctxFlag = flagValue(args, ["--context", "--kube-context"])
  const kcFlag = flagValue(args, ["--kubeconfig"])
  const kcSource = kcFlag !== undefined ? "flag:--kubeconfig" : "env:KUBECONFIG"
  const kcRaw = kcFlag !== undefined ? kcFlag : inv.env?.KUBECONFIG
  let kcEntries
  if (kcRaw) kcEntries = kcRaw.split(":").filter(Boolean).map((p) => expandPath(p, inv, rt))
  const kcUnknownPath = kcEntries?.some((p) => p === undefined)
  const kcAllTmp = !!kcEntries?.length && !kcUnknownPath && kcEntries.every((p) => inTmp(p, rt.tmpRoots))

  if (ctxFlag !== undefined) {
    const cls = classify(ctxFlag, cfg.targets)
    if (kcAllTmp) return { kind: "k8s", name: ctxFlag, cls: cls === "prod" ? "prod" : "dev", source: "flag:--context+tmp-kubeconfig" }
    return { kind: "k8s", name: ctxFlag, cls, source: "flag:--context" }
  }
  if (kcAllTmp) return { kind: "k8s", name: kcEntries[0], cls: "dev", source: `${kcSource}:tmp` }
  if (kcRaw && kcUnknownPath) return { kind: "k8s", cls: "unknown", source: `${kcSource}:unresolved` }

  // R9: the server process has KUBECONFIG set and the command does not override it → the file kubectl
  // really uses may not be ~/.kube/config, so do not guess.
  if (!kcRaw && rt.env?.KUBECONFIG) return { kind: "k8s", cls: "unknown", source: "env:KUBECONFIG(server)" }

  const file = kcEntries?.length ? kcEntries.find((p) => !inTmp(p, rt.tmpRoots)) : rt.home ? path.join(rt.home, ".kube", "config") : undefined
  if (!file) return { kind: "k8s", cls: "unknown", source: "kubeconfig:missing-home" }
  const source = kcEntries?.length ? `${kcSource}:current-context` : "kubeconfig:current-context"
  let text
  try {
    text = rt.readFile?.(file)
  } catch {
    text = undefined
  }
  const name = currentContext(text)
  if (!name) return { kind: "k8s", cls: "unknown", source: `${source}:unreadable` }
  return { kind: "k8s", name, cls: classify(name, cfg.targets), source }
}

function awsTarget(inv, cfg, rt) {
  const fromFlag = flagValue(inv.args ?? [], ["--profile"])
  let name
  let source
  if (fromFlag !== undefined) {
    name = fromFlag
    source = "flag:--profile"
  } else if (inv.env?.AWS_PROFILE) {
    name = inv.env.AWS_PROFILE
    source = "command-env:AWS_PROFILE"
  } else if (rt.env?.AWS_PROFILE) {
    name = rt.env.AWS_PROFILE
    source = "env:AWS_PROFILE"
  } else {
    name = "default"
    source = "default"
  }
  return { kind: "aws", name: name || "default", cls: classify(name, cfg.targets), source }
}

function talosTarget(inv, cfg) {
  const args = inv.args ?? []
  const ctx = flagValue(args, ["--context"])
  const nodes = flagValue(args, ["-n", "--nodes"])
  if (ctx) return { kind: "talos", name: ctx, cls: classify(ctx, cfg.targets), source: "flag:--context" }
  if (nodes) return { kind: "talos", name: nodes, cls: classify(nodes, cfg.targets), source: "flag:--nodes" }
  return { kind: "talos", cls: "unknown", source: "talosconfig:default" }
}

function gitTarget(inv) {
  const args = inv.args ?? []
  let i = 0
  for (; i < args.length; i++) {
    if (GIT_GLOBAL_VALUE_FLAGS.has(args[i])) i++
    else if (!args[i].startsWith("-")) break
  }
  const sub = args[i]
  if (!GIT_REMOTE_SUBS.has(sub)) return undefined
  let remote
  for (let j = i + 1; j < args.length; j++) {
    const a = args[j]
    if (GIT_VALUE_FLAGS.has(a)) j++
    else if (!a.startsWith("-")) {
      remote = a
      break
    }
  }
  // Decision (spec §3.1): git remotes are the user's own repos → class home. Whether a push goes to
  // a repo that is NOT the user's own (§4.3) is for the classifier to judge.
  return { kind: "git", name: remote ?? (sub === "clone" ? "" : "origin"), cls: "home", source: `git:${sub}` }
}

function isContainerPush(tool, args) {
  if (tool !== "docker" && tool !== "podman") return false
  const pos = args.filter((a) => !a.startsWith("-"))
  return pos[0] === "push" || (pos[0] === "image" && pos[1] === "push") || (tool === "docker" && pos[0] === "buildx" && args.includes("--push"))
}

/**
 * @param {object} inv Invocation from unwrap()
 * @param {object} cfg config (uses cfg.targets.{home,dev,prod})
 * @param {{home?: string, tmpRoots?: string[], readFile?: (p: string) => string|undefined, env?: Record<string,string>}} rt
 */
export function resolveTarget(inv, cfg, rt = {}) {
  const tool = path.basename(String(inv.tool ?? ""))
  const args = inv.args ?? []
  if (/^[$`]/.test(String(inv.tool ?? ""))) return { kind: "none", cls: "unknown", source: "unresolved-tool" }

  let t
  if (KUBE_TOOLS.has(tool)) t = kubeTarget(inv, cfg, rt)
  else if (tool === "aws") t = awsTarget(inv, cfg, rt)
  else if (tool === "talosctl") t = talosTarget(inv, cfg)
  else if (tool === "git") t = gitTarget(inv)
  else if (CLOUD_TOOLS.has(tool) || isContainerPush(tool, args)) t = { kind: "cloud", name: tool, cls: "prod", source: "tool" }
  t ??= { kind: "local", cls: "local", source: "tool" }

  // A context / profile switch earlier in the same command makes the target unknowable.
  if (inv.contextSwitch && t.kind !== "local") t = { ...t, cls: "unknown", source: `${t.source}+context-switch` }
  return t
}
