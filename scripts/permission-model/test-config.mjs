import { test } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const pluginDir = process.env.PM_PLUGIN_DIR ?? path.resolve(here, "../../plugins/permission-model")
const { DEFAULTS, loadConfig } = await import(pathToFileURL(path.join(pluginDir, "config.js")).href)

function tmpConfigDir(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pm-config-"))
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), typeof content === "string" ? content : JSON.stringify(content))
  }
  return dir
}

test("defaults when no files", () => {
  const cfg = loadConfig(tmpConfigDir(), {})
  assert.equal(cfg.mode, "shadow")
  assert.ok(cfg.targets.home.includes("admin@k8s"))
  assert.deepEqual(cfg, DEFAULTS)
})

test("repo file applies over defaults", () => {
  const cfg = loadConfig(tmpConfigDir({ "permission-model.json": { mode: "enforce" } }), {})
  assert.equal(cfg.mode, "enforce")
  assert.deepEqual(cfg.targets, DEFAULTS.targets)
})

test("local overrides repo", () => {
  const dir = tmpConfigDir({
    "permission-model.json": { mode: "shadow" },
    "permission-model.local.json": { mode: "enforce" },
  })
  assert.equal(loadConfig(dir, {}).mode, "enforce")
})

test("arrays replace, objects merge", () => {
  const dir = tmpConfigDir({ "permission-model.local.json": { targets: { prod: ["x"] } } })
  const cfg = loadConfig(dir, {})
  assert.deepEqual(cfg.targets.prod, ["x"])
  assert.deepEqual(cfg.targets.dev, DEFAULTS.targets.dev)
  assert.deepEqual(cfg.targets.home, DEFAULTS.targets.home)
})

test("loadConfig does not mutate DEFAULTS", () => {
  const before = JSON.stringify(DEFAULTS)
  const dir = tmpConfigDir({ "permission-model.local.json": { targets: { prod: ["x"] }, mode: "enforce" } })
  const cfg = loadConfig(dir, {})
  cfg.targets.dev.push("zzz")
  assert.equal(JSON.stringify(DEFAULTS), before)
})

test("invalid json -> defaults + console.error", (t) => {
  const errors = []
  t.mock.method(console, "error", (...args) => errors.push(args.join(" ")))
  const dir = tmpConfigDir({ "permission-model.json": "{ not json" })
  const cfg = loadConfig(dir, {})
  assert.match(cfg.configError, /invalid JSON in permission-model\.json/)
  delete cfg.configError
  assert.deepEqual(cfg, DEFAULTS)
  assert.equal(errors.length, 1)
  assert.match(errors[0], /^\[permission-model\]/)
})

test("configError: absent for missing/valid files, set for invalid or non-object layers", (t) => {
  t.mock.method(console, "error", () => {})
  assert.equal("configError" in loadConfig(tmpConfigDir(), {}), false)
  assert.equal("configError" in loadConfig(tmpConfigDir({ "permission-model.json": { mode: "enforce" } }), {}), false)
  const arr = loadConfig(tmpConfigDir({ "permission-model.local.json": "[1]" }), {})
  assert.match(arr.configError, /permission-model\.local\.json: expected a JSON object/)
  const both = loadConfig(tmpConfigDir({ "permission-model.json": "{", "permission-model.local.json": "oops" }), {})
  assert.match(both.configError, /permission-model\.json.*permission-model\.local\.json/)
})

test("invalid local json keeps repo file values", (t) => {
  const errors = []
  t.mock.method(console, "error", (...args) => errors.push(args.join(" ")))
  const dir = tmpConfigDir({
    "permission-model.json": { mode: "enforce" },
    "permission-model.local.json": "oops",
  })
  const cfg = loadConfig(dir, {})
  assert.equal(cfg.mode, "enforce")
  assert.equal(errors.length, 1)
})

test("paths with ~ are not expanded", () => {
  const cfg = loadConfig(tmpConfigDir(), {})
  assert.ok(cfg.logFile.startsWith("~/"))
  assert.ok(cfg.secretDeny.paths.includes("~/.ssh/id_*"))
})
