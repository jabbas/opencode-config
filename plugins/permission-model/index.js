/**
 * permission-model — OpenCode v2 directory plugin (dependency-free ESM).
 *
 * Spec: docs/superpowers/specs/2026-10-22-permission-model-v2-design.md (§5).
 *
 * Wiring:
 *  - ctx.tool.hook("execute.before")  stashes the shell command by tool-call id (correlator)
 *  - ctx.permission.hook("evaluate")  decides shell / read / edit / write requests
 *
 * Modes (`mode` in permission-model[.local].json): `shadow` (default; only logs what the plugin
 * WOULD decide) and `enforce` (sets `ev.effect` / `ev.message`). Fail-safe: any error or a decision
 * that takes longer than 250 ms yields `ask` (never `allow`) in enforce mode and an `ERROR` log line.
 *
 * Test/ops env overrides: PM_CONFIG_DIR, PM_LOG_FILE, PM_ALIVE_FILE.
 */
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { loadConfig } from "./config.js"
import { decideShell as realDecideShell, reconcile } from "./decide.js"
import { decidePathAction as realDecidePathAction } from "./paths.js"
import { pluginError, configError, noCommandData } from "./messages.js"
import { createCorrelator, sessionDir } from "./session.js"
import { appendLog, expandHome } from "./log.js"

const RANK = { allow: 0, ask: 1, deny: 2 }
const PATH_ACTIONS = new Set(["read", "edit", "write"])
const CFG_TTL_MS = 10000
const ALIVE_TTL_MS = 10000
const BUDGET_MS = 250

const CMD_MAX = 8192 // longer commands are not stashed -> analysed from the (full) evaluate resources

/**
 * Config dir: env PM_CONFIG_DIR, else derived from the plugin location
 * (`<cfg>/plugins/permission-model/index.js`), accepted only if it holds opencode.json or
 * permission-model.json; otherwise ~/.config/opencode (+ a warning).
 */
function defaultConfigDir(env, pluginUrl, home) {
  if (env.PM_CONFIG_DIR) return { dir: env.PM_CONFIG_DIR }
  const fallback = path.join(home, ".config", "opencode")
  let derived
  try {
    derived = path.resolve(path.dirname(fileURLToPath(pluginUrl)), "..", "..")
  } catch {
    return { dir: fallback, warn: "cannot derive config dir from plugin location" }
  }
  if (fs.existsSync(path.join(derived, "opencode.json")) || fs.existsSync(path.join(derived, "permission-model.json"))) return { dir: derived }
  return { dir: fallback, warn: `derived config dir ${derived} has neither opencode.json nor permission-model.json` }
}

