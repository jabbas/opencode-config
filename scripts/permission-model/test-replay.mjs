import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { replay, loadCorpus, DEFAULTS, AUDIT_FILE, fixturesDir } from "./replay.mjs"
import { label } from "./label.mjs"
import { OVERRIDES } from "./build-expected.mjs"

// Corpus replay + expected-decision table (task 8). Plugin dir: $PM_PLUGIN_DIR (default plugins/permission-model).
//
// PM_STRICT=1 : known divergences (fixtures/known-divergences.json) are NOT tolerated — use it while fixing the plugin.
// Without it, a divergence listed there only prints a diagnostic; any NEW divergence fails the suite.

const here = path.dirname(fileURLToPath(import.meta.url))
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(fixturesDir, f), "utf8"))
const STRICT = process.env.PM_STRICT === "1"
const haveAudit = fs.existsSync(AUDIT_FILE)
const noAudit = haveAudit ? false : "fixtures/audit-commands.json absent (gitignored; see fixtures/README.md)"

// expected-decisions.json / known-divergences.json hold real commands, so they are generated locally (gitignored) by
// build-expected.mjs. On a fresh clone they are absent: the tests that need them are skipped, the rest still runs.
const haveExpected = fs.existsSync(path.join(fixturesDir, "expected-decisions.json")) && fs.existsSync(path.join(fixturesDir, "known-divergences.json"))
const noExpected = haveExpected ? false : "fixtures/expected-decisions.json absent (generated locally by build-expected.mjs; see fixtures/README.md)"
const expected = haveExpected ? readJson("expected-decisions.json") : []
const known = new Map((haveExpected ? readJson("known-divergences.json") : []).map((d) => [d.id, d]))
const decided = replay(expected, DEFAULTS)
const decisionOf = new Map(decided.entries.map((e) => [e.id, e]))

const corpus = haveAudit ? loadCorpus() : []
const full = haveAudit ? replay(corpus, DEFAULTS) : undefined

const show = (e) => `${e.id.slice(-8)} [${e.agent}] ${String(e.command ?? e.path).replace(/\n/g, "⏎").slice(0, 140)}`

test("expected-decisions.json is well-formed and has the three groups", { skip: noExpected }, () => {
  assert.ok(expected.length >= 64 + 80, `only ${expected.length} rows`)
  for (const r of expected) {
    assert.ok(["allow", "ask", "deny"].includes(r.expected), `${r.id}: bad expected ${r.expected}`)
    assert.match(r.why, /^§[34]/, `${r.id}: bad why ${r.why}`)
    assert.ok(r.command !== undefined || r.path !== undefined, `${r.id}: no command/path`)
  }
  const groups = new Set(expected.map((r) => r.group))
  for (const g of ["session", "non-allow", "sample"]) assert.ok(groups.has(g), `missing group ${g}`)
  assert.equal(expected.filter((r) => r.group === "sample").length, 80)
  assert.equal(expected.filter((r) => r.group === "session").length, 64)
})

test("replay produced no errors", () => {
  assert.equal(decided.errors, 0, JSON.stringify(decided.entries.filter((e) => e.effect === "ERROR").map(show)))
  if (full) assert.equal(full.errors, 0, JSON.stringify(full.entries.filter((e) => e.effect === "ERROR").slice(0, 5).map(show)))
})

test("local commands never ask", { skip: noAudit }, () => {
  // restricted-profile denials (spec §4.7a: read-only shell for restricted agents) are intended, not prompts
  const bad = full.entries.filter((e) => /^local-/.test(String(e.cls)) && e.effect !== "allow" && !(e.cls === "local-ask") && e.reason !== "restricted-profile")
  assert.deepEqual(bad.map(show), [])
  // the work that is local must stay the overwhelming majority of the corpus (spec §2 anti-goal: more prompts than today)
  const share = full.allows / full.total
  assert.ok(share >= 0.9, `only ${(share * 100).toFixed(1)}% of the corpus is allowed without a prompt`)
})

