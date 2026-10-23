import fs from "node:fs"
import path from "node:path"

// Spec §3/§4: patterns use `*` = any string (incl. spaces and `/`), `?` = one char.
// Paths with `~` stay as strings here; consumers expand them.
export const DEFAULTS = {
  mode: "shadow",
  targets: {
    home: ["admin@k8s"],
    dev: ["kind-*", "*-dev", "*-test", "*-sandbox"],
    prod: ["*-prod", "*-prd", "*-production", "prod-*", "prd-*"],
  },
  protectedNamespaces: ["flux-system", "kube-system"],
  readVerbs: {
    kubectl: ["get", "describe", "logs", "top", "events", "explain", "api-resources", "api-versions", "version", "cluster-info", "diff", "wait", "kustomize", "config view", "config get-contexts", "config current-context", "auth can-i", "port-forward", "rollout status", "rollout history"],
    helm: ["list", "ls", "status", "history", "get", "template", "show", "search", "lint", "version", "env", "dependency list", "package", "pull", "repo list"],
    flux: ["get", "logs", "trace", "stats", "version", "export", "events", "check", "tree", "diff"],
    talosctl: ["usage", "mounts", "disks", "list", "ls", "logs", "dmesg", "services", "service", "containers", "processes", "ps", "stats", "memory", "netstat", "events", "time", "version", "health", "get", "config info", "etcd members", "etcd status", "cgroups", "inspect dependencies", "gen config", "machineconfig patch", "validate", "image default", "image list"], // gen config / machineconfig patch / validate / image default: local file work, no cluster mutation (decyzja użytkownika 2026-10-24, bramka 1, pkt 4); "gen secrets" stays asking (creates secret material)
    gh: ["pr view", "pr list", "pr diff", "pr checks", "pr status", "run view", "run list", "run watch", "run download", "workflow view", "workflow list", "issue view", "issue list", "repo view", "repo list", "release view", "release list", "release download", "auth status", "search", "api"], // "api" = read only without -X/-f/-F/--field/--input; "* download" writes local files only
    jk: ["--version", "version", "auth status", "context ls", "search", "job ls", "job view", "job config", "run ls", "run view", "run params", "run search", "log", "artifact ls", "test report", "cred ls", "node ls", "queue ls", "plugin ls"],
    wrangler: ["whoami", "versions list", "deployments list", "tail", "dev", "kv key get", "kv key list", "d1 list", "r2 bucket list", "secret list"],
    cf: ["whoami", "list", "get", "status"],
    ant: ["auth status", "--version", "help"],
    crane: ["ls", "digest", "manifest", "config", "export", "validate", "version"],
    aws: ["describe-*", "list-*", "get-*", "head-*", "search-*", "lookup-*", "filter-*", "scan", "query", "select-*", "sts get-caller-identity", "configure list", "configure get", "s3 ls"],
  },
  homeAllowedWrites: {
    git: ["push"],
    gh: ["pr *", "issue create", "issue comment", "issue edit"],
    kubectl: ["apply", "exec", "rollout", "scale", "patch", "label", "annotate", "create", "cp", "port-forward"],
    flux: ["reconcile", "suspend", "resume"],
    helm: ["upgrade", "install", "rollback", "repo add", "repo update"],
  },
  irreversible: {
    kubectl: ["delete namespace", "delete ns", "delete pv", "delete pvc", "delete crd", "delete --all", "delete -f", "delete -k", "drain", "cordon", "taint"],
    helm: ["uninstall", "delete"],
    flux: ["uninstall", "delete"],
    talosctl: ["reset", "upgrade", "upgrade-k8s", "apply-config", "patch", "edit", "bootstrap", "reboot", "shutdown", "wipe", "etcd snapshot", "etcd remove-member", "etcd leave"],
    git: ["push --force*", "push -f*", "push * -f*", "push -?f*", "push --delete*", "push -d*", "push * -d*", "push --mirror*", "push *+*", "push * :*"],
    gh: ["repo delete", "repo archive", "repo edit", "repo deploy-key", "secret", "release delete"],
    aws: ["delete-*", "terminate-*", "deregister-*", "disable-*", "put-bucket-policy", "s3 rm", "s3 rb", "s3 sync*--delete*", "iam attach-*", "iam put-*", "iam create-access-key", "ec2 authorize-security-group-*", "ec2 revoke-*", "rds modify-db-instance", "rds delete-*", "cloudformation delete-stack", "eks delete-*"],
    wrangler: ["delete", "rollback", "secret delete"],
    cf: ["* delete*"],
    jk: ["job delete", "job configure", "cred *", "node rm", "plugin *"],
    crane: ["delete"],
  },
  irreversibleExceptions: {
    git: ["push * :refs/tags/test-*", "push * --delete test-*", "push * -d test-*"],
  },
  secretDeny: {
    paths: ["~/.ssh/id_*", "~/.local/share/opencode/auth.json"],
    pathAllow: ["~/.ssh/id_*.pub"],
    commands: ["security *", "gcloud * print-access-token*", "gcloud * print-identity-token*", "aws * get-secret-value*", "aws * get-session-token*", "aws ecr get-login-password*", "ant auth print-credentials*"],
  },
  secretAsk: {
    paths: ["**/.env", "**/.env.*", "**/secrets/**", "**/*.pem", "**/*.key", "**/*.token", "~/.kube/config", "~/.aws/credentials", "~/.config/gcloud/**", "~/.claude.json", "~/.gemini/**", "~/.config/anthropic/**", "~/.cf-turnstile-token"],
    pathAllow: ["**/.env.example"],
    commands: ["env", "printenv", "kubectl * get *secret*-o *", "talosctl * get *secret*", "talosctl * get osroot*", "talosctl * get *machineconfig*"],
    commandAllow: ["kubectl * get *secret*-o name*", "env | grep ^?*", "env | grep -i ^?*", "kubectl * create secret * --dry-run=client*"],
  },
  ownConfig: ["~/.config/opencode/opencode.json*", "~/.config/opencode/opencode.*.json", "~/.config/opencode/agents/**", "~/.config/opencode/secrets/**", "~/.config/opencode/plugins/**", "~/.config/opencode/scripts/check-skill-whitelists.sh", "~/.config/opencode/permission-model*.json", "**/.opencode/**", "~/.zsh/**"],
  localAsk: {
    commands: ["sudo *", "brew install*", "brew uninstall*", "brew upgrade*", "brew tap", "brew tap *", "brew untap", "brew untap *", "brew services", "brew services *", "softwareupdate *", "defaults write*", "defaults delete*", "launchctl *", "pmset -*", "diskutil *", "tmutil *", "networksetup -set*", "scutil --set*", "kill *", "pkill *", "killall *", "ssh *", "scp *", "rsync *", "sftp *", "hs *", "osascript *", "npm install -g*", "npm i -g*", "pip install*", "pipx install*"],
    commandAllow: ["launchctl list*", "launchctl print*", "pmset -g*", "diskutil list*", "diskutil info*", "kill $!", "kill -* $!", "kill %*", "kill -* %*", "ssh -V*", "ssh -G *"],
  },
  agentExceptions: {
    ha: ["ssh esp.iot *", "ssh -o BatchMode=yes esp.iot *", "scp * esp.iot:*", "scp esp.iot:* *"],
  },
  restrictedAgents: ["architect", "plan", "autopilot", "webscraper", "webresearcher", "webmonitor", "jira", "stitch-mcp"],
  logFile: "~/.local/share/opencode/permission-model/decisions.jsonl",
}

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v)

