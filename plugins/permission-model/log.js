// Decision log (JSONL). Never throws; never records heredoc bodies or obvious secret values.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

const MAX_RESOURCE = 300
const HEREDOC = /<<-?[ \t]*(['"]?)([A-Za-z_][\w-]*)\1([^\n]*)\n[\s\S]*?(?:\n[ \t]*\2[ \t]*(?=\n|$)|$)/g
const SECRET_KV = /(password|token|secret)=\S+/gi

/** Heredoc bodies -> "<<heredoc>>", `password|token|secret=…` -> `=<redacted>`, clipped to 300 chars. */
export function redactResource(text) {
  let s = String(text ?? "")
  s = s.replace(HEREDOC, "<<heredoc>>$3")
  s = s.replace(SECRET_KV, "$1=<redacted>")
  return s.length > MAX_RESOURCE ? s.slice(0, MAX_RESOURCE) : s
}

export function expandHome(p, home = os.homedir()) {
  if (p === "~") return home
  if (typeof p === "string" && p.startsWith("~/")) return path.join(home, p.slice(2))
  return p
}

/** Append one JSON line to `file` (mkdir -p). Returns true on success; swallows I/O errors. */
export function appendLog(file, entry) {
  try {
    const out = { ...entry }
    if ("resource" in out) out.resource = redactResource(out.resource)
    if (typeof out.reason === "string") out.reason = out.reason.replace(SECRET_KV, "$1=<redacted>").slice(0, 300)
    const f = expandHome(file)
    fs.mkdirSync(path.dirname(f), { recursive: true, mode: 0o700 })
    fs.appendFileSync(f, JSON.stringify(out) + "\n", { mode: 0o600 })
    // tighten a pre-existing file; the directory only when it is the plugin's own state dir
    try {
      fs.chmodSync(f, 0o600)
      const dir = path.dirname(f)
      if (path.basename(dir) === "permission-model") fs.chmodSync(dir, 0o700)
    } catch {
      // not ours / read-only: ignore
    }
    return true
  } catch {
    return false
  }
}
