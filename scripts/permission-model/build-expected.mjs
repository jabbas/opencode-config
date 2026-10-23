#!/usr/bin/env node
// Builds fixtures/expected-decisions.json (+ fixtures/known-divergences.json and the markdown table
// docs/permission-model-expected-decisions.md) from the corpus.
//
//   node scripts/permission-model/build-expected.mjs [--no-docs]
//
// Labels come from label.mjs (an independent re-reading of the spec, §3–§4), NOT from the plugin's output.
// The plugin is used only to pick WHICH entries are listed (everything it would ask/deny, plus a seeded
// sample of what it would allow) and, afterwards, to report where it disagrees with the labels.
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import os from "node:os"
import { loadCorpus, replay, DEFAULTS, fixturesDir, SESSION_FILE, AUDIT_FILE } from "./replay.mjs"
import { label } from "./label.mjs"

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, "../..")
export const SEED = 20261023
export const SAMPLE = 80

// Hand corrections of the labeler (each with the spec citation that justifies it).
// id -> { expected, why, note }
export const OVERRIDES = {
  // §4.1 "Nieznane CLI z celem zewnętrznym: … URL inny niż localhost → zapis na zewnątrz (ask)"; `cloudflared tunnel … ingress rule <url>`
  // is not a read verb, so by the letter of the spec it asks even though it evaluates offline.
  LV1jNH: { expected: "ask", why: "§4.1", note: "nieznane CLI + URL spoza localhost; w praktyce lokalne — do decyzji użytkownika" },
  // Ruling after T8: `kubeseal` with cluster flags (--context/--controller-*/--fetch-cert/--validate/--re-encrypt) only
  // READS the controller's certificate (ext-read, allow); without cluster flags it is local. Only --recovery-unseal is secret-ask.
  TYX8Up: { expected: "allow", why: "§3", note: "kubeseal --context …: odczyt certyfikatu z kontrolera (ext-read), nie zapis" },
}

