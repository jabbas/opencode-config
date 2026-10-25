import { test } from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

// Read-only shell profile for restricted agents (spec §4.7a, plan Task 9b).
// Plugin dir: $PM_PLUGIN_DIR (default plugins/permission-model).

const here = path.dirname(fileURLToPath(import.meta.url))
const pluginDir = process.env.PM_PLUGIN_DIR ?? path.resolve(here, "../../plugins/permission-model")
const load = (f) => import(pathToFileURL(path.join(pluginDir, f)).href)
const { reconcile, decideShell } = await load("decide.js")
const { DEFAULTS } = await load("config.js")
const { checkRestricted } = await load("restricted.js")

const HOME = "/Users/test"
const PROJ = "/Users/test/Projects/p"
const TMP = "/tmp/pm-restricted-test"
const cfg = DEFAULTS

const readFile = () => undefined
const ctx = (extra = {}) => ({ cfg, cwd: PROJ, sessionDir: PROJ, home: HOME, tmpRoots: [TMP], env: { TMPDIR: TMP }, readFile, agent: "architect", ...extra })
const run = (cmd, extra) => decideShell(cmd, ctx(extra))

const INCIDENT =
  "cat .git/FETCH_HEAD .git/ORIG_HEAD; grep -v '^#' .git/packed-refs | head -30; ls .git/refs/remotes/origin 2>/dev/null; cat .git/refs/remotes/origin/main 2>/dev/null; ls -la .tekton .github/workflows"

const ALLOW = [
  INCIDENT,
  "echo x 2>/dev/null",
  "ls x 2>&1 | head",
  "ls 1>&2",
  "wc -l f 2>/dev/null",
  "rg foo",
  "rg -n foo docs",
  "/usr/bin/grep x f",
  "jq . opencode.json",
  "sort f | uniq -c",
  "LC_ALL=C sort f",
  "find . -name '*.md'",
  "cd docs && ls",
  "for f in *.md; do head -1 $f; done",
  "diff <(ls a) <(ls b)",
  "timeout 5 cat x",
  "cat <<'EOF'\nhi\nEOF",
  "git status",
  "git status --short",
  "git log --oneline -5",
  "git --no-pager log -1",
  "git -C x log",
  "git diff HEAD~1",
  "git show HEAD:README.md",
  "git branch -a",
  "git branch --contains abc",
  "git tag -l",
  "git tag --list 'v*'",
  "git remote",
  "git remote -v",
  "git remote get-url origin",
  "git stash list",
  "git worktree list",
  "git reflog -5",
  "git config --get user.name",
  "git config --list",
]

const DENY = [
  // writes through redirection
  "cat a > b",
  "echo x >> f",
  "cat x &>out",
  "cat x >&out",
  "cat x <>out",
  "cat x > >(tee f)",
  // writers / interpreters / outside the profile
  "printf x | tee f",
  "mkdir -p d",
  "sed -i s/a/b/ f",
  "sed -n 1p f",
  "awk '{print > \"out\"}' f",
  "python3 -c \"open('f','w').write('x')\"",
  "node -e x",
  "perl -e 1",
  "rm -rf d",
  "cp a b",
  "make test",
  "npm test",
  "kubectl get pods",
  "curl https://example.com",
  "bash $TMPDIR/x.sh",
  "sudo cat /etc/hosts",
  "echo $(rm -rf x)",
  "ls | xargs rm",
  "./docs/cat x",
  "rm .env",
  // forbidden arguments of profile tools
  "find . -name x -delete",
  "find . -exec rm {} +",
  "find $X",
  "ls | xargs find",
  "sort -o out f",
  "sort -no out f",
  "uniq a b",
  "tree -o f",
  "yq -i . f",
  "rg --pre cat x",
  "file -C -m x",
  // git: writes, pager/config injection, unknown verbs
  "git commit -m x",
  "git checkout main",
  "git fetch",
  "git push",
  "git branch newb",
  "git branch -D x",
  "git tag v1",
  "git remote add o u",
  "git stash",
  "git stash pop",
  "git worktree add x",
  "git reflog expire --all",
  "git config user.name x",
  "git config --unset x",
  "git log --output=f",
  "git grep -Ocat x",
  "git -c core.pager=rm log",
  "GIT_PAGER=rm git log",
  "git log $X",
]

for (const cmd of ALLOW) {
  test(`architect allow: ${JSON.stringify(cmd)}`, () => {
    const d = run(cmd)
    assert.equal(d.effect, "allow", JSON.stringify({ effect: d.effect, cls: d.cls, reason: d.reason, message: d.message, tool: d.tool }))
    assert.equal(d.message, undefined)
    assert.ok(!d.passthrough)
  })
}

