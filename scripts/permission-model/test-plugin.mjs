import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const pluginDir = process.env.PM_PLUGIN_DIR ?? path.resolve(here, "../../plugins/permission-model")
const load = (f) => import(pathToFileURL(path.join(pluginDir, f)).href)
const { createPlugin } = await load("index.js")
const { createCorrelator } = await load("session.js")
const { appendLog, redactResource } = await load("log.js")

const HOME = os.homedir()
const base = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "pm-plugin-"))
const S = path.join(base, "session")
fs.mkdirSync(path.join(S, "sub"), { recursive: true })

/** Build a plugin instance on a fake ctx; returns the recorded hooks and helpers. */
async function mk({ mode = "enforce", deps, sessionDirectory = S, cfg = {}, sessionGet, envDir = true, home, rawConfig, alive } = {}) {
  const dir = fs.mkdtempSync(path.join(base, "case-"))
  const cfgFile = path.join(dir, "permission-model.json")
  if (rawConfig !== null) fs.writeFileSync(cfgFile, rawConfig ?? JSON.stringify({ mode, ...cfg })) // null = no config file
  const logFile = path.join(dir, "log", "decisions.jsonl")
  const aliveFile = path.join(dir, "alive", "alive")
  if (alive !== undefined) {
    fs.mkdirSync(path.dirname(aliveFile), { recursive: true })
    fs.writeFileSync(aliveFile, typeof alive === "string" ? alive : JSON.stringify(alive))
  }
  if (envDir) process.env.PM_CONFIG_DIR = dir
  else delete process.env.PM_CONFIG_DIR
  process.env.PM_LOG_FILE = logFile
  process.env.PM_ALIVE_FILE = aliveFile
  const hooks = {}
  const ctx = {
    tool: { hook: async (name, fn) => void (hooks[`tool.${name}`] = fn) },
    permission: { hook: async (name, fn) => void (hooks[`permission.${name}`] = fn) },
    session: { get: sessionGet ?? (async () => ({ location: { directory: sessionDirectory } })) },
    location: { directory: sessionDirectory },
  }
  const realHome = process.env.HOME
  if (home) process.env.HOME = home
  try {
    await createPlugin(deps).setup(ctx)
  } finally {
    process.env.HOME = realHome
  }
  let n = 0
  return {
    dir,
    cfgFile,
    before: (command, extra = {}) => {
      const id = `call-${++n}`
      hooks["tool.execute.before"]({ tool: "shell", sessionID: "s1", agent: "build", messageID: "m1", id, input: { command, ...extra } })
      return id
    },
    evaluate: async (ev) => {
      const e = { sessionID: "s1", agent: "build", effect: "allow", ...ev }
      await hooks["permission.evaluate"](e)
      return e
    },
    log: () => (fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []),
    aliveFile,
    hooks,
  }
}

const shell = (id, resources, extra = {}) => ({ action: "shell", resources, source: { type: "tool", messageID: "m1", id }, ...extra })

test("shadow leaves effect, logs decided", async () => {
  const p = await mk({ mode: "shadow" })
  const id = p.before("kubectl delete ns flux-system")
  const ev = await p.evaluate(shell(id, ["kubectl delete ns flux-system"], { effect: "allow" }))
  assert.equal(ev.effect, "allow")
  assert.equal(ev.message, undefined)
  const [l] = p.log()
  assert.equal(l.decided, "ask")
  assert.equal(l.incoming, "allow")
  assert.equal(l.applied, "allow")
  assert.equal(l.mode, "shadow")
  assert.equal(l.action, "shell")
  assert.equal(l.sessionID, "s1")
  assert.equal(l.agent, "build")
  assert.equal(typeof l.ms, "number")
  assert.ok(Date.parse(l.ts) > 0)
})

test("enforce applies", async () => {
  const p = await mk()
  const id = p.before("kubectl delete ns flux-system")
  const ev = await p.evaluate(shell(id, ["kubectl delete ns flux-system"]))
  assert.equal(ev.effect, "ask")
  assert.match(ev.message, /permission-model/)
  const [l] = p.log()
  assert.equal(l.applied, "ask")
  assert.equal(l.decided, "ask")
  assert.equal(l.mode, "enforce")
  assert.equal(l.target.kind, "k8s")
})