function mulberry32(a) {
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Why the plugin differs from the label — the triage of every divergence (see the report). */
export function divergenceKind(e, rec, lab) {
  const cmd = e.command ?? e.path ?? ""
  const msg = rec.message ?? ""
  if (lab.expected === "allow" && rec.effect === "ask") {
    if (rec.cls === "opaque" && /skrypt z tmp/.test(msg) && /python3? -\s*<<|python3? -\s*$/m.test(cmd) && !/\b(bash|sh|zsh)\s+\S*\.sh\b/.test(cmd)) return "fp: interpreter reading stdin (`python3 - <<EOF`) with a tmp working dir is not a tmp script"
    if (rec.cls === "opaque" && /skrypt z tmp/.test(msg) && /\bbun (install|add)\b/.test(cmd)) return "fp: `bun install|add` in tmp is not a tmp script"
    if (rec.cls === "secret-ask" && /secretspec/.test(cmd)) return "fp: `kubectl get … -o` secret rule matches the substring `secret` in `secretspec(s)` / namespace names"
    if (rec.cls === "secret-ask" && /\.(token|key|agent)\b/.test(msg)) return "fp: jq filter `.token` / `.key` treated as a `*.token|*.key` path"
    if (rec.cls === "secret-ask" && /env/.test(msg) && /\benv \| grep/.test(cmd)) return "strict: `env | grep PATTERN` asks unless the pattern is `^`-anchored (spec: only `env` WITHOUT a filter)"
    if (rec.cls === "local-ask" && /brew|pip|rsync/.test(msg)) return "extension: localAsk list goes beyond §3 (`brew tap|info`, `pip install`, local→local `rsync`)"
    if (rec.cls === "irreversible" && /KUBECONFIG=/.test(cmd) && /export /.test(cmd)) return "gap: `export KUBECONFIG=<tmp>` is not carried to later commands (only `KUBECONFIG=… cmd` / `--kubeconfig` are)"
    if (/gh api/.test(cmd) && /-X GET/.test(cmd)) return "strict: `gh api -X GET … -f k=v` is a GET but any `-f/-F` makes it a write"
    if (rec.cls === "ext-write" && /kubeseal/.test(msg)) return "fp: `kubeseal` (no cluster flags) is classified as a kube tool and asks on home"
    if (rec.cls === "opaque" && /zmienna w komendzie/.test(msg) && /\[\[/.test(cmd)) return "fp: `bash -c '… [[ \"$VAR\" =~ re ]] …'` reported as `zmienna w komendzie`"
    return "other"
  }
  if (lab.expected === "allow" && rec.effect === "deny") {
    if (/tar .*-C /.test(cmd)) return "fp: `tar -C <dir>` — the -C directory is treated as a path being read (deny)"
    if (/grep -rn "~"/.test(cmd)) return "fp: grep pattern `\"~\"` taken as the home directory path (deny)"
    return "other"
  }
  if (lab.expected === "ask" && rec.effect === "allow") {
    if (lab.why === "§4.6") return "policy (#17): `export AWS_PROFILE=… && aws … describe` — a literal export is a resolvable target and a read verb is allowed; the label (§4.6 A6) expects ask — user decides"
    if (/kubectl\b.*\bcreate\b/.test(cmd) && lab.why === "§3.1") return "spec-extension: plugin allows `kubectl create` on home (not in §3.1)"
    if (/\b(ln|git mv)\b/.test(cmd) && lab.why === "§4.4") return "gap: `ln` / `git mv` into own-config paths are not recognised as writes (§4.4)"
    if (lab.why === "§4.1" && /\blua\b/.test(cmd)) return "gap: `lua <tmp script>` — interpreter list lacks `lua`"
    if (lab.why === "§4.1" && /skrypt/.test(lab.note ?? "")) return "gap: script reached through a shell variable (`D=<tmp>; bash $D/x.sh`) is not recognised as a tmp script (§4.1)"
    return "other"
  }
  if (lab.expected === "deny" && rec.effect !== "deny") return "gap: hard deny not enforced"
  if (lab.expected === "ask" && rec.effect === "deny") return "other"
  return "other"
}

export function buildAll() {
  const corpus = loadCorpus()
  const res = replay(corpus, DEFAULTS)
  const byId = new Map(corpus.map((e) => [e.id, e]))
  const sessionIds = new Set(JSON.parse(fs.readFileSync(SESSION_FILE, "utf8")).map((e) => e.id))
  const rows = []
  const mk = (e, group) => {
    const l0 = label(e)
    const ov = OVERRIDES[e.id.slice(-6)] ?? OVERRIDES[e.id]
    const l = ov ? { ...l0, ...ov } : l0
    return {
      id: e.id,
      tool: e.tool,
      ...(e.command !== undefined ? { command: e.command } : { path: e.path }),
      agent: e.agent,
      cwd: e.cwd,
      expected: l.expected,
      why: l.why,
      ...(l.note ? { note: l.note } : {}),
      group,
    }
  }
  const taken = new Set()
  // (a) all session commands
  for (const r of res.entries) if (sessionIds.has(r.id)) {
    rows.push(mk(byId.get(r.id), "session"))
    taken.add(r.id)
  }
  // (b) everything the plugin would ask / deny / fail on
  for (const r of res.entries) if (!taken.has(r.id) && r.effect !== "allow") {
    rows.push(mk(byId.get(r.id), "non-allow"))
    taken.add(r.id)
  }
  // (c) seeded sample of 80 distinct allowed entries
  const pool = res.entries.filter((r) => !taken.has(r.id) && r.effect === "allow")
  const rnd = mulberry32(SEED)
  const idx = pool.map((_, i) => i)
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[idx[i], idx[j]] = [idx[j], idx[i]]
  }
  const seen = new Set()
  let n = 0
  for (const i of idx) {
    const r = pool[i]
    const key = `${r.tool}|${r.command ?? r.path}`
    if (seen.has(key)) continue
    seen.add(key)
    rows.push(mk(byId.get(r.id), "sample"))
    if (++n === SAMPLE) break
  }
  const replayById = new Map(res.entries.map((r) => [r.id, r]))
  return { rows, res, replayById, corpus }
}

const short = (s, n = 170) => {
  const t = String(s).replace(/\n/g, " ⏎ ")
  const tmp = (process.env.TMPDIR ?? "").replace(/\/+$/, "")
  return (tmp ? t.replaceAll("/private" + tmp.replace(/^\/private/, ""), "$TMPDIR").replaceAll(tmp, "$TMPDIR") : t).slice(0, n) + (t.length > n ? "…" : "")
}
const cell = (s) => s.replace(/\|/g, "\\|").replace(/`/g, "ˋ")

function renderDoc({ rows, res, replayById }, divergences) {
  const out = []
  const top = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1])
  out.push("# Model uprawnień v2 — tabela oczekiwanych decyzji (do zatwierdzenia)")
  out.push("")
  out.push("Spec: `docs/superpowers/specs/2026-10-22-permission-model-v2-design.md` §3–§4. Wygenerowane przez `scripts/permission-model/build-expected.mjs`")
  out.push("(etykiety z `label.mjs` — niezależna lektura spec, **nie** wynik pluginu; ziarno próbki `" + SEED + "`).")
  out.push("")
  out.push("## 1. Podsumowanie replay (plugin w trybie shadow, korpus: `audit-commands.json` + `session-commands.json`)")
  out.push("")
  out.push(`- Wpisów: **${res.total}** — allow **${res.allows}**, ask **${res.asks}**, deny **${res.denies}**, błędy **${res.errors}**`)
  out.push("- Narzędzia: " + top(res.byTool).map(([k, v]) => `${k} ${v}`).join(", "))
  out.push("- Klasy: " + top(res.byCls).map(([k, v]) => `${k} ${v}`).join(", "))
  out.push("- Klasa celu: " + top(res.byTargetCls).map(([k, v]) => `${k} ${v}`).join(", "))
  out.push("")
  out.push("| Agent | allow | ask | deny |")
  out.push("|---|---:|---:|---:|")
  for (const [a, v] of Object.entries(res.byAgent).sort()) out.push(`| ${a} | ${v.allow} | ${v.ask} | ${v.deny} |`)
  out.push("")
  out.push("## 2. Wartości startowe list celów — **do potwierdzenia** (spec §4.6)")
  out.push("")
  out.push("```json")
  out.push(JSON.stringify({ home: DEFAULTS.targets.home, dev: DEFAULTS.targets.dev, prod: DEFAULTS.targets.prod }, null, 2))
  out.push("```")
  out.push("")
  out.push("- Spec podaje `prod: [\"*-prod\", \"*-prd\", \"*-production\"]`; plugin dodaje jeszcze `prod-*`, `prd-*` (szerszy wzorzec — do potwierdzenia).")
  out.push("- Wszystko spoza list → `prod` (nieznany). Profile służbowe: `permission-model.local.json` na maszynie służbowej.")
  out.push("- Uwaga: profil AWS o nazwie `dev` (bez myślnika) **nie** pasuje do `*-dev` → ask (sc-041).")
  out.push("")
  out.push("## 3. Gdzie plugin ≠ etykieta (" + divergences.length + " wpisów w korpusie)")
  out.push("")
  const kinds = new Map()
  for (const d of divergences) kinds.set(d.kind, [...(kinds.get(d.kind) ?? []), d])
  out.push("| Rodzaj | Plugin | Etykieta | Liczba | Przykład |")
  out.push("|---|---|---|---:|---|")
  for (const [k, list] of [...kinds.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const d = list[0]
    out.push(`| ${cell(k)} | ${d.replay} | ${d.expected} | ${list.length} | \`${cell(short(d.text, 90))}\` |`)
  }
  out.push("")
  out.push("## 4. Tabela oczekiwanych decyzji, wg paragrafów spec")
  out.push("")
  out.push("`grupa`: **session** = komendy z rozmów (`session-commands.json`), **non-allow** = każdy wpis, o który plugin by zapytał/odmówił, **sample** = losowe 80 z reszty (plugin: allow).")
  out.push("Identyczne komendy zwinięto (×N). Kolumna *plugin* pokazuje aktualną decyzję pluginu, `≠` oznacza rozbieżność.")
  out.push("")
  const bySection = new Map()
  for (const r of rows) {
    const sec = r.why.split(" ")[0]
    bySection.set(sec, [...(bySection.get(sec) ?? []), r])
  }
  const order = ["§4.2", "§4.3", "§4.4", "§4.5", "§4.1", "§3.1", "§3"]
  const titles = {
    "§4.2": "§4.2 Twarde zakazy (deny)",
    "§4.3": "§4.3 Nieodwracalne na infrastrukturze — zawsze ask",
    "§4.4": "§4.4 Własne granice (ask)",
    "§4.5": "§4.5 Sekrety do odczytu (ask)",
    "§4.1": "§4.1 Klasyfikacja po czasowniku / nierozpoznawalne (ask)",
    "§3.1": "§3.1 Decyzje użytkownika (allow na `admin@k8s` / w repo użytkownika) i zapisy zewnętrzne",
    "§3": "§3 Trzy obszary: lokalnie / odczyt zewnętrzny allow; zapis zewnętrzny wg celu",
  }
  for (const sec of [...order, ...[...bySection.keys()].filter((k) => !order.includes(k))]) {
    const list = bySection.get(sec)
    if (!list) continue
    out.push(`### ${titles[sec] ?? sec}`)
    out.push("")
    const groups = new Map()
    for (const r of list) {
      const text = r.command ?? `${r.tool}: ${r.path}`
      const rec = replayById.get(r.id)
      const key = `${r.expected}|${rec.effect}|${text}`
      const g = groups.get(key) ?? { r, rec, text, n: 0, agents: new Set(), groups: new Set() }
      g.n++
      g.agents.add(r.agent)
      g.groups.add(r.group)
      groups.set(key, g)
    }
    out.push("| oczekiwane | plugin | § | agent | grupa | komenda / ścieżka |")
    out.push("|---|---|---|---|---|---|")
    const sorted = [...groups.values()].sort((a, b) => (a.r.expected === b.r.expected ? b.n - a.n : a.r.expected.localeCompare(b.r.expected)))
    const cap = sec === "§3" ? 200 : 400
    for (const g of sorted.slice(0, cap)) {
      const diff = g.rec.effect !== g.r.expected ? " ≠" : ""
      out.push(`| ${g.r.expected} | ${g.rec.effect}${diff} | ${cell(g.r.why)}${g.r.note ? " ⚠" : ""} | ${[...g.agents].join(",")} | ${[...g.groups].join(",")} | ${g.n > 1 ? `×${g.n} ` : ""}\`${cell(short(g.text))}\` |`)
    }
    if (sorted.length > cap) out.push(`| … | | | | | (+${sorted.length - cap} dalszych unikalnych wpisów w \`expected-decisions.json\`) |`)
    out.push("")
  }
  const notes = rows.filter((r) => r.note)
  if (notes.length) {
    out.push("## 5. Założenia etykiet tam, gdzie spec milczy (⚠ — do decyzji użytkownika)")
    out.push("")
    const seenN = new Set()
    for (const r of notes) {
      const k = `${r.why}|${r.note}`
      if (seenN.has(k)) continue
      seenN.add(k)
      out.push(`- ${r.why}: ${r.note} — np. \`${cell(short(r.command ?? r.path, 110))}\``)
    }
    out.push("")
  }
  return out.join("\n")
}

function main(argv) {
  if (!fs.existsSync(AUDIT_FILE)) console.error(`note: ${AUDIT_FILE} absent — building from session-commands only`)
  const built = buildAll()
  const { rows, res, replayById, corpus } = built
  fs.writeFileSync(path.join(fixturesDir, "expected-decisions.json"), JSON.stringify(rows, null, 1) + "\n")
  // divergences over the WHOLE corpus (not only the listed rows): the labeler is cheap
  const byId = new Map(corpus.map((e) => [e.id, e]))
  const divergences = []
  for (const r of res.entries) {
    const e = byId.get(r.id)
    const l0 = label(e)
    const ov = OVERRIDES[e.id.slice(-6)] ?? OVERRIDES[e.id]
    const l = ov ? { ...l0, ...ov } : l0
    if (l.expected !== r.effect) divergences.push({ id: r.id, expected: l.expected, replay: r.effect, kind: divergenceKind(e, r, l), text: e.command ?? e.path, agent: r.agent })
  }
  fs.writeFileSync(path.join(fixturesDir, "known-divergences.json"), JSON.stringify(divergences.map(({ id, expected, replay, kind }) => ({ id, expected, replay, kind })), null, 1) + "\n")
  const listed = new Set(rows.map((r) => r.id))
  console.log(`rows ${rows.length} (session ${rows.filter((r) => r.group === "session").length}, non-allow ${rows.filter((r) => r.group === "non-allow").length}, sample ${rows.filter((r) => r.group === "sample").length})`)
  console.log(`divergences (whole corpus) ${divergences.length}; among listed rows ${divergences.filter((d) => listed.has(d.id)).length}`)
  const kinds = {}
  for (const d of divergences) kinds[d.kind] = (kinds[d.kind] ?? 0) + 1
  console.log(kinds)
  if (!argv.includes("--no-docs")) {
    fs.writeFileSync(path.join(repoRoot, "docs", "permission-model-expected-decisions.md"), renderDoc(built, divergences) + "\n")
    console.log("wrote docs/permission-model-expected-decisions.md")
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2))
