// Session helpers for the permission-model plugin: tool-call correlator and session directory lookup.

/**
 * Correlator: remembers the shell command of a tool call (keyed by tool-call id) between
 * `tool.execute.before` and `permission.evaluate`. Entries expire after `ttlMs`; at most `max`
 * entries are kept (oldest dropped first). `now` is injectable for tests.
 */
export function createCorrelator(ttlMs = 120000, max = 500, now = Date.now) {
  const map = new Map() // id -> { entry, at }
  return {
    put(id, entry) {
      if (id == null) return
      map.delete(id)
      map.set(id, { entry, at: now() })
      while (map.size > max) map.delete(map.keys().next().value)
    },
    get(id) {
      if (id == null) return undefined
      const hit = map.get(id)
      if (!hit) return undefined
      if (now() - hit.at > ttlMs) {
        map.delete(id)
        return undefined
      }
      return hit.entry
    },
    get size() {
      return map.size
    },
  }
}

const DIR_TTL_MS = 60000
const DIR_MAX = 200
const caches = new WeakMap() // ctx -> Map(sessionID -> { dir, at })

/**
 * Directory of a session (`ctx.session.get({sessionID}).location.directory`), cached 60 s per
 * session. Falls back to `ctx.location.directory` when the lookup fails or yields nothing.
 * Throws when no directory can be determined.
 */
export async function sessionDir(ctx, sessionID, now = Date.now) {
  let cache = caches.get(ctx)
  if (!cache) {
    cache = new Map()
    caches.set(ctx, cache)
  }
  const hit = cache.get(sessionID)
  if (hit && now() - hit.at <= DIR_TTL_MS) return hit.dir
  let dir
  try {
    dir = (await ctx.session.get({ sessionID }))?.location?.directory
  } catch (err) {
    if (!ctx.location?.directory) throw err
  }
  dir ??= ctx.location?.directory
  if (typeof dir !== "string" || dir === "") throw new Error("session directory unavailable")
  cache.delete(sessionID)
  if (cache.size >= DIR_MAX) cache.delete(cache.keys().next().value)
  cache.set(sessionID, { dir, at: now() })
  return dir
}
