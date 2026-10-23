#!/usr/bin/env node
// Replay of the recorded command corpus through the permission-model decision functions.
//
//   node scripts/permission-model/replay.mjs [--out FILE] [--top N]
//
// Corpus: fixtures/audit-commands.json (gitignored, optional) + fixtures/session-commands.json.
// Plugin dir: $PM_PLUGIN_DIR (default ../../plugins/permission-model).
// The corpus comes from the home machine, so `~/.kube/config` is stubbed to `current-context: admin@k8s`
// and the server env carries no KUBECONFIG / AWS_PROFILE.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
export const pluginDir = process.env.PM_PLUGIN_DIR ?? path.resolve(here, "../../plugins/permission-model")
const load = (f) => import(pathToFileURL(path.join(pluginDir, f)).href)
const { decideShell } = await load("decide.js")
const { decidePathAction } = await load("paths.js")
const { DEFAULTS } = await load("config.js")

export { DEFAULTS }
export const fixturesDir = path.join(here, "fixtures")
export const AUDIT_FILE = path.join(fixturesDir, "audit-commands.json")
export const SESSION_FILE = path.join(fixturesDir, "session-commands.json")

export const homeKubeReadFile = (p) => (String(p).endsWith("/.kube/config") ? "apiVersion: v1\ncurrent-context: admin@k8s\n" : undefined)

/** Same set of temp roots the plugin computes (index.js computeTmpRoots). */
export function computeTmpRoots(env = process.env) {
  const real = (p) => {
    try {
      return fs.realpathSync(p)
    } catch {
      return p
    }
  }
  const roots = new Set(["/tmp", "/private/tmp"])
  const add = (p) => {
    if (!p) return
    roots.add(p)
    roots.add(real(p))
  }
  add(os.tmpdir())
  add(env.TMPDIR ? env.TMPDIR.replace(/\/+$/, "") : undefined)
  for (const r of [...roots]) if (path.basename(r) === "T") roots.add(path.dirname(r))
  return [...roots]
}

export function loadCorpus({ audit = true } = {}) {
  const out = []
  if (audit && fs.existsSync(AUDIT_FILE)) out.push(...JSON.parse(fs.readFileSync(AUDIT_FILE, "utf8")))
  out.push(...JSON.parse(fs.readFileSync(SESSION_FILE, "utf8")).map((e) => ({ tool: "shell", ...e })))
  return out
}

const PATH_ACTIONS = { read: "read", edit: "edit", write: "write" }
const bump = (o, k, n = 1) => {
  o[k] = (o[k] ?? 0) + n
}

/**
 * replay(corpus, cfg, opts) -> { total, byTool, asks, denies, allows, errors, byCls, byTargetCls, byAgent, entries }
 * opts: { readFile, home, tmpRoots, env }
 */
