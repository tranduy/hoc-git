#!/usr/bin/env node
// Read-only provider traffic recon.
//
// Launches an isolated Chrome, opens every sportsbook listed in the lounge file,
// and records which transport actually carries odds UPDATES after the initial
// load. Nothing is sent to the provider beyond normal page traffic.
//
// Usage:
//   node scripts/recon-provider-realtime.mjs [observeMs] [outputPath] [lounge.md]
//
// Secrets: URLs, headers and bodies are never persisted. Only host, path,
// payload sizes, digests and coarse shape classifications are written out.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import WebSocket from "ws";

const OBSERVE_MS = Number(process.argv[2] ?? 120_000);
const OUTPUT_PATH = process.argv[3] ?? ".run/recon/provider-realtime.json";
const LOUNGE_PATH = process.argv[4] ?? "sảnh.md";
const BUCKET_MS = 15_000;
const DEBUG_PORT = Number(process.env.RECON_CDP_PORT ?? 9333);
const PROFILE_DIR = resolve(".run/recon/profile");
const SAMPLE_LIMIT = 6;
const SAMPLE_CHARS = 320;

const tokenish = /([?&](?:token|operatorToken|access_token|sid|auth)=)[^&\s"']+/giu;
const longHex = /\b[0-9a-f]{24,}\b/giu;
const sessionSegment = /\(S\([^)]*\)\)/giu;

function redact(text) {
  return String(text).replace(tokenish, "$1<redacted>").replace(sessionSegment, "(S(<redacted>))")
    .replace(longHex, "<hex>");
}

function digest(text) {
  return createHash("sha256").update(String(text)).digest("hex").slice(0, 12);
}

function safeLocation(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    return { host: parsed.host, path: redact(parsed.pathname), scheme: parsed.protocol.replace(":", "") };
  } catch {
    return { host: "<unparsed>", path: "<unparsed>", scheme: "<unparsed>" };
  }
}