test("incoming deny untouched", async () => {
  const p = await mk()
  const id = p.before("ls")
  const ev = await p.evaluate(shell(id, ["ls"], { effect: "deny", message: "native" }))
  assert.equal(ev.effect, "deny")
  assert.equal(ev.message, "native")
})

test("correlated beats fragments", async () => {
  const p = await mk()
  const id = p.before("cd sub && echo > a.txt")
  const ev = await p.evaluate(shell(id, ["echo > a.txt"], { effect: "allow" }))
  assert.equal(ev.effect, "allow")
  const [l] = p.log()
  assert.equal(l.resource, "cd sub && echo > a.txt")
  assert.equal(l.decided, "allow")
  assert.equal(l.target.name, path.join(S, "sub", "a.txt"))
  assert.notEqual(l.reason, "uncorrelated")
})

test("correlated honours workdir", async () => {
  const p = await mk()
  const id = p.before("echo > a.txt", { workdir: "sub" })
  await p.evaluate(shell(id, ["echo > a.txt"]))
  assert.equal(p.log()[0].target.name, path.join(S, "sub", "a.txt"))
})

test("uncorrelated analyzes resources", async () => {
  const p = await mk()
  const ev = await p.evaluate(shell("nope", ["ls", "kubectl delete ns x"]))
  assert.equal(ev.effect, "ask")
  const [l] = p.log()
  assert.equal(l.reason, "uncorrelated")
  assert.equal(l.resource, "kubectl delete ns x")
})

test("read .env asks", async () => {
  const p = await mk()
  const ev = await p.evaluate({ action: "read", resources: [".env"], effect: "allow" })
  assert.equal(ev.effect, "ask")
  assert.match(ev.message, /dane wrażliwe/)
  const [l] = p.log()
  assert.equal(l.cls, "secret-ask")
  assert.equal(l.action, "read")
})

test("read .env.example untouched", async () => {
  const p = await mk()
  const ev = await p.evaluate({ action: "read", resources: [".env.example"], effect: "allow" })
  assert.equal(ev.effect, "allow")
})

test("edit agents/x.md asks", async () => {
  const p = await mk()
  const ev = await p.evaluate({ action: "edit", resources: [path.join(HOME, ".config/opencode/agents/x.md")], effect: "allow" })
  assert.equal(ev.effect, "ask")
  assert.equal(p.log()[0].cls, "own-config")
})

test("edit relative agents/x.md in a configDir-like session asks", async () => {
  const p = await mk({ sessionDirectory: path.join(HOME, ".config/opencode") })
  const ev = await p.evaluate({ action: "edit", resources: ["agents/x.md"], effect: "allow" })
  assert.equal(ev.effect, "ask")
  assert.equal(p.log()[0].cls, "own-config")
})

test("write is handled like edit", async () => {
  const p = await mk()
  const ev = await p.evaluate({ action: "write", resources: [path.join(HOME, ".config/opencode/agents/x.md")], effect: "allow" })
  assert.equal(ev.effect, "ask")
})

test("read ~/.ssh/id_x denies", async () => {
  const p = await mk()
  const ev = await p.evaluate({ action: "read", resources: [path.join(HOME, ".ssh/id_x")], effect: "ask" })
  assert.equal(ev.effect, "deny")
  assert.match(ev.message, /twardy zakaz/)
})

test("path action keeps incoming ask when plugin does not care", async () => {
  const p = await mk()
  const ev = await p.evaluate({ action: "read", resources: ["README.md"], effect: "ask" })
  assert.equal(ev.effect, "ask")
})