function computeTmpRoots(env) {
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

function readFileSafe(p) {
  try {
    return fs.readFileSync(p, "utf8")
  } catch {
    return undefined
  }
}

const rankOf = (e) => RANK[e] ?? 1

/** Name of the decision's target for the log; local write targets are resolved to absolute paths. */
function targetName(decision, fallbackCwd, home) {
  const t = decision?.target
  if (t?.name !== undefined) return t.name
  const d = decision?.classification?.detail
  if ((t?.kind === "local" || t?.kind === "none") && decision?.cls === "local-write" && typeof d === "string" && d !== "") {
    if (d === "~" || d.startsWith("~/")) return path.join(home, d.slice(1))
    const cwd = decision.cwd ?? fallbackCwd
    return path.isAbsolute(d) ? path.normalize(d) : cwd ? path.resolve(cwd, d) : d
  }
  return undefined
}

/** Runs `fn` with a time budget; rejects with Error("timeout") when exceeded. */
async function withBudget(fn, ms) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), ms)
    timer.unref?.()
  })
  try {
    return await Promise.race([Promise.resolve().then(fn), timeout])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Final effect for a path decision. `allow` from decidePathAction means "do not interfere"
 * (incoming stands); otherwise same semantics as shell `reconcile`.
 */
function reconcilePath(pd, incoming, cfg, restricted) {
  if (pd.effect === "allow") return incoming ?? "allow"
  const d = { ...pd }
  if (restricted && pd.cls !== "secret-deny") d.passthrough = true
  return reconcile(d, incoming, cfg)
}

export function createPlugin(deps = {}) {
  const decideShell = deps.decideShell ?? realDecideShell
  const decidePathAction = deps.decidePathAction ?? realDecidePathAction
  const budgetMs = deps.budgetMs ?? BUDGET_MS
  const cfgTtlMs = deps.cfgTtlMs ?? CFG_TTL_MS
  const pluginUrl = deps.pluginUrl ?? import.meta.url

  async function setup(ctx) {
    // v1 also calls default.setup with a different context — do nothing there.
    if (!ctx?.tool || typeof ctx.tool.hook !== "function" || !ctx.permission || typeof ctx.permission.hook !== "function") return

    const env = process.env
    const home = os.homedir()
    const { dir: configDir, warn: dirWarn } = defaultConfigDir(env, pluginUrl, home)
    if (dirWarn) console.error(`[permission-model] ${dirWarn}; using ${configDir}`)
    const tmpRoots = computeTmpRoots(env)
    const aliveFile = env.PM_ALIVE_FILE || path.join(home, ".local", "share", "opencode", "permission-model", "alive")
    const correlator = createCorrelator()

    let reported = false
    const fail = (where, err) => {
      if (reported) return
      reported = true
      console.error(`[permission-model] ${where} failed:`, err)
    }

    // --- config (reloaded at most every 10 s) ---
    let cfg
    let cfgAt = 0
    // enforce is sticky: seen in a good load (seeded from the previous run's alive marker so a
    // plugin reload during a broken config does not drop to shadow), kept while the config is broken
    let lastEnforce = false
    try {
      lastEnforce = JSON.parse(fs.readFileSync(aliveFile, "utf8"))?.mode === "enforce"
    } catch {
      // no / unreadable marker -> unknown, start without memory
    }
    let brokenEnforce = false // config broken AND enforce known/configured -> ask for everything
    let configErrorLogged = true
    const modeOf = (c) => (c?.mode === "enforce" ? "enforce" : "shadow")
    const getCfg = () => {
      const t = Date.now()
      if (cfg && t - cfgAt < cfgTtlMs) return cfg
      try {
        cfg = loadConfig(configDir, env)
        // a vanished primary config must not silently lower a known enforce
        if (!cfg.configError && lastEnforce && !fs.existsSync(path.join(configDir, "permission-model.json"))) cfg.configError = "permission-model.json missing"
        if (cfg.configError) {
          brokenEnforce = lastEnforce || modeOf(cfg) === "enforce"
          configErrorLogged = false
        } else {
          brokenEnforce = false
          lastEnforce = modeOf(cfg) === "enforce"
        }
      } catch (err) {
        if (!cfg) throw err
        fail("config reload", err)
      }
      cfgAt = t
      return cfg
    }
    const effectiveMode = (c) => (brokenEnforce ? "enforce" : modeOf(c))

    // --- alive marker (ruling R2), written at most every 10 s ---
    let aliveAt = 0
    let aliveMode
    const touchAlive = (mode) => {
      const t = Date.now()
      if (mode === aliveMode && t - aliveAt < ALIVE_TTL_MS) return // a mode change is written at once
      aliveAt = t
      aliveMode = mode
      try {
        fs.mkdirSync(path.dirname(aliveFile), { recursive: true })
        fs.writeFileSync(aliveFile, JSON.stringify({ pid: process.pid, ts: t, mode, version: "1" }))
      } catch (err) {
        fail("alive marker", err)
      }
    }

    try {
      touchAlive(effectiveMode(getCfg()))
    } catch (err) {
      fail("setup", err)
    }

    try {
      await ctx.tool.hook("execute.before", (e) => {
        try {
          if (e?.tool !== "shell" || typeof e.input?.command !== "string" || e.id == null) return
          if (e.input.command.length > CMD_MAX) return // too big to stash: evaluate analyses its resources instead
          correlator.put(e.id, {
            command: e.input.command,
            workdir: typeof e.input.workdir === "string" ? e.input.workdir : undefined,
            sessionID: e.sessionID,
          })
        } catch (err) {
          fail("execute.before", err)
        }
      })
    } catch (err) {
      fail("execute.before registration", err)
    }

    /** Decide a shell request -> { decision, final, resource, reason } (strictest). */
    async function evalShell(ev, c) {
      const entry = correlator.get(ev.source?.id)
      const sid = entry?.sessionID ?? ev.sessionID
      const base = await withBudget(() => sessionDir(ctx, sid), budgetMs)
      let items
      if (entry) {
        const cwd = entry.workdir ? path.resolve(base, entry.workdir) : base
        items = [{ command: entry.command, cwd, uncorrelated: false }]
      } else {
        items = (Array.isArray(ev.resources) ? ev.resources : []).map((r) => ({ command: String(r), cwd: base, uncorrelated: true }))
      }
      let best
      for (const it of items) {
        const decision = await withBudget(
          () =>
            decideShell(it.command, {
              cfg: c,
              cwd: it.cwd,
              sessionDir: base,
              home,
              tmpRoots,
              env,
              readFile: readFileSafe,
              agent: ev.agent,
            }),
          budgetMs,
        )
        const final = reconcile(decision, ev.effect, c)
        const cand = { decision, final, resource: it.command, reason: it.uncorrelated ? "uncorrelated" : decision.reason, targetName: targetName(decision, it.cwd, home) }
        if (!best || rankOf(final) > rankOf(best.final)) best = cand
      }
      return best
    }

    /** Decide a read/edit/write request -> { decision, final, resource, reason } (strictest). */
    async function evalPath(ev, c, restricted) {
      const base = await withBudget(() => sessionDir(ctx, ev.sessionID), budgetMs)
      let best
      for (const r of Array.isArray(ev.resources) ? ev.resources : []) {
        const resource = String(r)
        const pd = await withBudget(() => decidePathAction(ev.action, resource, c, { home, sessionDir: base }), budgetMs)
        const final = reconcilePath(pd, ev.effect, c, restricted)
        const decision = { ...pd, target: { kind: "path", name: resource, cls: pd.cls ?? "none" }, reason: pd.cls ?? "path" }
        if (restricted && pd.cls !== "secret-deny") decision.passthrough = true
        if (!best || rankOf(final) > rankOf(best.final) || (rankOf(final) === rankOf(best.final) && pd.effect !== "allow" && best.decision.effect === "allow")) {
          best = { decision, final, resource, reason: decision.reason }
        }
      }
      return best
    }

    try {
      await ctx.permission.hook("evaluate", async (ev) => {
        const t0 = performance.now()
        let c
        let mode = "shadow"
        let restricted = false
        try {
          c = getCfg()
          mode = effectiveMode(c)
          touchAlive(mode)
        } catch (err) {
          fail("config", err)
        }
        const action = ev?.action
        const isShell = action === "shell"
        if (!isShell && !PATH_ACTIONS.has(action)) return
        const logFile = env.PM_LOG_FILE || expandHome(c?.logFile ?? "~/.local/share/opencode/permission-model/decisions.jsonl", home)
        const incoming = ev.effect
        const resourceText = () => (Array.isArray(ev.resources) ? ev.resources.map(String).join(" ; ") : "")
        const base = { sessionID: ev.sessionID, agent: ev.agent, action }
        try {
          if (!c) throw new Error("config unavailable")
          restricted = (c.restrictedAgents ?? []).includes(ev.agent)
          if (c.configError) {
            // broken config: with enforce known/configured, ask for everything (never silently drop protection)
            const asking = brokenEnforce && !restricted
            if (!configErrorLogged) {
              configErrorLogged = true
              appendLog(logFile, {
                ts: new Date().toISOString(),
                ...base,
                resource: resourceText(),
                cls: "CONFIG_ERROR",
                target: { kind: "none", name: undefined, cls: undefined },
                incoming,
                decided: asking ? "ask" : incoming,
                applied: asking ? (incoming === "deny" ? "deny" : "ask") : incoming,
                mode,
                reason: c.configError,
                ms: Math.round(performance.now() - t0),
              })
            }
            if (asking) {
              if (incoming !== "deny") {
                ev.effect = "ask"
                ev.message = configError(c.configError)
              }
              return
            }
          }
          const res = isShell ? await evalShell(ev, c) : await evalPath(ev, c, restricted)
          if (!res) {
            if (!isShell) return // read/edit/write without resources: nothing to judge
            // a shell request with nothing to analyse must never pass as "fine"
            const cur = ev.effect ?? incoming
            const final = restricted ? cur : cur === "deny" ? "deny" : "ask"
            if (mode === "enforce" && !restricted) {
              if (final !== cur) ev.effect = final
              if (final === "ask") ev.message = noCommandData()
            }
            appendLog(logFile, {
              ts: new Date().toISOString(),
              ...base,
              resource: resourceText(),
              cls: "ERROR",
              target: { kind: "none", name: undefined, cls: undefined },
              incoming,
              decided: "ask",
              applied: mode === "enforce" ? final : incoming,
              mode,
              reason: "no-items",
              ms: Math.round(performance.now() - t0),
            })
            return
          }
          const { decision, final, resource, reason } = res
          const tName = res.targetName ?? decision.target?.name
          if (mode === "enforce") {
            if (final !== incoming) ev.effect = final
            // the plugin's own explanation, only when its decision is the one applied
            if (decision.message && !decision.passthrough && final === decision.effect && final !== "allow") ev.message = decision.message
          }
          appendLog(logFile, {
            ts: new Date().toISOString(),
            ...base,
            resource,
            cls: decision.cls,
            target: { kind: decision.target?.kind, name: tName, cls: decision.target?.cls },
            incoming,
            decided: decision.effect,
            applied: mode === "enforce" ? final : incoming,
            mode,
            reason,
            ms: Math.round(performance.now() - t0),
          })
        } catch (err) {
          fail("evaluate", err)
          const why = err?.message ?? String(err)
          // never allow: stricter of incoming and ask — except restricted agents (only secret-deny may change them)
          const cur = ev.effect ?? incoming // may already carry a plugin-applied deny
          const final = restricted ? cur : cur === "deny" ? "deny" : "ask"
          if (mode === "enforce" && !restricted) {
            try {
              if (final !== cur) ev.effect = final
              if (final === "ask") ev.message = pluginError(why)
            } catch (e2) {
              fail("evaluate (apply)", e2)
            }
          }
          appendLog(logFile, {
            ts: new Date().toISOString(),
            ...base,
            resource: resourceText(),
            cls: "ERROR",
            target: { kind: "none", name: undefined, cls: undefined },
            incoming,
            decided: "ask",
            applied: mode === "enforce" ? final : incoming,
            mode,
            reason: why,
            ms: Math.round(performance.now() - t0),
          })
        }
      })
    } catch (err) {
      fail("evaluate registration", err)
    }
  }

  return { id: "permission-model", setup }
}

export default createPlugin()