// Classifies a websocket payload without retaining provider content.
function classifyFrame(payload) {
  const text = typeof payload === "string" ? payload : "";
  const length = text.length;
  if (length === 0) return "EMPTY";
  if (length <= 3) return "HEARTBEAT_TINY";
  const head = text.slice(0, 24);
  if (/^\s*[\n\r]+$/u.test(text)) return "STOMP_HEARTBEAT";
  if (/^h$|^o$/u.test(text.trim())) return "SOCKJS_CONTROL";
  if (/^(?:2|3|40|41)\b/u.test(head) && length < 16) return "SOCKETIO_CONTROL";
  if (/^(?:MESSAGE|CONNECTED|RECEIPT|ERROR)\b/u.test(head)) return "STOMP_FRAME";
  if (/^a\[/u.test(head)) return "SOCKJS_ARRAY";
  if (/^(?:42|43)\[/u.test(head)) return "SOCKETIO_EVENT";
  if (/^[[{]/u.test(head.trimStart())) return "JSON";
  return `OTHER_${length < 64 ? "SMALL" : "LARGE"}`;
}

function parseLounge(text) {
  const entries = [];
  for (const line of text.split(/\r?\n/u)) {
    const match = /^\s*([A-Za-z0-9 _\-/]+)\s*:\s*(https?:\/\/\S+)\s*$/u.exec(line);
    if (match === null) continue;
    entries.push({ label: match[1].trim().toUpperCase().replace(/[\s_]+/gu, "-"), url: match[2] });
  }
  return entries;
}

class CdpClient {
  #socket;
  #nextId = 1;
  #pending = new Map();
  #listeners = new Set();

  constructor(socket) {
    this.#socket = socket;
    socket.on("message", (raw) => {
      let message;
      try { message = JSON.parse(String(raw)); } catch { return; }
      if (typeof message.id === "number" && this.#pending.has(message.id)) {
        const { resolveFn, rejectFn } = this.#pending.get(message.id);
        this.#pending.delete(message.id);
        if (message.error) rejectFn(new Error(message.error.message ?? "CDP_ERROR"));
        else resolveFn(message.result ?? {});
        return;
      }
      if (typeof message.method === "string") {
        for (const listener of this.#listeners) listener(message);
      }
    });
  }

  static async connect(endpoint) {
    const socket = new WebSocket(endpoint, { maxPayload: 512 * 1024 * 1024 });
    await new Promise((resolveFn, rejectFn) => {
      socket.once("open", resolveFn);
      socket.once("error", rejectFn);
    });
    return new CdpClient(socket);
  }

  onEvent(listener) { this.#listeners.add(listener); }

  send(method, params = {}, sessionId = undefined) {
    const id = this.#nextId++;
    const payload = { id, method, params };
    if (sessionId !== undefined) payload.sessionId = sessionId;
    return new Promise((resolveFn, rejectFn) => {
      this.#pending.set(id, { resolveFn, rejectFn });
      this.#socket.send(JSON.stringify(payload));
      setTimeout(() => {
        if (this.#pending.delete(id)) rejectFn(new Error(`CDP_TIMEOUT:${method}`));
      }, 20_000);
    });
  }

  close() { try { this.#socket.close(); } catch { /* already closed */ } }
}

function createProviderRecord(label, url) {
  return {
    label,
    origin: safeLocation(url),
    sessions: 0,
    childSessions: 0,
    documentNavigations: 0,
    sockets: new Map(),
    httpByPath: new Map(),
    frameBuckets: new Map(),
    httpBuckets: new Map(),
    samples: [],
    errors: []
  };
}

function bucketOf(startedAtMs) {
  return Math.floor((Date.now() - startedAtMs) / BUCKET_MS) * (BUCKET_MS / 1000);
}

function bump(map, key) { map.set(key, (map.get(key) ?? 0) + 1); }

async function main() {
  const loungeText = await readFile(resolve(LOUNGE_PATH), "utf8");
  const providers = parseLounge(loungeText);
  if (providers.length === 0) throw new Error("NO_PROVIDER_URLS_FOUND");

  await mkdir(PROFILE_DIR, { recursive: true });
  const { chromium } = await import("playwright");
  const executable = chromium.executablePath();

  const chrome = spawn(executable, [
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${PROFILE_DIR}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-features=Translate,MediaRouter",
    "--window-size=1400,900",
    "about:blank"
  ], { stdio: "ignore", detached: false });

  const endpoint = await waitForEndpoint(DEBUG_PORT, 30_000);
  const cdp = await CdpClient.connect(endpoint);

  const bySession = new Map();
  const records = new Map();
  const startedAtMs = Date.now();

  cdp.onEvent((message) => {
    try { handleEvent(message, { cdp, bySession, records, startedAtMs }); }
    catch (error) { /* recon must never abort on a single malformed event */ void error; }
  });

  for (const provider of providers) {
    const record = createProviderRecord(provider.label, provider.url);
    records.set(provider.label, record);
    try {
      const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
      const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
      bySession.set(sessionId, { label: provider.label, kind: "PAGE" });
      record.sessions += 1;
      await instrument(cdp, sessionId);
      await cdp.send("Page.navigate", { url: provider.url }, sessionId);
    } catch (error) {
      record.errors.push(redact(error instanceof Error ? error.message : String(error)));
    }
  }

  const keepAlive = setInterval(() => {
    for (const [sessionId, meta] of bySession) {
      if (meta.kind !== "PAGE") continue;
      cdp.send("Page.setWebLifecycleState", { state: "active" }, sessionId).catch(() => {});
    }
  }, 10_000);

  await new Promise((resolveFn) => setTimeout(resolveFn, OBSERVE_MS));
  clearInterval(keepAlive);

  const report = {
    startedAtMs,
    observedMs: Date.now() - startedAtMs,
    bucketSeconds: BUCKET_MS / 1000,
    providers: [...records.values()].map(summarize)
  };

  const outPath = resolve(OUTPUT_PATH);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

  cdp.close();
  chrome.kill();
}

async function instrument(cdp, sessionId) {
  await cdp.send("Network.enable",
    { maxTotalBufferSize: 16_000_000, maxResourceBufferSize: 12_000_000 }, sessionId);
  await cdp.send("Page.enable", {}, sessionId).catch(() => {});
  await cdp.send("Runtime.enable", {}, sessionId).catch(() => {});
  // Mirror the extension's anti-throttle treatment so cadence reflects production.
  await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true }, sessionId).catch(() => {});
  await cdp.send("Page.setWebLifecycleState", { state: "active" }, sessionId).catch(() => {});
  // KSPORT and other providers run their odds socket inside an OOPIF.
  await cdp.send("Target.setAutoAttach",
    { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, sessionId).catch(() => {});
}

function handleEvent(message, ctx) {
  const { cdp, bySession, records, startedAtMs } = ctx;
  const meta = message.sessionId === undefined ? undefined : bySession.get(message.sessionId);

  if (message.method === "Target.attachedToTarget") {
    const parent = meta ?? bySession.get(message.sessionId);
    const label = parent?.label ?? "<unknown>";
    const childSession = message.params.sessionId;
    bySession.set(childSession, { label, kind: "CHILD" });
    const record = records.get(label);
    if (record !== undefined) record.childSessions += 1;
    instrument(cdp, childSession).catch(() => {});
    cdp.send("Runtime.runIfWaitingForDebugger", {}, childSession).catch(() => {});
    return;
  }
  if (meta === undefined) return;
  const record = records.get(meta.label);
  if (record === undefined) return;
  const bucket = bucketOf(startedAtMs);

  switch (message.method) {
    case "Page.frameNavigated": {
      if (message.params.frame?.parentId === undefined) record.documentNavigations += 1;
      return;
    }
    case "Network.webSocketCreated": {
      const location = safeLocation(message.params.url);
      const key = `${location.host}${location.path}`;
      if (!record.sockets.has(key)) {
        record.sockets.set(key, { host: location.host, path: location.path, created: 0, framesReceived: 0,
          framesSent: 0, bytesReceived: 0, shapes: new Map(), digests: new Set(), buckets: new Map(),
          firstFrameAtMs: null, lastFrameAtMs: null });
      }
      record.sockets.get(key).created += 1;
      socketByRequest.set(message.params.requestId, key);
      return;
    }
    case "Network.webSocketFrameReceived":
    case "Network.webSocketFrameSent": {
      const payload = message.params.response?.payloadData ?? "";
      // A frame without a prior webSocketCreated means the socket predates this
      // debugger session - exactly the MV3 worker-restart case worth counting.
      const socketKey = socketByRequest.get(message.params.requestId) ?? "<orphan-socket>";
      if (!record.sockets.has(socketKey)) {
        record.sockets.set(socketKey, { host: "<orphan>", path: "<orphan>", created: 0,
          framesReceived: 0, framesSent: 0, bytesReceived: 0, shapes: new Map(), digests: new Set(),
          buckets: new Map(), firstFrameAtMs: null, lastFrameAtMs: null });
      }
      const socket = record.sockets.get(socketKey);
      if (message.method === "Network.webSocketFrameSent") { socket.framesSent += 1; return; }
      socket.framesReceived += 1;
      socket.bytesReceived += payload.length;
      socket.firstFrameAtMs ??= Date.now();
      socket.lastFrameAtMs = Date.now();
      bump(socket.shapes, classifyFrame(payload));
      bump(socket.buckets, bucket);
      bump(record.frameBuckets, bucket);
      if (socket.digests.size < 5000) socket.digests.add(digest(payload));
      if (payload.length > 64 && record.samples.length < SAMPLE_LIMIT) {
        record.samples.push({ transport: "WS", host: socket.host, path: socket.path,
          atSecond: bucket, length: payload.length, head: redact(payload.slice(0, SAMPLE_CHARS)) });
      }
      return;
    }
    case "Network.responseReceived": {
      const location = safeLocation(message.params.response?.url ?? "");
      const type = message.params.type;
      if (type !== "XHR" && type !== "Fetch" && type !== "Document") return;
      const key = `${location.host}${location.path}`;
      if (!record.httpByPath.has(key)) {
        record.httpByPath.set(key, { host: location.host, path: location.path, count: 0, statuses: new Map(),
          buckets: new Map() });
      }
      const entry = record.httpByPath.get(key);
      entry.count += 1;
      bump(entry.statuses, message.params.response?.status ?? 0);
      bump(entry.buckets, bucket);
      bump(record.httpBuckets, bucket);
      return;
    }
    default:
  }
}

function summarize(record) {
  return {
    label: record.label,
    origin: record.origin,
    sessions: record.sessions,
    childSessions: record.childSessions,
    documentNavigations: record.documentNavigations,
    errors: record.errors,
    frameBuckets: Object.fromEntries([...record.frameBuckets].sort((a, b) => a[0] - b[0])),
    httpBuckets: Object.fromEntries([...record.httpBuckets].sort((a, b) => a[0] - b[0])),
    sockets: [...record.sockets.values()].map((socket) => ({
      host: socket.host,
      path: socket.path,
      created: socket.created,
      framesReceived: socket.framesReceived,
      framesSent: socket.framesSent,
      bytesReceived: socket.bytesReceived,
      distinctPayloads: socket.digests.size,
      shapes: Object.fromEntries(socket.shapes),
      buckets: Object.fromEntries([...socket.buckets].sort((a, b) => a[0] - b[0])),
      activeSpanMs: socket.firstFrameAtMs === null ? 0 : socket.lastFrameAtMs - socket.firstFrameAtMs
    })).sort((a, b) => b.framesReceived - a.framesReceived),
    http: [...record.httpByPath.values()].map((entry) => ({
      host: entry.host,
      path: entry.path,
      count: entry.count,
      statuses: Object.fromEntries(entry.statuses),
      buckets: Object.fromEntries([...entry.buckets].sort((a, b) => a[0] - b[0]))
    })).sort((a, b) => b.count - a.count).slice(0, 25),
    samples: record.samples
  };
}

async function waitForEndpoint(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) {
        const body = await response.json();
        if (typeof body.webSocketDebuggerUrl === "string") return body.webSocketDebuggerUrl;
      }
    } catch { /* chrome is still starting */ }
    await new Promise((resolveFn) => setTimeout(resolveFn, 250));
  }
  throw new Error("CHROME_DEBUG_ENDPOINT_UNAVAILABLE");
}

// CDP reports websocket frames by requestId; resolved from Network.webSocketCreated.
const socketByRequest = new Map();

main().catch((error) => {
  process.stderr.write(`${redact(error instanceof Error ? error.stack ?? error.message : String(error))}\n`);
  process.exitCode = 1;
});