test("restricted agent passes through", async () => {
  const p = await mk()
  const id = p.before("cat x")
  const ev = await p.evaluate(shell(id, ["cat x"], { agent: "architect", effect: "ask" }))
  assert.equal(ev.effect, "ask")
  const id2 = p.before("cat x")
  const ev2 = await p.evaluate(shell(id2, ["cat x"], { agent: "architect", effect: "allow" }))
  assert.equal(ev2.effect, "allow")
  const id3 = p.before(`cat ${HOME}/.ssh/id_x`)
  const ev3 = await p.evaluate(shell(id3, [`cat ${HOME}/.ssh/id_x`], { agent: "architect", effect: "ask" }))
  assert.equal(ev3.effect, "deny")
  const ev4 = await p.evaluate({ action: "read", resources: [".env"], agent: "architect", effect: "allow" })
  assert.equal(ev4.effect, "allow")
  const ev5 = await p.evaluate({ action: "read", resources: [path.join(HOME, ".ssh/id_x")], agent: "architect", effect: "allow" })
  assert.equal(ev5.effect, "deny")
})

test("error -> ask", async () => {
  const orig = console.error
  console.error = () => {}
  try {
    const p = await mk({
      deps: {
        decideShell: () => {
          throw new Error("boom")
        },
      },
    })
    const id = p.before("ls")
    const ev = await p.evaluate(shell(id, ["ls"], { effect: "allow" }))
    assert.equal(ev.effect, "ask")
    assert.match(ev.message, /błąd pluginu \(boom\)/)
    const [l] = p.log()
    assert.equal(l.cls, "ERROR")
    assert.equal(l.applied, "ask")
    // incoming deny stays deny
    const ev2 = await p.evaluate(shell(id, ["ls"], { effect: "deny" }))
    assert.equal(ev2.effect, "deny")
  } finally {
    console.error = orig
  }
})

test("error in shadow does not touch ev but logs ERROR", async () => {
  const orig = console.error
  console.error = () => {}
  try {
    const p = await mk({
      mode: "shadow",
      deps: {
        decideShell: () => {
          throw new Error("boom")
        },
      },
    })
    const id = p.before("ls")
    const ev = await p.evaluate(shell(id, ["ls"], { effect: "allow" }))
    assert.equal(ev.effect, "allow")
    assert.equal(p.log()[0].cls, "ERROR")
  } finally {
    console.error = orig
  }
})

test("timeout -> ask", async () => {
  const p = await mk({ deps: { decideShell: () => new Promise(() => {}) } })
  const id = p.before("ls")
  const t0 = Date.now()
  const ev = await p.evaluate(shell(id, ["ls"], { effect: "allow" }))
  const dt = Date.now() - t0
  assert.ok(dt >= 240 && dt < 1500, `took ${dt}ms`)
  assert.equal(ev.effect, "ask")
  assert.match(ev.message, /timeout/)
  assert.equal(p.log()[0].cls, "ERROR")
})

test("log redacts heredoc and truncates", async () => {
  const p = await mk({ mode: "shadow" })
  const cmd = "cat > f <<'EOF'\nSECRETBODY line\nEOF\necho API_TOKEN=abc123 password=hunter2"
  const id = p.before(cmd)
  await p.evaluate(shell(id, [cmd]))
  const [l] = p.log()
  assert.ok(l.resource.includes("<<heredoc>>"))
  assert.ok(!l.resource.includes("SECRETBODY"))
  assert.ok(!l.resource.includes("abc123"))
  assert.ok(!l.resource.includes("hunter2"))
  assert.ok(l.resource.includes("password=<redacted>"))
  const long = "echo " + "x".repeat(1000)
  const id2 = p.before(long)
  await p.evaluate(shell(id2, [long]))
  assert.equal(p.log()[1].resource.length, 300)
})

test("redactResource / appendLog unit", () => {
  assert.equal(redactResource("cat <<EOF\nabc\nEOF"), "cat <<heredoc>>")
  assert.equal(redactResource("a secret=zzz b"), "a secret=<redacted> b")
  const f = path.join(base, "unit", "x.jsonl")
  assert.equal(appendLog(f, { resource: "y".repeat(500), n: 1 }), true)
  assert.equal(JSON.parse(fs.readFileSync(f, "utf8")).resource.length, 300)
  assert.equal(appendLog("/proc/definitely/not/writable/x", { resource: "y" }), false)
})