function clone(v) {
  if (Array.isArray(v)) return v.map(clone)
  if (isPlainObject(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clone(x)]))
  return v
}

// Objects merge recursively, arrays and scalars from `over` replace. Never mutates inputs.
function merge(base, over) {
  if (!isPlainObject(base) || !isPlainObject(over)) return clone(over)
  const out = clone(base)
  for (const [k, v] of Object.entries(over)) {
    if (k === "__proto__") continue
    out[k] = isPlainObject(v) && isPlainObject(out[k]) ? merge(out[k], v) : clone(v)
  }
  return out
}

// -> { value } | { error } | {} (file absent)
function readJson(file) {
  let text
  try {
    text = fs.readFileSync(file, "utf8")
  } catch (err) {
    if (err && err.code === "ENOENT") return {}
    console.error(`[permission-model] cannot read ${file}: ${err.message}`)
    return { error: `cannot read ${path.basename(file)}: ${err.message}` }
  }
  try {
    const parsed = JSON.parse(text)
    if (!isPlainObject(parsed)) {
      console.error(`[permission-model] ${file}: expected a JSON object, ignoring`)
      return { error: `${path.basename(file)}: expected a JSON object` }
    }
    return { value: parsed }
  } catch (err) {
    console.error(`[permission-model] invalid JSON in ${file}: ${err.message}`)
    return { error: `invalid JSON in ${path.basename(file)}: ${err.message}` }
  }
}

/**
 * DEFAULTS ⊕ <configDir>/permission-model.json ⊕ <configDir>/permission-model.local.json.
 * Objects merge recursively, arrays replace. Invalid file → console.error, file skipped and
 * `cfg.configError` (string) is set; the property is absent when files are fine or merely missing.
 * `env` is accepted for API symmetry; nothing is read from it here. No `~` expansion.
 */
export function loadConfig(configDir, env = process.env) { // eslint-disable-line no-unused-vars
  let cfg = clone(DEFAULTS)
  const errors = []
  for (const name of ["permission-model.json", "permission-model.local.json"]) {
    const r = readJson(path.join(configDir, name))
    if (r.value) cfg = merge(cfg, r.value)
    else if (r.error) errors.push(r.error)
  }
  if (errors.length > 0) cfg.configError = errors.join("; ")
  return cfg
}
