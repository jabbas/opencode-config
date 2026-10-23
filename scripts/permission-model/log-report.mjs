#!/usr/bin/env node
// Shadow-log report for the permission-model plugin (spec §6 step 2).
//   node scripts/permission-model/log-report.mjs [file] [--since ISO] [--json]
// Default file: ~/.local/share/opencode/permission-model/decisions.jsonl
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

export const STATE_DIR = path.join(os.homedir(), ".local", "share", "opencode", "permission-model")
// same env overrides as the plugin (index.js) and check-alive.mjs
export const defaultLogFile = (env = process.env) => env.PM_LOG_FILE || path.join(STATE_DIR, "decisions.jsonl")
export const defaultAliveFile = (env = process.env) => env.PM_ALIVE_FILE || path.join(STATE_DIR, "alive")

const USAGE = "Użycie: node scripts/permission-model/log-report.mjs [plik] [--since ISO] [--json]"

const GAP_MS = 5 * 60 * 1000
const SPECIAL = new Set(["ERROR", "CONFIG_ERROR"])
const EXAMPLE_LEN = 100

/** Parse JSONL text -> { entries, skipped }; malformed lines are counted, never thrown on. */
export function parseLog(text, { since } = {}) {
  const entries = []
  let skipped = 0
  const sinceMs = since ? Date.parse(since) : undefined
  for (const line of String(text ?? "").split("\n")) {
    if (line.trim() === "") continue
    let e
    try {
      e = JSON.parse(line)
    } catch {
      skipped++
      continue
    }
    if (!e || typeof e !== "object" || Array.isArray(e)) {
      skipped++
      continue
    }
    if (sinceMs !== undefined && !Number.isNaN(sinceMs)) {
      const t = Date.parse(e.ts)
      if (Number.isNaN(t) || t < sinceMs) continue
    }
    entries.push(e)
  }
  return { entries, skipped }
}

const keyOf = (e) => `${e.cls ?? "?"} ${String(e.resource ?? "").trim().split(/\s+/).slice(0, 2).join(" ")}`.trim()
const clip = (s) => (s.length > EXAMPLE_LEN ? `${s.slice(0, EXAMPLE_LEN)}…` : s)

function top(entries, limit) {
  const map = new Map()
  for (const e of entries) {
    const k = keyOf(e)
    let g = map.get(k)
    if (!g) map.set(k, (g = { key: k, count: 0, examples: [] }))
    g.count++
    const r = clip(String(e.resource ?? ""))
    if (g.examples.length < 2 && !g.examples.includes(r)) g.examples.push(r)
  }
  return [...map.values()].sort((a, b) => b.count - a.count || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)).slice(0, limit)
}

const inc = (obj, k) => {
  const key = k ?? "?"
  obj[key] = (obj[key] ?? 0) + 1
}

/**
 * report(entries, { alive?: {pid,ts,mode}, now?: ms, top?: n })
 * Pure; ERROR / CONFIG_ERROR entries are counted under `errors` / `configErrors` and excluded from wouldChange/asks.
 */
export function report(entries, opts = {}) {
  const limit = opts.top ?? 15
  const byMode = {}
  const byAction = {}
  const byAgent = {}
  const wouldChange = { allowToAsk: 0, askToAllow: 0, toDeny: 0, denyKept: 0 }
  const asks = []
  const allowToAsk = []
  const askToAllow = []
  const errSamples = []
  let errCount = 0
  let configErrors = 0
  let incomingAsk = 0
  let decidedAsk = 0

  for (const e of entries) {
    inc(byMode, e.mode)
    inc(byAction, e.action)
    inc(byAgent, e.agent)
    if (e.cls === "CONFIG_ERROR") {
      configErrors++
      continue
    }
    if (e.cls === "ERROR") {
      errCount++
      if (errSamples.length < 5) errSamples.push({ ts: e.ts, reason: e.reason, resource: clip(String(e.resource ?? "")) })
      continue
    }
    if (e.incoming === "ask") incomingAsk++
    if (e.decided === "ask") {
      decidedAsk++
      asks.push(e)
    }
    if (e.decided === "deny") {
      if (e.incoming === "deny") wouldChange.denyKept++
      else wouldChange.toDeny++
    } else if (e.incoming === "allow" && e.decided === "ask") {
      wouldChange.allowToAsk++
      allowToAsk.push(e)
    } else if (e.incoming === "ask" && e.decided === "allow") {
      wouldChange.askToAllow++
      askToAllow.push(e)
    }
  }

  // active time: sum of gaps <= 5 min between consecutive entries
  const times = entries.map((e) => Date.parse(e.ts)).filter((t) => !Number.isNaN(t)).sort((a, b) => a - b)
  let activeMs = 0
  for (let i = 1; i < times.length; i++) {
    const gap = times[i] - times[i - 1]
    if (gap <= GAP_MS) activeMs += gap
  }
  const activeHours = activeMs / 3600000
  const rate = (n) => (activeHours > 0 ? n / activeHours : 0)

  const a = opts.alive
  const now = opts.now ?? Date.now()
  const alive = a && typeof a.ts === "number" ? { ageSec: Math.round((now - a.ts) / 1000), mode: a.mode ?? null } : { ageSec: null, mode: null }

  return {
    total: entries.length,
    byMode,
    byAction,
    byAgent,
    wouldChange,
    topAsks: top(asks, limit),
    topAllowToAsk: top(allowToAsk, limit),
    topAskToAllow: top(askToAllow, limit),
    errors: { count: errCount, samples: errSamples },
    configErrors,
    activeHours,
    asksPerHour: { config: rate(incomingAsk), plugin: rate(decidedAsk) },
    alive,
  }
}