test("correlator ttl", () => {
  let t = 1000
  const c = createCorrelator(120000, 500, () => t)
  c.put("a", { command: "ls" })
  t += 119999
  assert.deepEqual(c.get("a"), { command: "ls" })
  t += 2
  assert.equal(c.get("a"), undefined)
  assert.equal(c.size, 0)
})

test("correlator cap", () => {
  const c = createCorrelator(120000, 3)
  for (const k of ["a", "b", "c", "d"]) c.put(k, { command: k })
  assert.equal(c.get("a"), undefined)
  assert.deepEqual(c.get("d"), { command: "d" })
  assert.equal(c.size, 3)
})

test("alive marker written with mode", async () => {
  const p = await mk({ mode: "enforce" })
  const a = JSON.parse(fs.readFileSync(p.aliveFile, "utf8"))
  assert.equal(a.mode, "enforce")
  assert.equal(a.pid, process.pid)
  assert.equal(a.version, "1")
  assert.ok(Math.abs(Date.now() - a.ts) < 10000)
  const s = await mk({ mode: "shadow" })
  assert.equal(JSON.parse(fs.readFileSync(s.aliveFile, "utf8")).mode, "shadow")
})

test("other actions untouched and unlogged", async () => {
  const p = await mk()
  const ev = await p.evaluate({ action: "external_directory", resources: ["/etc/*"], effect: "ask", message: "m" })
  assert.equal(ev.effect, "ask")
  assert.equal(ev.message, "m")
  const ev2 = await p.evaluate({ action: "grep", resources: ["x"], effect: "allow" })
  assert.equal(ev2.effect, "allow")
  assert.equal(p.log().length, 0)
})

test("non-shell tool calls are not stashed", async () => {
  const p = await mk()
  p.hooks["tool.execute.before"]({ tool: "read", sessionID: "s1", id: "r1", input: { command: "kubectl delete ns x" } })
  const ev = await p.evaluate(shell("r1", ["ls"]))
  assert.equal(ev.effect, "allow")
  assert.equal(p.log()[0].reason, "uncorrelated")
})

// ---- fix round 1 ----

const quiet = async (fn) => {
  const orig = console.error
  const lines = []
  console.error = (...a) => lines.push(a.join(" "))
  try {
    await fn(lines)
  } finally {
    console.error = orig
  }
}

test("stalled ctx.session.get -> ask (shell and read)", async () => {
  await quiet(async () => {
    const p = await mk({ sessionGet: () => new Promise(() => {}) })
    const id = p.before("ls")
    const t0 = Date.now()
    const ev = await p.evaluate(shell(id, ["ls"], { effect: "allow" }))
    assert.ok(Date.now() - t0 < 1500)
    assert.equal(ev.effect, "ask")
    assert.match(ev.message, /błąd pluginu \(timeout\)/)
    const ev2 = await p.evaluate({ action: "read", resources: ["README.md"], effect: "allow" })
    assert.equal(ev2.effect, "ask")
    assert.equal(p.log().every((l) => l.cls === "ERROR"), true)
  })
})

