#!/usr/bin/env node
// Prints the plugin's alive marker (age s, mode, pid). Exit 1 if missing/unreadable or older than 300 s.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const MAX_AGE_S = 300
const file = process.argv[2] ?? process.env.PM_ALIVE_FILE ?? path.join(os.homedir(), ".local", "share", "opencode", "permission-model", "alive")

let a
try {
  a = JSON.parse(fs.readFileSync(file, "utf8"))
} catch {
  console.log(`permission-model: BRAK znacznika alive (${file})`)
  process.exit(1)
}
const rawAge = Math.round((Date.now() - Number(a?.ts)) / 1000)
if (!Number.isFinite(rawAge)) {
  console.log(`permission-model: znacznik alive bez ts (${file})`)
  process.exit(1)
}
const age = Math.max(0, rawAge) // a ts in the future (clock skew) counts as fresh
console.log(`age=${age}s mode=${a.mode ?? "?"} pid=${a.pid ?? "?"}`)
if (rawAge < 0) console.log(`uwaga: ts znacznika jest w przyszłości o ${-rawAge} s (różnica zegarów?)`)
if (age > MAX_AGE_S) {
  console.log(`permission-model: znacznik starszy niż ${MAX_AGE_S} s — plugin nie działa?`)
  process.exit(1)
}
