import { test } from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const pluginDir = process.env.PM_PLUGIN_DIR ?? path.resolve(here, "../../plugins/permission-model")
const load = (f) => import(pathToFileURL(path.join(pluginDir, f)).href)
const { decide, reconcile, decideShell } = await load("decide.js")
const { DEFAULTS } = await load("config.js")
const msgs = await load("messages.js")

const HOME = "/Users/test"
const PROJ = "/Users/test/Projects/p"
const TMP = "/tmp/pm-decide-test"
const cfg = DEFAULTS

const readFile = (p) => (p.endsWith("/.kube/config") ? "apiVersion: v1\ncurrent-context: admin@k8s\n" : undefined)
const ctx = (extra = {}) => ({ cfg, cwd: PROJ, sessionDir: PROJ, home: HOME, tmpRoots: [TMP], env: { TMPDIR: TMP }, readFile, ...extra })
const run = (cmd, extra) => decideShell(cmd, ctx(extra))

const cases = [
  // [command, effect, extra ctx, message substrings]
  ["kubectl apply -f x", "allow"],
  ["kubectl delete ns flux-system", "ask", {}, ["nieodwracalna", "admin@k8s"]],
  ["kubectl --context kind-x delete ns foo", "allow"],
  ["kubectl --context kind-x delete ns kube-system", "ask", {}, ["nieodwracalna", "kind-x"]],
  ["kubectl --context kind-x delete pod foo -n kube-system", "ask"],
  ["kubectl --context kind-x delete pod foo -A", "ask"],
  ["kubectl --context prod-eu1 apply -f x", "ask", {}, ["prod", "prod-eu1"]],
  ["aws --profile p-dev s3 cp ./x s3://b/k", "allow"],
  ["aws s3 rm s3://b --recursive", "ask"],
  ["git push origin main", "allow"],
  ["git push --force origin main", "ask", {}, ["nieodwracalna"]],
  ["gh pr create --fill", "allow"],
  ["gh repo delete a/b", "ask"],
  ["cargo test && git commit -m x", "allow"],
  ["ls; kubectl delete ns x", "ask"],
  ["cat ~/.ssh/id_x", "deny", {}, ["twardy zakaz"]],
  ["cat .env", "ask", {}, ["dane wrażliwe"]],
  ["echo x > ~/.config/opencode/opencode.json", "ask", {}, ["własnej konfiguracji"]],
  ["echo x >&~/.config/opencode/opencode.json", "ask", {}, ["własnej konfiguracji"]],
  ["echo x <>~/.config/opencode/agents/coder.md", "ask", {}, ["własnej konfiguracji"]],
  ["echo x >&~/.ssh/id_x", "deny", {}, ["twardy zakaz"]],
  ["ls x 2>&1 >&2", "allow"],
  ["bash $TMPDIR/x.sh", "ask", {}, ["skrypt z tmp", "podaj cel dosłownie"]],
  ["sudo ls", "ask", {}, ["zmiana systemu", "sudo"]],
  ["kill $!", "allow"],
  ["ssh esp.iot ls", "allow", { agent: "ha" }],
  ["ssh esp.iot ls", "ask", { agent: "coder" }],
  ["", "allow"],
  ["   ", "allow"],
  ["for f in a b; do echo $f; done", "allow"],
  ["ls", "allow"],
]

for (const [cmd, effect, extra, subs] of cases) {
  test(`decideShell: ${JSON.stringify(cmd)}${extra?.agent ? ` [${extra.agent}]` : ""} -> ${effect}`, () => {
    const d = run(cmd, extra)
    assert.equal(d.effect, effect, JSON.stringify(d, null, 1))
    for (const s of subs ?? []) assert.ok(d.message?.includes(s), `message ${JSON.stringify(d.message)} lacks ${JSON.stringify(s)}`)
    if (effect === "allow") assert.equal(d.message, undefined)
  })
}

test("decideShell: result carries the target and cls of the strictest invocation", () => {
  const d = run("ls; kubectl delete ns x")
  assert.equal(d.cls, "irreversible")
  assert.equal(d.target.kind, "k8s")
  assert.equal(d.target.name, "admin@k8s")
  assert.equal(d.targetCls, "home")
})

test("decideShell: deny beats ask", () => {
  const d = run("kubectl delete ns x; cat ~/.ssh/id_x")
  assert.equal(d.effect, "deny")
  assert.equal(d.cls, "secret-deny")
})

// passthrough = restricted agent WITHOUT the read-only shell profile (spec §4.7a; profile agents: test-restricted.mjs)
const noProfile = { ...cfg, restrictedShell: { ...cfg.restrictedShell, agents: [] } }

test("decideShell: restricted agent without profile -> passthrough, reconcile returns incoming", () => {
  const d = run("kubectl get pods", { agent: "architect", cfg: noProfile })
  assert.equal(d.passthrough, true)
  assert.equal(reconcile(d, "deny", noProfile), "deny")
  assert.equal(reconcile(d, "allow", noProfile), "allow")
  assert.equal(reconcile(d, "ask", noProfile), "ask")
})