test("enforce + broken config JSON -> ask with config message, CONFIG_ERROR logged once per reload", async () => {
  await quiet(async () => {
    const p = await mk({ mode: "enforce", deps: { cfgTtlMs: 0 } })
    assert.equal((await p.evaluate({ action: "read", resources: ["README.md"], effect: "allow" })).effect, "allow")
    fs.writeFileSync(p.cfgFile, "{ broken")
    const id = p.before("ls")
    const ev = await p.evaluate(shell(id, ["ls"], { effect: "allow" }))
    assert.equal(ev.effect, "ask")
    assert.match(ev.message, /^permission-model: błąd konfiguracji \(invalid JSON in permission-model\.json.*\) — pytam dla bezpieczeństwa$/)
    const errs = p.log().filter((l) => l.cls === "CONFIG_ERROR")
    assert.equal(errs.length, 1)
    assert.equal(errs[0].applied, "ask")
    assert.match(errs[0].reason, /invalid JSON/)
    // incoming deny is never softened
    assert.equal((await p.evaluate(shell(id, ["ls"], { effect: "deny" }))).effect, "deny")
    // path actions too
    assert.equal((await p.evaluate({ action: "read", resources: ["README.md"], effect: "allow" })).effect, "ask")
    // restricted agents are not touched
    assert.equal((await p.evaluate({ action: "read", resources: ["README.md"], agent: "architect", effect: "allow" })).effect, "allow")
    // other actions are still ignored
    assert.equal((await p.evaluate({ action: "grep", resources: ["x"], effect: "allow" })).effect, "allow")
    // fixing the file (deliberately shadow) ends the lockdown
    fs.writeFileSync(p.cfgFile, JSON.stringify({ mode: "shadow" }))
    assert.equal((await p.evaluate({ action: "read", resources: ["README.md"], effect: "allow" })).effect, "allow")
  })
})

test("config is reloaded only after the ttl; a non-object config also locks enforce down", async () => {
  await quiet(async () => {
    const p = await mk({ mode: "enforce", deps: { cfgTtlMs: 60000 } })
    fs.writeFileSync(p.cfgFile, "[]")
    // no reload yet (ttl) -> still the good config; nothing logged
    assert.equal((await p.evaluate({ action: "read", resources: ["README.md"], effect: "allow" })).effect, "allow")
    assert.equal(p.log().filter((l) => l.cls === "CONFIG_ERROR").length, 0)
  })
  await quiet(async () => {
    const p = await mk({ mode: "enforce", deps: { cfgTtlMs: 0 } })
    await p.evaluate({ action: "read", resources: ["README.md"], effect: "allow" })
    fs.writeFileSync(p.cfgFile, "[]")
    const ev = await p.evaluate({ action: "read", resources: ["README.md"], effect: "allow" })
    assert.equal(ev.effect, "ask")
    assert.match(ev.message, /expected a JSON object/)
  })
})

test("shadow + broken config -> untouched, CONFIG_ERROR logged", async () => {
  await quiet(async () => {
    const p = await mk({ mode: "shadow", deps: { cfgTtlMs: 0 } })
    fs.writeFileSync(p.cfgFile, "{ broken")
    const id = p.before("ls")
    const ev = await p.evaluate(shell(id, ["ls"], { effect: "allow" }))
    assert.equal(ev.effect, "allow")
    assert.equal(ev.message, undefined)
    const l = p.log().find((x) => x.cls === "CONFIG_ERROR")
    assert.ok(l)
    assert.equal(l.mode, "shadow")
    assert.equal(l.applied, "allow")
  })
})

test("derived configDir without config files falls back to ~/.config/opencode (+ warning once)", async () => {
  const fake = path.join(base, "fake-no-config")
  fs.mkdirSync(path.join(fake, "plugins", "permission-model"), { recursive: true })
  const home = path.join(base, "home-a")
  fs.mkdirSync(path.join(home, ".config", "opencode"), { recursive: true })
  fs.writeFileSync(path.join(home, ".config", "opencode", "permission-model.json"), JSON.stringify({ mode: "enforce" }))
  await quiet(async (lines) => {
    const p = await mk({ envDir: false, home, mode: "shadow", deps: { pluginUrl: pathToFileURL(path.join(fake, "plugins", "permission-model", "index.js")).href } })
    assert.equal(JSON.parse(fs.readFileSync(p.aliveFile, "utf8")).mode, "enforce")
    const warns = lines.filter((l) => l.includes("neither opencode.json nor permission-model.json"))
    assert.equal(warns.length, 1)
  })
})