const fmtMap = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}: ${v}`).join(", ") || "—"

function section(title, rows) {
  if (rows.length === 0) return [`### ${title}`, "", "_brak_", ""]
  const out = [`### ${title}`, ""]
  for (const r of rows) {
    out.push(`- **${r.count}×** \`${r.key}\``)
    for (const ex of r.examples) out.push(`  - \`${ex.replace(/`/g, "'")}\``)
  }
  out.push("")
  return out
}

/** Compact Markdown (Polish). */
export function toMarkdown(r, { skipped = 0, file } = {}) {
  const w = r.wouldChange
  const L = []
  L.push("# Raport shadow — permission-model", "")
  if (file) L.push(`Plik: \`${file}\``, "")
  L.push(
    `- Wpisów: **${r.total}**${skipped ? ` (pominięto uszkodzonych linii: ${skipped})` : ""}`,
    `- Tryby: ${fmtMap(r.byMode)}`,
    `- Akcje: ${fmtMap(r.byAction)}`,
    `- Agenci: ${fmtMap(r.byAgent)}`,
    `- Czas aktywny: **${r.activeHours.toFixed(2)} h** (przerwy ≤ 5 min)`,
    `- Pytania/h: konfiguracja **${r.asksPerHour.config.toFixed(1)}**, plugin **${r.asksPerHour.plugin.toFixed(1)}**`,
    `- Plugin żywy: ${r.alive.ageSec === null ? "brak znacznika `alive`" : `ostatni znacznik ${r.alive.ageSec} s temu, tryb ${r.alive.mode}`}`,
    "",
    "## Różnice plugin vs konfiguracja",
    "",
    `- allow → ask (nowe pytania): **${w.allowToAsk}**`,
    `- ask → allow (pytania, które znikną): **${w.askToAllow}**`,
    `- → deny (nowe blokady): **${w.toDeny}**`,
    `- deny utrzymane: ${w.denyKept}`,
    "",
    `## Błędy: ${r.errors.count}, błędy konfiguracji: ${r.configErrors}`,
    "",
  )
  for (const s of r.errors.samples) L.push(`- ${s.ts ?? "?"} — ${s.reason ?? "?"} — \`${s.resource.replace(/`/g, "'")}\``)
  if (r.errors.samples.length) L.push("")
  L.push("## Najczęstsze", "")
  L.push(...section("Pytania pluginu (decided = ask)", r.topAsks))
  L.push(...section("allow → ask", r.topAllowToAsk))
  L.push(...section("ask → allow", r.topAskToAllow))
  return L.join("\n")
}

function readAlive(file = defaultAliveFile()) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"))
  } catch {
    return undefined
  }
}

function main(argv) {
  let file
  let since
  let json = false
  const bad = (msg) => {
    console.error(`${msg}\n${USAGE}`)
    return 1
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--json") json = true
    else if (a === "--since" || a.startsWith("--since=")) {
      since = a === "--since" ? argv[++i] : a.slice(8)
      if (!since || since.startsWith("--") || Number.isNaN(Date.parse(since))) return bad(`Nieprawidłowa wartość --since: ${since ?? "(brak)"}`)
    } else if (a.startsWith("-")) return bad(`Nieznana opcja: ${a}`)
    else if (file === undefined) file = a
    else return bad(`Nadmiarowy argument: ${a}`)
  }
  file ??= defaultLogFile()
  let text
  try {
    text = fs.readFileSync(file, "utf8")
  } catch (err) {
    console.error(`Nie można odczytać ${file}: ${err.message}`)
    return 1
  }
  const { entries, skipped } = parseLog(text, { since })
  const r = report(entries, { alive: readAlive() })
  console.log(json ? JSON.stringify({ ...r, skipped }, null, 2) : toMarkdown(r, { skipped, file }))
  return 0
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2))
