#!/usr/bin/env node
// stdio <-> HTTP proxy for the Stitch MCP endpoint.
//
// Why this exists: https://stitch.googleapis.com/mcp rejects API keys
// ("API keys are not supported by this API") and requires an OAuth2 access
// token. opencode.json can only inject static {file:...} header values, but
// OAuth tokens expire after ~1h. This proxy mints a fresh token from gcloud
// ADC on demand, so long sessions keep working.
//
// Self-healing auth: Google periodically forces a reauth of the ADC login
// (Workspace admin policy); gcloud then fails with "Reauthentication failed.
// cannot prompt during non-interactive execution".
// - Only AUTH_METHODS (tools/call, resources/read) get a token. If minting it
//   fails, the proxy shows a macOS notification and runs
//   `gcloud auth application-default login` (opens the browser), then mints
//   again. Tool calls may take hours in OpenCode, so waiting is fine there,
//   and the browser opens only when the user actually uses a Stitch tool.
// - Every other method (initialize, ping, tools/list, resources/list,
//   prompts/list, notifications/*, unknown ones) is sent WITHOUT a token and
//   never calls gcloud. OpenCode sends catalog calls on every (re)connect with
//   a 30 s timeout; they must answer fast and never open a browser in the
//   background. Stitch answers them unauthenticated, so the MCP server stays
//   up while ADC is stale. Because login is tied to user intent, there is no
//   cross-process lock/cooldown for the reconnecting proxy processes.
// - One login at a time (single-flight; gcloud's callback uses port 8085).
//   A failed or timed-out login starts a cooldown: no new browser window until
//   it expires, but minting is still tried first, so a manual login works.
// - Token minting is single-flight too. On stdin EOF or SIGTERM/SIGINT/SIGHUP
//   a running login is killed (frees port 8085); requests waiting for it get
//   an error response and the proxy exits.
// Requests are handled concurrently so unauthenticated calls stay responsive while
// a tool call waits for the sign-in. stdout is the MCP channel only.

import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { createInterface } from "node:readline";
import { constants as osConstants } from "node:os";

const execFileAsync = promisify(execFile);

const ENDPOINT = "https://stitch.googleapis.com/mcp";
const QUOTA_PROJECT = process.env.STITCH_QUOTA_PROJECT || "stich-for-ai";
const TOKEN_TTL_MS = 45 * 60 * 1000; // refresh well before the ~1h expiry
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000; // time the user gets to sign in
const LOGIN_COOLDOWN_MS = 10 * 60 * 1000; // no new browser login after a failure
const MANUAL_LOGIN_CMD = "gcloud auth application-default login";

// The only methods sent with a token (and allowed to trigger the browser
// login). Everything else goes out unauthenticated.
const AUTH_METHODS = new Set(["tools/call", "resources/read"]);

let cachedToken = null;
let cachedAt = 0;
let mintInFlight = null; // Promise of the running token mint, shared by callers

let loginInFlight = null; // Promise of the running login, shared by callers
let loginChild = null; // running `gcloud ... login` process, killed on shutdown
let loginTimer = null; // its LOGIN_TIMEOUT_MS timer
let shutdownReason = ""; // set on stdin EOF / signal; blocks new logins
let cooldownUntil = 0; // epoch ms; no automatic login before this
let lastLoginError = "";

const log = (msg) => process.stderr.write(`[stitch-proxy] ${msg}\n`);

const errDetail = (err) => (err.stderr || err.message || "").trim();

// Single-flight: concurrent callers share one gcloud call and its result, so
// one caller can't fail into the login flow while another one succeeds.
function mintToken() {
  mintInFlight ??= execFileAsync(
    "gcloud",
    ["auth", "application-default", "print-access-token"],
    { timeout: 30_000 },
  )
    .then(({ stdout }) => {
      cachedToken = stdout.trim();
      cachedAt = Date.now();
      return cachedToken;
    })
    .finally(() => {
      mintInFlight = null;
    });
  return mintInFlight;
}

function signInRequired(reason) {
  const next = new Date(cooldownUntil).toLocaleTimeString();
  return (
    `Google sign-in is required to use Stitch. ${reason} ` +
    `The next automatic browser sign-in is allowed after ${next}. ` +
    `To sign in now, run: ${MANUAL_LOGIN_CMD}`
  );
}

function notify() {
  const script =
    'display notification "Sign in to Google in the browser to use Stitch" with title "Stitch MCP"';
  execFileAsync("osascript", ["-e", script], { timeout: 10_000 }).catch((err) =>
    log(`notification failed (continuing): ${errDetail(err)}`),
  );
}

// Runs the interactive gcloud login; resolves on exit code 0.
function runLogin() {
  return new Promise((resolve, reject) => {
    log(`starting browser sign-in (${MANUAL_LOGIN_CMD}), timeout ${LOGIN_TIMEOUT_MS / 60_000} min`);
    notify();

    // stdin ignored (no TTY prompts); child stdout+stderr -> our stderr (fd 2),
    // because our stdout is the MCP channel.
    const child = spawn("gcloud", ["auth", "application-default", "login"], {
      stdio: ["ignore", 2, 2],
    });
    loginChild = child;

    let timedOut = false;
    loginTimer = setTimeout(() => {
      timedOut = true;
      child.kill(); // frees the localhost:8085 callback port
    }, LOGIN_TIMEOUT_MS);

    const cleanup = () => {
      clearTimeout(loginTimer);
      loginTimer = null;
      loginChild = null;
    };
    child.on("error", (err) => {
      cleanup();
      reject(new Error(`could not start gcloud: ${err.message}`));
    });
    child.on("exit", (code, signal) => {
      cleanup();
      if (shutdownReason) reject(new Error(`sign-in aborted: ${shutdownReason}`));
      else if (timedOut) reject(new Error(`sign-in timed out after ${LOGIN_TIMEOUT_MS / 60_000} min`));
      else if (code === 0) resolve();
      else reject(new Error(`gcloud login exited with ${signal ?? `code ${code}`}`));
    });
  });
}