export function replay(corpus, cfg = DEFAULTS, opts = {}) {
  const home = opts.home ?? os.homedir()
  const tmpRoots = opts.tmpRoots ?? computeTmpRoots()
  const readFile = opts.readFile ?? homeKubeReadFile
  const env = opts.env ?? { TMPDIR: (process.env.TMPDIR ?? "").replace(/\/+$/, ""), USER: process.env.USER ?? "" }
  const res = { total: 0, byTool: {}, asks: 0, denies: 0, allows: 0, errors: 0, byCls: {}, byTargetCls: {}, byAgent: {}, entries: [] }
  for (const e of corpus) {
    const tool = e.tool ?? "shell"
    const sessionDir = e.cwd || home
    let rec
    try {
      if (tool === "shell") {
        const d = decideShell(e.command ?? "", { cfg, cwd: sessionDir, sessionDir, home, tmpRoots, env, readFile, agent: e.agent })
        const failed = d.cls === "ERROR"
        rec = {
          effect: failed ? "ERROR" : d.effect,
          cls: d.cls,
          targetCls: d.targetCls,
          target: d.target ? { kind: d.target.kind, name: d.target.name, cls: d.target.cls } : undefined,
          reason: d.reason,
          message: d.message,
          passthrough: d.passthrough || undefined,
        }
      } else if (PATH_ACTIONS[tool]) {
        const d = decidePathAction(PATH_ACTIONS[tool], e.path ?? "", cfg, { home, sessionDir })
        rec = { effect: d.effect, cls: d.cls ?? "path-allow", targetCls: "none", target: { kind: "path", name: e.path, cls: d.cls ?? "none" }, reason: d.cls ?? "path", message: d.message || undefined }
      } else {
        throw new Error(`unknown tool ${tool}`)
      }
    } catch (err) {
      rec = { effect: "ERROR", cls: "ERROR", targetCls: undefined, target: undefined, reason: "exception", message: err?.message ?? String(err) }
    }
    const entry = { id: e.id, tool, agent: e.agent, cwd: e.cwd, ...(e.command !== undefined ? { command: e.command } : {}), ...(e.path !== undefined ? { path: e.path } : {}), ...rec }
    res.entries.push(entry)
    res.total++
    bump(res.byTool, tool)
    bump(res.byCls, String(entry.cls))
    bump(res.byTargetCls, String(entry.targetCls))
    const a = (res.byAgent[e.agent ?? "?"] ??= { allow: 0, ask: 0, deny: 0, ERROR: 0 })
    bump(a, entry.effect)
    if (entry.effect === "ask") res.asks++
    else if (entry.effect === "deny") res.denies++
    else if (entry.effect === "allow") res.allows++
    else res.errors++
  }
  return res
}

/** First two words of the command (or `tool:cls` for path entries). */
export function prefixOf(entry) {
  if (entry.command === undefined) return `${entry.tool}:${entry.cls}`
  const words = entry.command.trim().split(/\s+/).slice(0, 2)
  return words.join(" ") || "(empty)"
}

export function topPrefixes(entries, effects, n) {
  const groups = new Map()
  for (const e of entries) {
    if (!effects.includes(e.effect)) continue
    const key = `${e.effect} ${prefixOf(e)}`
    const g = groups.get(key) ?? { key, count: 0, examples: [] }
    g.count++
    if (g.examples.length < 2) g.examples.push(e.command ?? e.path)
    groups.set(key, g)
  }
  return [...groups.values()].sort((a, b) => b.count - a.count).slice(0, n)
}

function summary(res, top) {
  const lines = []
  lines.push(`total ${res.total}  allow ${res.allows}  ask ${res.asks}  deny ${res.denies}  errors ${res.errors}`)
  lines.push(`byTool ${JSON.stringify(res.byTool)}`)
  lines.push(`byCls ${JSON.stringify(res.byCls)}`)
  lines.push(`byTargetCls ${JSON.stringify(res.byTargetCls)}`)
  lines.push(`byAgent ${JSON.stringify(res.byAgent)}`)
  lines.push("")
  lines.push(`top ${top} ask/deny prefixes:`)
  for (const g of topPrefixes(res.entries, ["ask", "deny", "ERROR"], top)) {
    lines.push(`  ${String(g.count).padStart(4)}  ${g.key}`)
    for (const ex of g.examples) lines.push(`        ${String(ex).replace(/\s+/g, " ").slice(0, 160)}`)
  }
  return lines.join("\n")
}

function main(argv) {
  let out = path.join(process.env.TMPDIR ?? os.tmpdir(), "opencode", "pm-replay.json")
  let top = 20
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out") out = argv[++i]
    else if (argv[i] === "--top") top = Number(argv[++i])
    else {
      console.error(`unknown argument ${argv[i]}`)
      process.exit(2)
    }
  }
  const corpus = loadCorpus()
  const res = replay(corpus, DEFAULTS)
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, JSON.stringify(res, null, 1))
  console.log(summary(res, top))
  console.log(`\nwritten ${out}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2))