test("decideShell: restricted agent with profile -> profile decision, no passthrough", () => {
  const d = run("kubectl get pods", { agent: "architect" })
  assert.equal(d.profile, true)
  assert.ok(!d.passthrough)
  assert.equal(d.effect, "deny")
  assert.equal(reconcile(d, "allow", cfg), "deny")
})

test("decideShell: restricted agent still gets secret-deny", () => {
  const d = run("cat ~/.ssh/id_x", { agent: "architect" })
  assert.equal(d.effect, "deny")
  assert.ok(!d.passthrough)
  assert.equal(reconcile(d, "allow", cfg), "deny")
})

test("decideShell: a throwing classifier -> ask / ERROR", () => {
  const broken = { ...cfg, readVerbs: { ...cfg.readVerbs, kubectl: [null] } }
  const d = run("kubectl get pods", { cfg: broken })
  assert.equal(d.effect, "ask")
  assert.equal(d.cls, "ERROR")
  assert.match(d.message, /^permission-model: błąd pluginu \(.+\) — pytam dla bezpieczeństwa$/)
})

test("decideShell: missing cfg never throws", () => {
  const d = decideShell("ls", {})
  assert.equal(d.effect, "ask")
  assert.equal(d.cls, "ERROR")
})

// ---- decide() unit table ----

const T = (kind, cls, name) => ({ kind, cls, name, source: "test" })

test("decide: class table", () => {
  const e = (c, t, inv) => decide(c, t, cfg, { inv }).effect
  const k8s = (cls, name = "ctx") => T("k8s", cls, name)
  assert.equal(e({ cls: "local-read" }, T("local", "local")), "allow")
  assert.equal(e({ cls: "local-write" }, T("local", "local")), "allow")
  assert.equal(e({ cls: "ext-read", verb: "get" }, k8s("prod")), "allow")
  assert.equal(e({ cls: "local-ask" }, T("local", "local"), { tool: "sudo", args: [] }), "ask")
  assert.equal(e({ cls: "ext-write", verb: "apply" }, k8s("dev")), "allow")
  assert.equal(e({ cls: "ext-write", verb: "apply" }, k8s("home"), { tool: "kubectl", args: [] }), "allow")
  assert.equal(e({ cls: "ext-write", verb: "delete" }, k8s("home"), { tool: "kubectl", args: [] }), "ask")
  assert.equal(e({ cls: "ext-write", verb: "apply" }, k8s("prod"), { tool: "kubectl", args: [] }), "ask")
  assert.equal(e({ cls: "ext-write", verb: "apply" }, k8s("unknown"), { tool: "kubectl", args: [] }), "ask")
  assert.equal(e({ cls: "ext-write", verb: "x" }, T("local", "local"), { tool: "foo", args: [] }), "ask")
  assert.equal(e({ cls: "irreversible", verb: "delete" }, k8s("dev"), { tool: "kubectl", args: ["delete", "ns", "foo"] }), "allow")
  assert.equal(e({ cls: "irreversible", verb: "delete" }, k8s("dev"), { tool: "kubectl", args: ["delete", "ns", "flux-system"] }), "ask")
  assert.equal(e({ cls: "irreversible", verb: "delete" }, k8s("dev"), { tool: "kubectl", args: ["delete", "pod", "x", "--namespace=kube-system"] }), "ask")
  assert.equal(e({ cls: "irreversible", verb: "delete", detail: "kubectl delete in protected namespace / all namespaces" }, k8s("dev")), "ask")
  assert.equal(e({ cls: "irreversible", verb: "delete" }, k8s("home"), { tool: "kubectl", args: [] }), "ask")
  assert.equal(e({ cls: "secret-ask" }, T("local", "local")), "ask")
  assert.equal(e({ cls: "own-config" }, T("local", "local")), "ask")
  assert.equal(e({ cls: "opaque" }, T("local", "local")), "ask")
  assert.equal(e({ cls: "secret-deny" }, T("local", "local")), "deny")
  assert.equal(e({ cls: "bogus" }, T("local", "local")), "ask")
})

test("decide: cloud targets — gh/git are home, the rest prod", () => {
  const cloud = (name) => T("cloud", "prod", name)
  const gh = (verb) => decide({ cls: "ext-write", verb }, cloud("gh"), cfg, { inv: { tool: "gh", args: [] } })
  assert.equal(gh("pr create").effect, "allow")
  assert.equal(gh("issue comment").effect, "allow")
  assert.equal(gh("api").effect, "ask")
  const w = decide({ cls: "ext-write", verb: "deploy" }, cloud("wrangler"), cfg, { inv: { tool: "wrangler", args: [] } })
  assert.equal(w.effect, "ask")
  assert.match(w.message, /zapis na prod/)
  const irr = decide({ cls: "irreversible", verb: "repo delete" }, cloud("gh"), cfg, { inv: { tool: "gh", args: [] } })
  assert.equal(irr.effect, "ask")
})