for (const cmd of DENY) {
  test(`architect deny: ${JSON.stringify(cmd)}`, () => {
    const d = run(cmd)
    assert.equal(d.effect, "deny", JSON.stringify({ effect: d.effect, cls: d.cls, reason: d.reason, tool: d.tool }))
    assert.match(d.message ?? "", /tylko do odczytu/)
    assert.ok(!d.passthrough)
  })
}

test("architect: secrets keep their own decisions", () => {
  const a = run("cat .env")
  assert.equal(a.effect, "ask")
  assert.match(a.message, /dane wrażliwe/)
  const d = run("cat ~/.ssh/id_ed25519")
  assert.equal(d.effect, "deny")
  assert.match(d.message, /twardy zakaz/)
})

test("message names the agent and the offending tool", () => {
  const d = run("git commit -m x")
  assert.match(d.message, /^permission-model: architect ma powłokę tylko do odczytu — git commit/)
  assert.match(d.message, /deleguj/)
  assert.match(run("cat a > b").message, /przekierowanie/)
})

test("every profile agent gets the profile; other agents do not", () => {
  for (const agent of ["architect", "plan", "autopilot", "webscraper", "webresearcher", "webmonitor", "jira", "stitch-mcp"]) {
    assert.equal(run("cat a > b", { agent }).effect, "deny", agent)
    assert.equal(run("git log -1", { agent }).effect, "allow", agent)
  }
  for (const agent of ["coder", "general", "debugger", undefined]) {
    assert.equal(run("cat a > b", { agent }).effect, "allow", String(agent))
    assert.equal(run("git commit -m x", { agent }).effect, "allow", String(agent))
  }
})

test("restricted agent outside the profile list keeps passthrough (e.g. reviewer)", () => {
  const c = { ...cfg, restrictedAgents: [...cfg.restrictedAgents, "reviewer"] }
  const d = run("npm test", { cfg: c, agent: "reviewer" })
  assert.equal(d.passthrough, true)
  assert.equal(reconcile(d, "allow", c), "allow")
  assert.equal(reconcile(d, "deny", c), "deny")
})

test("profile can be switched off per agent list", () => {
  const c = { ...cfg, restrictedShell: { ...cfg.restrictedShell, agents: [] } }
  const d = run("cat a > b", { cfg: c })
  assert.equal(d.passthrough, true)
  assert.equal(reconcile(d, "ask", c), "ask")
})

test("reconcile: profile decision overrides incoming ask/allow, never an incoming deny", () => {
  const ok = run("ls x 2>/dev/null")
  assert.equal(reconcile(ok, "ask", cfg), "allow")
  assert.equal(reconcile(ok, "allow", cfg), "allow")
  assert.equal(reconcile(ok, "deny", cfg), "deny")
  const bad = run("cat a > b")
  assert.equal(reconcile(bad, "allow", cfg), "deny") // a saved "Always" does not widen the profile
  assert.equal(reconcile(bad, "ask", cfg), "deny")
  const sec = run("cat .env")
  assert.equal(reconcile(sec, "allow", cfg), "ask")
})

test("checkRestricted: unit shapes", () => {
  const inv = (tool, args = [], extra = {}) => ({ tool, args, redirects: [], env: {}, wrapped: [], unresolved: false, ...extra })
  assert.deepEqual(checkRestricted(inv("cat", ["x"]), cfg), { ok: true })
  assert.equal(checkRestricted(inv("cat", ["x"], { redirects: [{ op: ">", target: "/dev/null" }] }), cfg).ok, true)
  assert.equal(checkRestricted(inv("cat", ["x"], { redirects: [{ op: "2>&1", target: "1" }] }), cfg).ok, true)
  assert.equal(checkRestricted(inv("cat", ["x"], { redirects: [{ op: ">", target: "f" }] }), cfg).ok, false)
  assert.equal(checkRestricted(inv("rm", ["x"]), cfg).ok, false)
  assert.equal(checkRestricted(inv("cat", [], { env: { PAGER: "x" } }), cfg).ok, false)
  assert.equal(checkRestricted(inv("sort", ["f"], { env: { LC_ALL: "C" } }), cfg).ok, true)
  const r = checkRestricted(inv("git", ["commit", "-m", "x"]), cfg)
  assert.equal(r.ok, false)
  assert.equal(r.what, "git commit")
  // empty / missing config section -> nothing is allowed (fail closed)
  assert.equal(checkRestricted(inv("cat", ["x"]), {}).ok, false)
})
