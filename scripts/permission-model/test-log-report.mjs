import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { report, parseLog, toMarkdown } from "./log-report.mjs"

const here = path.dirname(fileURLToPath(import.meta.url))
const T = (hms) => `2026-10-23T${hms}Z`
const mk = (ts, o) => ({ sessionID: "ses_1", agent: "coder", action: "shell", target: { kind: "none" }, ms: 1, reason: "r", mode: "shadow", ...o, ts: T(ts) })

// 8 entries; gaps: 1 min x4, 20 min (excluded), 1 min x2  => 6 min active = 0.1 h
const ENTRIES = [
  mk("10:00:00", { cls: "kube-write", resource: "kubectl apply -f a.yaml", incoming: "allow", decided: "ask", applied: "allow" }),
  mk("10:01:00", { cls: "kube-write", resource: "kubectl apply -f b.yaml", incoming: "allow", decided: "ask", applied: "allow" }),
  mk("10:02:00", { cls: "read", resource: "git log --oneline", incoming: "ask", decided: "allow", applied: "ask" }),
  mk("10:03:00", { cls: "irreversible", resource: "rm -rf /", incoming: "deny", decided: "deny", applied: "deny" }),
  mk("10:04:00", { cls: "ERROR", resource: "weird", incoming: "ask", decided: "ask", applied: "ask", reason: "timeout" }),
  mk("10:24:00", { cls: "CONFIG_ERROR", resource: "x", incoming: "ask", decided: "ask", applied: "ask", reason: "bad json", agent: "general" }),
  mk("10:25:00", { cls: "ext-write", resource: "gh pr create --fill", incoming: "ask", decided: "ask", applied: "ask", mode: "enforce" }),
  mk("10:26:00", { cls: "secret-deny", resource: "cat ~/.ssh/id_rsa", incoming: "allow", decided: "deny", applied: "deny", mode: "enforce", agent: "general" }),
]

test("counts, wouldChange and rates", () => {
  const r = report(ENTRIES, { alive: { ts: 1_000_000, mode: "shadow" }, now: 1_000_000 + 42_000 })
  assert.equal(r.total, 8)
  assert.deepEqual(r.byMode, { shadow: 6, enforce: 2 })
  assert.deepEqual(r.byAction, { shell: 8 })
  assert.deepEqual(r.byAgent, { coder: 6, general: 2 })
  assert.deepEqual(r.wouldChange, { allowToAsk: 2, askToAllow: 1, toDeny: 1, denyKept: 1 })
  assert.equal(r.errors.count, 1)
  assert.equal(r.errors.samples[0].reason, "timeout")
  assert.equal(r.configErrors, 1)
  assert.deepEqual(r.alive, { ageSec: 42, mode: "shadow" })
  assert.ok(Math.abs(r.activeHours - 0.1) < 1e-9, `activeHours=${r.activeHours}`)
  // incoming asks (non-error): git log, gh pr create = 2; decided asks: 2x kube-write + gh pr create = 3
  assert.ok(Math.abs(r.asksPerHour.config - 20) < 1e-6)
  assert.ok(Math.abs(r.asksPerHour.plugin - 30) < 1e-6)
})

test("top lists are ordered by count with ≤2 examples and a 2-word key", () => {
  const r = report(ENTRIES)
  assert.deepEqual(r.topAsks.map((t) => [t.key, t.count]), [["kube-write kubectl apply", 2], ["ext-write gh pr", 1]])
  assert.deepEqual(r.topAsks[0].examples, ["kubectl apply -f a.yaml", "kubectl apply -f b.yaml"])
  assert.deepEqual(r.topAllowToAsk.map((t) => [t.key, t.count]), [["kube-write kubectl apply", 2]])
  assert.deepEqual(r.topAskToAllow.map((t) => [t.key, t.count]), [["read git log", 1]])
  const many = Array.from({ length: 5 }, (_, i) => mk(`11:0${i}:00`, { cls: "c", resource: `tool sub ${i}`, incoming: "allow", decided: "ask" }))
  assert.equal(report(many).topAsks[0].examples.length, 2)
})

test("no entries / single entry: zero rates, no NaN", () => {
  const r = report([])
  assert.equal(r.total, 0)
  assert.equal(r.activeHours, 0)
  assert.deepEqual(r.asksPerHour, { config: 0, plugin: 0 })
  assert.deepEqual(r.alive, { ageSec: null, mode: null })
  assert.equal(report([ENTRIES[0]]).activeHours, 0)
})