test("decide: restricted agent without profile flags passthrough", () => {
  const d = decide({ cls: "ext-write", verb: "apply" }, T("k8s", "prod", "c"), noProfile, { agent: "jira", inv: { tool: "kubectl", args: [] } })
  assert.equal(d.passthrough, true)
  const s = decide({ cls: "secret-deny" }, T("local", "local"), noProfile, { agent: "jira" })
  assert.equal(s.effect, "deny")
  assert.ok(!s.passthrough)
})

test("decide: profile agent — shell inv judged by the profile, no inv (path) -> passthrough", () => {
  const d = decide({ cls: "ext-write", verb: "apply" }, T("k8s", "prod", "c"), cfg, { agent: "jira", inv: { tool: "kubectl", args: [] } })
  assert.equal(d.effect, "deny")
  assert.equal(d.profile, true)
  assert.ok(!d.passthrough)
  const p = decide({ cls: "local-read" }, T("local", "local"), cfg, { agent: "jira" })
  assert.equal(p.passthrough, true)
})

// ---- reconcile ----

test("reconcile: Always per class", () => {
  const mk = (cls, targetCls, effect) => ({ cls, targetCls, effect })
  assert.equal(reconcile(mk("ext-write", "dev", "allow"), "allow", cfg), "allow")
  assert.equal(reconcile(mk("ext-write", "home", "ask"), "allow", cfg), "allow")
  assert.equal(reconcile(mk("ext-write", "prod", "ask"), "allow", cfg), "ask")
  assert.equal(reconcile(mk("ext-write", "unknown", "ask"), "allow", cfg), "ask")
  assert.equal(reconcile(mk("irreversible", "home", "ask"), "allow", cfg), "ask")
  assert.equal(reconcile(mk("secret-ask", "local", "ask"), "allow", cfg), "ask")
  assert.equal(reconcile(mk("own-config", "local", "ask"), "allow", cfg), "ask")
  assert.equal(reconcile(mk("opaque", "local", "ask"), "allow", cfg), "ask")
  assert.equal(reconcile(mk("local-ask", "local", "ask"), "allow", cfg), "ask")
  assert.equal(reconcile(mk("local-read", "local", "allow"), "deny", cfg), "deny")
  assert.equal(reconcile(mk("local-write", "local", "allow"), "allow", cfg), "allow")
  assert.equal(reconcile(mk("ext-read", "prod", "allow"), "allow", cfg), "allow")
  assert.equal(reconcile(mk("secret-deny", "local", "deny"), "allow", cfg), "deny")
  assert.equal(reconcile(mk("ext-write", "prod", "ask"), "deny", cfg), "deny")
  assert.equal(reconcile(mk("ext-write", "dev", "allow"), "ask", cfg), "allow")
})

// ---- messages ----

test("messages: exact templates", () => {
  assert.equal(
    msgs.writeAsk({ cls: "prod", kind: "k8s", name: "prod-eu1", tool: "kubectl", verb: "apply" }),
    "permission-model: zapis na prod (k8s prod-eu1): kubectl apply — wymaga zgody",
  )
  assert.equal(
    msgs.irreversible({ cls: "home", kind: "k8s", name: "admin@k8s", tool: "kubectl", verb: "delete" }),
    "permission-model: operacja nieodwracalna na k8s admin@k8s (home): kubectl delete",
  )
  assert.equal(msgs.unknownTarget("skrypt z tmp"), "permission-model: cel nieznany (skrypt z tmp) — podaj cel dosłownie")
  assert.equal(msgs.secretAsk(".env"), "permission-model: dane wrażliwe: .env")
  assert.equal(msgs.secretDeny("~/.ssh/id_x"), "permission-model: twardy zakaz — dane wrażliwe: ~/.ssh/id_x")
  assert.equal(msgs.ownConfig("~/.zsh/x"), "permission-model: zapis własnej konfiguracji: ~/.zsh/x")
  assert.equal(msgs.systemChange("sudo"), "permission-model: zmiana systemu lub innej maszyny: sudo")
  assert.equal(msgs.pluginError("boom"), "permission-model: błąd pluginu (boom) — pytam dla bezpieczeństwa")
  assert.equal(msgs.clsLabel("unknown"), "nieznany")
  assert.equal(msgs.clsLabel("local"), "lokalnie")
})

test("messages: verb clipped to 60 characters", () => {
  const long = "x".repeat(200)
  const m = msgs.writeAsk({ cls: "prod", kind: "k8s", name: "c", tool: "kubectl", verb: long })
  const verbPart = m.split("kubectl ")[1].replace(" — wymaga zgody", "")
  assert.ok(verbPart.length <= 60, verbPart.length)
})
