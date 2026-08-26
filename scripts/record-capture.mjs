import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const providerLobbies = Object.freeze({
  CMD: new Set(["CMD"]), IM: new Set(["IM"]), SABA: new Set(["SABA"]),
  SBOBET: new Set(["KSPORT", "SBO"]), APSPORT: new Set(["TSPORT"]), BTI: new Set(["BTI"])
});
const bridgeUrl = "ws://127.0.0.1:4310/api/chrome-bridge";

export function parseRecordArguments(argv, env = process.env) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) values.set(argv[index], argv[index + 1]);
  const provider = values.get("--provider")?.toUpperCase();
  const durationMs = Number(values.get("--duration-ms") ?? 180_000);
  const waitForSocketMs = Number(values.get("--wait-for-socket-ms") ?? 60_000);
  const cdpUrl = values.get("--cdp") ?? "http://127.0.0.1:9333";
  const localAppData = env.LOCALAPPDATA;
  const output = values.get("--output") ?? (typeof localAppData === "string"
    ? join(localAppData, "tool-chenh", "chrome-bridge-captures", `capture-recorded-${Date.now()}.jsonl`)
    : null);
  if (providerLobbies[provider] === undefined || !Number.isSafeInteger(durationMs) || durationMs < 1_000 ||
    !Number.isSafeInteger(waitForSocketMs) || waitForSocketMs < 1_000 || typeof cdpUrl !== "string" ||
    typeof output !== "string") {
    throw new Error("USAGE: --provider <CMD|IM|SABA|SBOBET|APSPORT|BTI> " +
      "[--duration-ms <ms>] [--wait-for-socket-ms <ms>] [--cdp <http-url>] [--output <file.jsonl>]");
  }
  return { provider, durationMs, waitForSocketMs, cdpUrl, output: resolve(output) };
}