// Called on stdin EOF and on termination signals: no new logins, and a
// running one is killed so gcloud never orphans or holds localhost:8085.
function stopLogin(reason) {
  shutdownReason = reason;
  if (!loginChild) return;
  log(`aborting browser sign-in: ${reason}`);
  clearTimeout(loginTimer);
  loginChild.kill();
}

// Single-flight login guarded by the cooldown.
function ensureLogin() {
  if (loginInFlight) return loginInFlight;
  if (Date.now() < cooldownUntil) {
    log("token unavailable and sign-in cooldown active; not opening the browser");
    return Promise.reject(
      new Error(signInRequired(`The last automatic sign-in failed (${lastLoginError}).`)),
    );
  }
  if (shutdownReason) {
    log(`token unavailable; not starting browser sign-in: proxy shutting down (${shutdownReason})`);
    return Promise.reject(new Error(`Google sign-in not started: proxy shutting down (${shutdownReason})`));
  }

  loginInFlight = runLogin()
    .then(() => log("browser sign-in succeeded"))
    .catch((err) => {
      log(`browser sign-in failed: ${err.message}`);
      // Aborted by shutdown: no cooldown, just fail the waiting requests.
      if (shutdownReason) throw new Error(`Google sign-in aborted: proxy shutting down (${shutdownReason})`);
      lastLoginError = err.message;
      cooldownUntil = Date.now() + LOGIN_COOLDOWN_MS;
      throw new Error(signInRequired(`Automatic sign-in failed (${err.message}).`));
    })
    .finally(() => {
      loginInFlight = null;
    });
  return loginInFlight;
}

async function getToken(forceRefresh = false) {
  const fresh = Date.now() - cachedAt < TOKEN_TTL_MS;
  if (cachedToken && fresh && !forceRefresh) return cachedToken;
  cachedToken = null;

  // Always try minting first: a manual login must work even during cooldown.
  try {
    return await mintToken();
  } catch (err) {
    log(`token mint failed: ${errDetail(err)}`);
  }

  await ensureLogin();

  try {
    return await mintToken();
  } catch (err) {
    log(`token mint failed after sign-in: ${errDetail(err)}`);
    throw new Error(
      `Could not obtain a Google access token after sign-in. Run: ${MANUAL_LOGIN_CMD}\n${errDetail(err)}`,
    );
  }
}

async function post(body, token) {
  const headers = {
    "X-Goog-User-Project": QUOTA_PROJECT,
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(ENDPOINT, { method: "POST", headers, body });
}

function send(payload) {
  process.stdout.write(JSON.stringify(payload) + "\n");
}

function errorFor(id, message) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code: -32603, message } };
}

async function handle(raw, request) {
  let isNotification = true; // until proven otherwise: never answer garbage

  try {
    if (typeof request !== "object" || request === null) {
      throw new Error(`skipping non-object JSON-RPC message: ${raw.slice(0, 120)}`);
    }
    isNotification = request.id === undefined || request.id === null;

    let res;
    if (AUTH_METHODS.has(request.method)) {
      res = await post(raw, await getToken());

      // Token rejected mid-session -> mint a new one and retry once.
      if (res.status === 401 || res.status === 403) {
        log(`auth ${res.status}, refreshing token and retrying`);
        res = await post(raw, await getToken(true));
      }
    } else {
      res = await post(raw, null);
    }

    const text = await res.text();

    if (isNotification) return;

    if (!res.ok) {
      send(errorFor(request.id, `Stitch API HTTP ${res.status}: ${text.slice(0, 500)}`));
      return;
    }

    try {
      send(JSON.parse(text));
    } catch {
      send(errorFor(request.id, `Non-JSON response from Stitch API: ${text.slice(0, 500)}`));
    }
  } catch (err) {
    log(err.message);
    if (!isNotification) send(errorFor(request.id, err.message));
  }
}

// Requests still pending at shutdown get a best-effort error response; if the
// client is already gone the write fails with EPIPE, which is only logged.
process.stdout.on("error", (err) => log(`stdout write failed: ${err.message}`));

for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"]) {
  process.on(sig, () => {
    stopLogin(`received ${sig}`);
    process.exit(128 + osConstants.signals[sig]);
  });
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

for await (const line of rl) {
  const raw = line.trim();
  if (!raw) continue;

  let request;
  try {
    request = JSON.parse(raw);
  } catch {
    log(`skipping unparseable line: ${raw.slice(0, 120)}`);
    continue;
  }

  // Not awaited: a tool call waiting for sign-in must not block other requests.
  // handle() catches its own errors; the catch is a last-resort safety net.
  handle(raw, request).catch((err) => log(`unexpected error: ${err.stack || err.message}`));
}

// Client closed stdin: abort a running login so the process can exit as soon
// as the remaining in-flight requests have settled.
stopLogin("stdin closed");
