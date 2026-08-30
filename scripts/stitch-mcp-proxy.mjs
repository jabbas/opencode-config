#!/usr/bin/env node
// stdio <-> HTTP proxy for the Stitch MCP endpoint.
//
// Why this exists: https://stitch.googleapis.com/mcp rejects API keys
// ("API keys are not supported by this API") and requires an OAuth2 access
// token. opencode.json can only inject static {file:...} header values, but
// OAuth tokens expire after ~1h. This proxy mints a fresh token from gcloud
// ADC on demand, so long sessions keep working.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createInterface } from "node:readline";

const execFileAsync = promisify(execFile);

const ENDPOINT = "https://stitch.googleapis.com/mcp";
const QUOTA_PROJECT = process.env.STITCH_QUOTA_PROJECT || "stich-for-ai";
const TOKEN_TTL_MS = 45 * 60 * 1000; // refresh well before the ~1h expiry

let cachedToken = null;
let cachedAt = 0;

const log = (msg) => process.stderr.write(`[stitch-proxy] ${msg}\n`);

async function getToken(forceRefresh = false) {
  const fresh = Date.now() - cachedAt < TOKEN_TTL_MS;
  if (cachedToken && fresh && !forceRefresh) return cachedToken;

  try {
    const { stdout } = await execFileAsync(
      "gcloud",
      ["auth", "application-default", "print-access-token"],
      { timeout: 30_000 },
    );
    cachedToken = stdout.trim();
    cachedAt = Date.now();
    return cachedToken;
  } catch (err) {
    const detail = (err.stderr || err.message || "").trim();
    throw new Error(
      `Could not obtain a Google access token. Run: gcloud auth application-default login\n${detail}`,
    );
  }
}

async function post(body, token) {
  return fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Goog-User-Project": QUOTA_PROJECT,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body,
  });
}

function send(payload) {
  process.stdout.write(JSON.stringify(payload) + "\n");
}

function errorFor(id, message) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code: -32603, message } };
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

  const isNotification = request.id === undefined || request.id === null;

  try {
    let token = await getToken();
    let res = await post(raw, token);

    // Token rejected mid-session -> mint a new one and retry once.
    if (res.status === 401 || res.status === 403) {
      log(`auth ${res.status}, refreshing token and retrying`);
      token = await getToken(true);
      res = await post(raw, token);
    }

    const text = await res.text();

    if (isNotification) continue;

    if (!res.ok) {
      send(errorFor(request.id, `Stitch API HTTP ${res.status}: ${text.slice(0, 500)}`));
      continue;
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