test("reads never ask", { skip: noAudit }, () => {
  const bad = full.entries.filter((e) => e.cls === "ext-read" && e.effect !== "allow")
  assert.deepEqual(bad.map(show), [])
  // a `read`-tool call may only ask for sensitive data (§4.5) or be denied (§4.2)
  const badRead = full.entries.filter((e) => e.tool === "read" && e.effect !== "allow" && !["secret-ask", "secret-deny"].includes(e.cls))
  assert.deepEqual(badRead.map(show), [])
})

test("every expected decision matches", { skip: noExpected }, () => {
  const mismatches = []
  let tolerated = 0
  for (const r of expected) {
    const got = decisionOf.get(r.id).effect
    if (got === r.expected) continue
    if (!STRICT && known.has(r.id) && known.get(r.id).replay === got && known.get(r.id).expected === r.expected) {
      tolerated++
      continue
    }
    mismatches.push(`${r.id.slice(-8)} expected ${r.expected} (${r.why}) got ${got} [${r.agent}] ${String(r.command ?? r.path).replace(/\n/g, "⏎").slice(0, 120)}`)
  }
  if (tolerated) console.log(`# ${tolerated} known divergence(s) tolerated among the ${expected.length} expected rows (PM_STRICT=1 to fail on them)`)
  assert.deepEqual(mismatches, [], `${mismatches.length} expected decision(s) differ from the plugin:\n${mismatches.join("\n")}`)
})

test("secret and own-config never allow", () => {
  // §4.2 deny, §4.4 own config, §4.5 secrets: whatever the table expects as deny / ask for these must not be allowed
  const bad = expected.filter((r) => /^§4\.(2|4|5)/.test(r.why) && r.expected !== "allow" && decisionOf.get(r.id).effect === "allow" && !(known.has(r.id) && !STRICT))
  assert.deepEqual(bad.map(show), [])
  for (const r of expected.filter((x) => x.expected === "deny")) assert.equal(decisionOf.get(r.id).effect, "deny", show(r))
  if (full) {
    const leak = full.entries.filter((e) => ["secret-deny", "secret-ask", "own-config"].includes(e.cls) && e.effect === "allow")
    assert.deepEqual(leak.map(show), [])
  }
})

test("irreversible on home/prod never allow", () => {
  const bad = expected.filter((r) => r.why === "§4.3" && decisionOf.get(r.id).effect === "allow" && !(known.has(r.id) && !STRICT))
  assert.deepEqual(bad.map(show), [])
  if (full) {
    const leak = full.entries.filter((e) => e.cls === "irreversible" && e.effect === "allow" && e.targetCls !== "dev")
    assert.deepEqual(leak.map(show), [])
  }
})

test("whole-corpus divergences are exactly the known list (labeler vs plugin)", { skip: noAudit || noExpected }, () => {
  const byId = new Map(corpus.map((e) => [e.id, e]))
  const now = new Map()
  for (const r of full.entries) {
    const e = byId.get(r.id)
    const l0 = label(e)
    const ov = OVERRIDES[e.id.slice(-6)] ?? OVERRIDES[e.id]
    const l = ov ? { ...l0, ...ov } : l0
    if (l.expected !== r.effect) now.set(r.id, { expected: l.expected, replay: r.effect })
  }
  const fresh = [...now].filter(([id, d]) => !(known.has(id) && known.get(id).replay === d.replay && known.get(id).expected === d.expected))
  const stale = [...known.keys()].filter((id) => byId.has(id) && !now.has(id))
  const text = (id) => show(byId.get(id))
  assert.deepEqual(fresh.map(([id, d]) => `${d.expected}→${d.replay} ${text(id)}`), [], "new plugin-vs-label divergences (fix the plugin, or add a justified label override)")
  if (STRICT) assert.deepEqual([...now.keys()].map(text), [], "PM_STRICT: divergences remain")
  assert.deepEqual(stale.map(text), [], "known-divergences.json lists entries that no longer diverge — regenerate with build-expected.mjs")
})