test("derived configDir holding permission-model.json or opencode.json is accepted", async () => {
  const home = path.join(base, "home-b")
  fs.mkdirSync(path.join(home, ".config", "opencode"), { recursive: true })
  for (const marker of ["permission-model.json", "opencode.json"]) {
    const fake = path.join(base, `fake-${marker}`)
    fs.mkdirSync(path.join(fake, "plugins", "permission-model"), { recursive: true })
    fs.writeFileSync(path.join(fake, marker), marker === "opencode.json" ? "{}" : JSON.stringify({ mode: "enforce" }))
    await quiet(async (lines) => {
      const p = await mk({ envDir: false, home, mode: "shadow", deps: { pluginUrl: pathToFileURL(path.join(fake, "plugins", "permission-model", "index.js")).href } })
      assert.equal(JSON.parse(fs.readFileSync(p.aliveFile, "utf8")).mode, marker === "opencode.json" ? "shadow" : "enforce")
      assert.equal(lines.filter((l) => l.includes("neither")).length, 0)
    })
  }
})

test("last known good mode survives a plugin reload via the alive marker", async () => {
  await quiet(async () => {
    const p = await mk({ rawConfig: "{ broken", alive: { pid: 1, ts: 1, mode: "enforce", version: "1" } })
    const id = p.before("ls")
    const ev = await p.evaluate(shell(id, ["ls"], { effect: "allow" }))
    assert.equal(ev.effect, "ask")
    assert.match(ev.message, /błąd konfiguracji/)
    assert.equal(p.log().filter((l) => l.cls === "CONFIG_ERROR").length, 1)
    // the marker keeps saying enforce while locked down
    assert.equal(JSON.parse(fs.readFileSync(p.aliveFile, "utf8")).mode, "enforce")
  })
  await quiet(async () => {
    // marker says shadow, or is garbage -> no lockdown
    for (const alive of [{ mode: "shadow" }, "not json"]) {
      const p = await mk({ rawConfig: "{ broken", alive })
      const id = p.before("ls")
      const ev = await p.evaluate(shell(id, ["ls"], { effect: "allow" }))
      assert.equal(ev.effect, "allow")
      assert.equal(p.log().filter((l) => l.cls === "CONFIG_ERROR").length, 1)
    }
  })
})

test("missing primary config does not lower a known enforce", async () => {
  await quiet(async () => {
    // marker says enforce + no config file -> lockdown
    const p = await mk({ rawConfig: null, alive: { mode: "enforce" } })
    const id = p.before("ls")
    const ev = await p.evaluate(shell(id, ["ls"], { effect: "allow" }))
    assert.equal(ev.effect, "ask")
    assert.match(ev.message, /błąd konfiguracji \(permission-model\.json missing\)/)
    const errs = p.log().filter((l) => l.cls === "CONFIG_ERROR")
    assert.equal(errs.length, 1)
    assert.equal(errs[0].reason, "permission-model.json missing")
    // no marker / shadow marker + no config file -> plain defaults (shadow), no lockdown
    for (const alive of [undefined, { mode: "shadow" }]) {
      const q = await mk({ rawConfig: null, alive })
      const id2 = q.before("ls")
      const ev2 = await q.evaluate(shell(id2, ["ls"], { effect: "allow" }))
      assert.equal(ev2.effect, "allow")
      assert.equal(q.log().filter((l) => l.cls === "CONFIG_ERROR").length, 0)
    }
  })
  await quiet(async () => {
    // config deleted at runtime after an enforce load
    const p = await mk({ mode: "enforce", deps: { cfgTtlMs: 0 } })
    assert.equal((await p.evaluate({ action: "read", resources: ["README.md"], effect: "allow" })).effect, "allow")
    fs.rmSync(p.cfgFile)
    const ev = await p.evaluate({ action: "read", resources: ["README.md"], effect: "allow" })
    assert.equal(ev.effect, "ask")
    assert.match(ev.message, /błąd konfiguracji/)
  })
})

