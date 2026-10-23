import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const pluginDir = process.env.PM_PLUGIN_DIR ?? path.resolve(here, "../../plugins/permission-model")
const { DEFAULTS } = await import(pathToFileURL(path.join(pluginDir, "config.js")).href)
const { canonical, pathClass, decidePathAction, globMatch } = await import(pathToFileURL(path.join(pluginDir, "paths.js")).href)

const home = "/Users/test"
const cfg = DEFAULTS
const inHome = { home, sessionDir: home }
const inProj = { home, sessionDir: "/Users/test/Projects/p" }
const inCfg = { home, sessionDir: "/Users/test/.config/opencode" }

test("globMatch basics", () => {
  assert.ok(globMatch("**/.env", "/a/b/.env", home))
  assert.ok(globMatch("**/.env", "/.env", home))
  assert.ok(!globMatch("**/.env", "/a/b/x.env", home))
  assert.ok(globMatch("~/.ssh/id_*", "/Users/test/.ssh/id_rsa", home))
  assert.ok(globMatch("**/secrets/**", "/a/secrets/x/y", home))
  assert.ok(!globMatch("**/secrets/**", "/a/shared-secrets/x", home))
  assert.ok(globMatch("a?c", "/abc".slice(1), home))
})

test("secret-deny", () => {
  assert.equal(pathClass("~/.ssh/id_ed25519", cfg, inProj), "secret-deny")
  assert.equal(pathClass(".ssh/id_ed25519", cfg, inHome), "secret-deny")
  assert.equal(pathClass("~/.local/share/opencode/auth.json", cfg, inProj), "secret-deny")
  assert.equal(pathClass("/Users/test/.ssh/id_rsa", cfg, inProj), "secret-deny")
  assert.equal(pathClass("~/.ssh/id_ed25519.pub", cfg, inProj), null)
})

test("secret-ask", () => {
  for (const p of [".env", "config/.env.local", "secrets/x", "a/secrets/x", "x.pem", "~/.kube/config", "~/.claude.json"]) {
    assert.equal(pathClass(p, cfg, inProj), "secret-ask", p)
  }
  assert.equal(pathClass(".env.example", cfg, inProj), null)
  assert.equal(pathClass("shared-secrets/x.yaml", cfg, inProj), null)
})

test("own-config", () => {
  assert.equal(pathClass("opencode.json", cfg, inCfg), "own-config")
  assert.equal(pathClass("agents/coder.md", cfg, inCfg), "own-config")
  assert.equal(pathClass("plugins/permission-model/index.js", cfg, inCfg), "own-config")
  assert.equal(pathClass("/Users/x/Projects/p/.opencode/x", cfg, inProj), "own-config")
  assert.equal(pathClass("~/.zsh/zshenv", cfg, inProj), "own-config")
})

test("ordinary files are null", () => {
  assert.equal(pathClass("src/a.ts", cfg, inProj), null)
  assert.equal(pathClass("docs/x.md", cfg, inCfg), null)
  assert.equal(pathClass("agents/coder.md", cfg, inProj), null) // not under ~/.config/opencode
})

test("decidePathAction", () => {
  let d = decidePathAction("edit", "agents/x.md", cfg, inCfg)
  assert.equal(d.effect, "ask")
  assert.equal(d.cls, "own-config")
  assert.equal(d.message, "permission-model: zapis własnej konfiguracji: /Users/test/.config/opencode/agents/x.md")

  assert.deepEqual(decidePathAction("read", "src/a.ts", cfg, inProj).effect, "allow")
  assert.equal(decidePathAction("write", "src/a.ts", cfg, inProj).effect, "allow")

  d = decidePathAction("read", "~/.ssh/id_x", cfg, inProj)
  assert.equal(d.effect, "deny")
  assert.equal(d.cls, "secret-deny")
  assert.equal(d.message, "permission-model: twardy zakaz — dane wrażliwe: /Users/test/.ssh/id_x")
  assert.equal(decidePathAction("write", "~/.ssh/id_x", cfg, inProj).effect, "deny")

  d = decidePathAction("read", ".env", cfg, inProj)
  assert.equal(d.effect, "ask")
  assert.equal(d.message, "permission-model: dane wrażliwe: /Users/test/Projects/p/.env")
  assert.equal(decidePathAction("edit", ".env", cfg, inProj).effect, "ask") // editing a secret also asks
  assert.equal(decidePathAction("edit", ".env.example", cfg, inProj).effect, "allow")
})

test("read of own-config is allowed, but secrets inside own config still ask", () => {
  assert.equal(decidePathAction("read", "agents/coder.md", cfg, inCfg).effect, "allow")
  const r = decidePathAction("read", "secrets/token", cfg, inCfg)
  assert.equal(r.effect, "ask")
  assert.equal(r.cls, "secret-ask")
  const e = decidePathAction("edit", "secrets/token", cfg, inCfg)
  assert.equal(e.effect, "ask")
  assert.equal(e.cls, "own-config")
})

test("canonical: ~, $HOME, ${HOME}, relative, dotdot", () => {
  assert.equal(canonical("~/x", "/", home), "/Users/test/x")
  assert.equal(canonical("$HOME/x", "/", home), "/Users/test/x")
  assert.equal(canonical("${HOME}/x", "/", home), "/Users/test/x")
  assert.equal(canonical("a/../b", "/Users/test/p", home), "/Users/test/p/b")
  assert.equal(canonical("/Users/test/p/../.ssh/id_x", "/", home), "/Users/test/.ssh/id_x")
})

test("canonical: nonexistent path resolves via nearest existing ancestor", () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pm-paths-")))
  assert.equal(canonical("new/dir/file", dir, home), path.join(dir, "new/dir/file"))
  assert.equal(pathClass("new/dir/file", cfg, { home, sessionDir: dir }), null)
})

test("canonical: symlinked ancestor is resolved (/tmp, symlink dir)", () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pm-paths-")))
  const real = path.join(dir, "real")
  fs.mkdirSync(real)
  fs.symlinkSync(real, path.join(dir, "link"))
  assert.equal(canonical("link/not/there.txt", dir, home), path.join(real, "not/there.txt"))
  if (fs.existsSync("/private/tmp")) assert.equal(canonical("/tmp/pm-nonexistent-xyz/f", "/", home), "/private/tmp/pm-nonexistent-xyz/f")
})

test("symlinked home: patterns match real and raw home", () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pm-paths-")))
  const realHome = path.join(dir, "realhome")
  fs.mkdirSync(path.join(realHome, ".ssh"), { recursive: true })
  const linkHome = path.join(dir, "linkhome")
  fs.symlinkSync(realHome, linkHome)
  const ctx = { home: linkHome, sessionDir: linkHome }
  assert.equal(pathClass("~/.ssh/id_rsa", cfg, ctx), "secret-deny")
  assert.equal(pathClass(".ssh/id_rsa", cfg, ctx), "secret-deny")
  assert.equal(pathClass(path.join(realHome, ".ssh/id_rsa"), cfg, ctx), "secret-deny")
})

test("never throws on odd input", () => {
  assert.doesNotThrow(() => canonical(undefined, undefined, undefined))
  assert.doesNotThrow(() => canonical("a\0b", "/", home))
  assert.doesNotThrow(() => decidePathAction("read", "", cfg, {}))
})