export function sanitizeBridgeEnvelope(value) {
  if (!isBridgeEnvelope(value)) return null;
  if (value.payload?.encoding !== "UTF8" || typeof value.payload.body !== "string") return structuredClone(value);
  let body = value.payload.body;
  try { body = JSON.stringify(redactJson(JSON.parse(body))); }
  catch { body = body.replace(/([?&](?:token|session|operatorToken|loginname)=)[^&#\s]*/giu, "$1[REDACTED]"); }
  return { ...value, payload: { ...value.payload, body } };
}

export async function recordCapture(options) {
  let targetsResponse;
  try { targetsResponse = await fetch(new URL("/json/list", options.cdpUrl)); }
  catch { throw new Error("CDP_ENDPOINT_UNAVAILABLE"); }
  if (!targetsResponse.ok) throw new Error(`CDP_TARGETS_HTTP_${targetsResponse.status}`);
  const targets = await targetsResponse.json();
  const workers = Array.isArray(targets) ? targets.filter((target) => target?.type === "service_worker" &&
    typeof target.url === "string" && target.url.startsWith("chrome-extension://") &&
    typeof target.webSocketDebuggerUrl === "string") : [];
  if (workers.length === 0) throw new Error("EXTENSION_SERVICE_WORKER_CDP_TARGET_REQUIRED");

  await mkdir(dirname(options.output), { recursive: true });
  const clients = await Promise.all(workers.map(async (target) => CdpClient.connect(target.webSocketDebuggerUrl)));
  let owner = null;
  let bridgeRequestId = null;
  let openedAtMs = null;
  let envelopes = 0;
  let bytes = 0;
  let snapshotRequested = false;
  let writeTail = Promise.resolve();
  let resolveOpen;
  const opened = new Promise((resolveOpenPromise) => { resolveOpen = resolveOpenPromise; });

  try {
    for (const client of clients) {
      client.onEvent((message) => {
        if (message.method === "Network.webSocketCreated" && message.params?.url === bridgeUrl && owner === null) {
          owner = client;
          bridgeRequestId = message.params.requestId;
          openedAtMs = Date.now();
          writeTail = writeFile(options.output, "", "utf8");
          resolveOpen();
          return;
        }
        if (client !== owner || message.method !== "Network.webSocketFrameSent" ||
          message.params?.requestId !== bridgeRequestId || typeof message.params?.response?.payloadData !== "string") return;
        let parsed;
        try { parsed = JSON.parse(message.params.response.payloadData); } catch { return; }
        if (!providerLobbies[options.provider].has(parsed?.lobby)) return;
        const sanitized = sanitizeBridgeEnvelope(parsed);
        if (sanitized === null) return;
        const line = `${JSON.stringify(sanitized)}\n`;
        bytes += Buffer.byteLength(line, "utf8");
        if (bytes > 64 * 1024 * 1024) return;
        envelopes += 1;
        writeTail = writeTail.then(() => appendFile(options.output, line, "utf8"));
        if (!snapshotRequested) {
          snapshotRequested = true;
          void requestSnapshot(sanitized.sourceId);
        }
      });
      await client.send("Network.enable");
    }
    await withTimeout(opened, options.waitForSocketMs, "BRIDGE_SOCKET_OPEN_NOT_OBSERVED");
    await new Promise((resolveWait) => setTimeout(resolveWait, options.durationMs));
    await writeTail;
  } finally {
    await Promise.allSettled(clients.map((client) => client.close()));
  }
  if (openedAtMs === null) throw new Error("BRIDGE_SOCKET_OPEN_NOT_OBSERVED");
  if (envelopes === 0) throw new Error("NO_PROVIDER_ENVELOPES_RECORDED");
  const result = { provider: options.provider, capture: options.output, envelopes,
    socketOpenedAtMs: openedAtMs, durationMs: options.durationMs, bytes };
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return result;
}

class CdpClient {
  #socket;
  #nextId = 1;
  #pending = new Map();
  #listeners = new Set();

  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolveOpen, rejectOpen) => {
      socket.addEventListener("open", resolveOpen, { once: true });
      socket.addEventListener("error", () => rejectOpen(new Error("CDP_WEBSOCKET_FAILED")), { once: true });
    });
    return new CdpClient(socket);
  }

  constructor(socket) {
    this.#socket = socket;
    socket.addEventListener("message", (event) => {
      let message;
      try { message = JSON.parse(String(event.data)); } catch { return; }
      if (Number.isSafeInteger(message.id)) {
        const pending = this.#pending.get(message.id);
        if (pending === undefined) return;
        this.#pending.delete(message.id);
        if (message.error) pending.reject(new Error("CDP_COMMAND_FAILED"));
        else pending.resolve(message.result);
        return;
      }
      for (const listener of this.#listeners) listener(message);
    });
  }

  onEvent(listener) { this.#listeners.add(listener); }

  send(method, params = {}) {
    const id = this.#nextId++;
    return new Promise((resolveCommand, rejectCommand) => {
      this.#pending.set(id, { resolve: resolveCommand, reject: rejectCommand });
      this.#socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.#socket.close();
    for (const pending of this.#pending.values()) pending.reject(new Error("CDP_CLOSED"));
    this.#pending.clear();
  }
}

async function requestSnapshot(sourceId) {
  try {
    await fetch("http://127.0.0.1:4310/api/chrome-bridge/request-snapshot", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ sourceId }), signal: AbortSignal.timeout(2_000)
    });
  } catch { /* command delivery is enough; the baseline confirmation may outlive this capture request */ }
}

function isBridgeEnvelope(value) {
  return typeof value === "object" && value !== null && value.version === 1 && value.kind === "NETWORK" &&
    typeof value.lobby === "string" && typeof value.sourceId === "string" && Number.isSafeInteger(value.tabId) &&
    Number.isSafeInteger(value.sequence) && Number.isFinite(value.observedAtMs) &&
    typeof value.transport === "string" && typeof value.request === "object" && value.request !== null &&
    typeof value.payload === "object" && value.payload !== null;
}

function redactJson(value) {
  if (Array.isArray(value)) return value.map(redactJson);
  if (typeof value !== "object" || value === null) return value;
  const result = {};
  for (const [key, nested] of Object.entries(value)) {
    if (/(?:authorization|cookie|loginname|operator.?token|password|secret|session|token|api.?key)/iu.test(key)) continue;
    result[key] = redactJson(nested);
  }
  return result;
}

function withTimeout(promise, timeoutMs, code) {
  let timer;
  return Promise.race([promise, new Promise((_, rejectWait) => {
    timer = setTimeout(() => rejectWait(new Error(code)), timeoutMs);
  })]).finally(() => clearTimeout(timer));
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await recordCapture(parseRecordArguments(process.argv.slice(2))); }
  catch (error) {
    process.stderr.write(`record-capture failed: ${error instanceof Error ? error.message : "RECORD_FAILED"}\n`);
    process.exitCode = 1;
  }
}