test("shell request with nothing to analyse never passes silently", async () => {
  const p = await mk({ mode: "enforce" })
  for (const resources of [[], undefined]) {
    const ev = await p.evaluate({ action: "shell", resources, source: { type: "tool", id: "unknown" }, effect: "allow" })
    assert.equal(ev.effect, "ask")
    assert.equal(ev.message, "permission-model: brak danych o komendzie — pytam dla bezpieczeństwa")
  }
  const deny = await p.evaluate({ action: "shell", resources: [], effect: "deny", message: "native" })
  assert.equal(deny.effect, "deny")
  const l = p.log()
  assert.equal(l.length, 3)
  assert.equal(l[0].cls, "ERROR")
  assert.equal(l[0].reason, "no-items")
  assert.equal(l[0].applied, "ask")
  // restricted agents are not touched
  const r = await p.evaluate({ action: "shell", resources: [], agent: "architect", effect: "allow" })
  assert.equal(r.effect, "allow")
  // shadow: log only
  const s = await mk({ mode: "shadow" })
  const ev = await s.evaluate({ action: "shell", resources: [], effect: "allow" })
  assert.equal(ev.effect, "allow")
  assert.equal(ev.message, undefined)
  assert.equal(s.log()[0].cls, "ERROR")
  assert.equal(s.log()[0].reason, "no-items")
  assert.equal(s.log()[0].applied, "allow")
})

test("log perms: file always 0600; dir 0700 only for the plugin's own state dir", () => {
  // own state dir (name permission-model) -> dir tightened
  const own = path.join(base, "perm-own", "permission-model")
  fs.mkdirSync(own, { recursive: true, mode: 0o755 })
  fs.chmodSync(own, 0o755)
  const f = path.join(own, "x.jsonl")
  fs.writeFileSync(f, "", { mode: 0o644 })
  fs.chmodSync(f, 0o644)
  assert.equal(appendLog(f, { resource: "x" }), true)
  assert.equal(fs.statSync(f).mode & 0o777, 0o600)
  assert.equal(fs.statSync(own).mode & 0o777, 0o700)
  // custom logFile in a shared directory -> only the file is tightened, the dir is left alone
  const shared = path.join(base, "perm-shared")
  fs.mkdirSync(shared, { recursive: true })
  fs.chmodSync(shared, 0o755)
  const g = path.join(shared, "decisions.jsonl")
  assert.equal(appendLog(g, { resource: "x" }), true)
  assert.equal(fs.statSync(g).mode & 0o777, 0o600)
  assert.equal(fs.statSync(shared).mode & 0o777, 0o755)
})

test("alive marker follows a mode change at once", async () => {
  const p = await mk({ mode: "enforce", deps: { cfgTtlMs: 0 } })
  assert.equal(JSON.parse(fs.readFileSync(p.aliveFile, "utf8")).mode, "enforce")
  fs.writeFileSync(p.cfgFile, JSON.stringify({ mode: "shadow" }))
  await p.evaluate({ action: "read", resources: ["README.md"], effect: "allow" })
  assert.equal(JSON.parse(fs.readFileSync(p.aliveFile, "utf8")).mode, "shadow")
})

test("restricted agent: no plugin message on passthrough", async () => {
  const p = await mk()
  const id = p.before("cat x")
  const ev = await p.evaluate(shell(id, ["cat x"], { agent: "architect", effect: "ask" }))
  assert.equal(ev.message, undefined)
  const ev2 = await p.evaluate({ action: "read", resources: [".env"], agent: "architect", effect: "ask" })
  assert.equal(ev2.effect, "ask")
  assert.equal(ev2.message, undefined)
})

test("log file is 0600 and its directory 0700", async () => {
  const p = await mk({ mode: "shadow" })
  const id = p.before("ls")
  await p.evaluate(shell(id, ["ls"]))
  const logFile = path.join(p.dir, "log", "decisions.jsonl")
  assert.equal(fs.statSync(logFile).mode & 0o777, 0o600)
  assert.equal(fs.statSync(path.dirname(logFile)).mode & 0o777, 0o700)
})

test("commands over 8 KB are not stashed (resources are analysed instead)", async () => {
  const p = await mk()
  const big = "echo " + "x".repeat(9000)
  const id = p.before(big)
  const ev = await p.evaluate(shell(id, ["kubectl delete ns x"]))
  assert.equal(ev.effect, "ask")
  assert.equal(p.log()[0].reason, "uncorrelated")
})