test("parseLog skips malformed lines, honours --since", () => {
  const text = [JSON.stringify(ENTRIES[0]), "{not json", "", "42", JSON.stringify(ENTRIES[6]), "[1]"].join("\n")
  const p = parseLog(text)
  assert.equal(p.entries.length, 2)
  assert.equal(p.skipped, 3)
  assert.equal(report(p.entries).total, 2)
  assert.equal(parseLog(text, { since: T("10:10:00") }).entries.length, 1)
  assert.match(toMarkdown(report(p.entries), { skipped: p.skipped }), /pominięto uszkodzonych linii: 3/)
})

test("CLI: --json on a temp file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-report-"))
  const f = path.join(dir, "decisions.jsonl")
  fs.writeFileSync(f, ENTRIES.map((e) => JSON.stringify(e)).join("\n") + "\nGARBAGE\n")
  const res = spawnSync(process.execPath, [path.join(here, "log-report.mjs"), f, "--json"], { encoding: "utf8" })
  assert.equal(res.status, 0, res.stderr)
  const out = JSON.parse(res.stdout)
  assert.equal(out.total, 8)
  assert.equal(out.skipped, 1)
  const md = spawnSync(process.execPath, [path.join(here, "log-report.mjs"), f], { encoding: "utf8" })
  assert.match(md.stdout, /allow → ask \(nowe pytania\): \*\*2\*\*/)
  fs.rmSync(dir, { recursive: true, force: true })
})

test("CLI: PM_LOG_FILE / PM_ALIVE_FILE are honoured; bad arguments exit 1", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-env-"))
  const f = path.join(dir, "d.jsonl")
  const alive = path.join(dir, "alive")
  fs.writeFileSync(f, ENTRIES.map((e) => JSON.stringify(e)).join("\n") + "\n")
  fs.writeFileSync(alive, JSON.stringify({ pid: 7, ts: Date.now() - 5000, mode: "enforce" }))
  const script = path.join(here, "log-report.mjs")
  const env = { ...process.env, PM_LOG_FILE: f, PM_ALIVE_FILE: alive }
  const res = spawnSync(process.execPath, [script, "--json"], { encoding: "utf8", env })
  assert.equal(res.status, 0, res.stderr)
  const out = JSON.parse(res.stdout)
  assert.equal(out.total, 8)
  assert.equal(out.alive.mode, "enforce")
  for (const args of [["--since"], ["--since", "not-a-date"], ["--since=garbage"], ["--bogus"], ["a", "b"]]) {
    const r = spawnSync(process.execPath, [script, f, ...args], { encoding: "utf8", env })
    assert.equal(r.status, 1, `args ${args.join(" ")}`)
    assert.match(r.stderr, /Użycie/)
  }
  const ok = spawnSync(process.execPath, [script, f, "--since", "2026-10-23T10:20:00Z", "--json"], { encoding: "utf8", env })
  assert.equal(JSON.parse(ok.stdout).total, 3)
  fs.rmSync(dir, { recursive: true, force: true })
})

test("check-alive: a future ts is age 0 with a note", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-alive-"))
  const f = path.join(dir, "alive")
  fs.writeFileSync(f, JSON.stringify({ pid: 1, ts: Date.now() + 60_000, mode: "shadow" }))
  const r = spawnSync(process.execPath, [path.join(here, "check-alive.mjs"), f], { encoding: "utf8" })
  assert.equal(r.status, 0)
  assert.match(r.stdout, /age=0s/)
  assert.match(r.stdout, /w przyszłości/)
  fs.rmSync(dir, { recursive: true, force: true })
})

test("check-alive: exit 1 when missing or stale, 0 when fresh", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-alive-"))
  const f = path.join(dir, "alive")
  const run = () => spawnSync(process.execPath, [path.join(here, "check-alive.mjs"), f], { encoding: "utf8" })
  assert.equal(run().status, 1)
  fs.writeFileSync(f, JSON.stringify({ pid: 1, ts: Date.now() - 1000, mode: "shadow" }))
  const ok = run()
  assert.equal(ok.status, 0)
  assert.match(ok.stdout, /mode=shadow pid=1/)
  fs.writeFileSync(f, JSON.stringify({ pid: 1, ts: Date.now() - 400_000, mode: "shadow" }))
  assert.equal(run().status, 1)
  fs.rmSync(dir, { recursive: true, force: true })
})
