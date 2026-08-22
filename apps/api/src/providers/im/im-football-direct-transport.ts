import { createHash } from "node:crypto";

const host = "imsports.directsb.net";
const snapshotPath = "/api/EventV6/GetSE";
const deltaPath = "/api/EventV6/GetSEDelta";
const allowedPaths = new Set([snapshotPath, deltaPath]);
const forbiddenReplayHeaders = /^(?:host|content-length|accept-encoding|connection|origin|referer|user-agent|sec-|:)/iu;

export interface ImFootballRequestTemplate {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Readonly<Record<string, unknown>>;
}

interface DirectTransportOptions {
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function validateTemplate(template: ImFootballRequestTemplate): URL {
  let parsed: URL;
  try { parsed = new URL(template.url); } catch { throw new Error("IM_FOOTBALL_DIRECT_UNAVAILABLE"); }
  if (parsed.protocol !== "https:" || parsed.hostname !== host || parsed.username !== "" || parsed.password !== "" ||
    !allowedPaths.has(parsed.pathname) || parsed.search !== "" || object(template.body) === null) {
    throw new Error("IM_FOOTBALL_DIRECT_UNAVAILABLE");
  }
  return parsed;
}

function replayHeaders(headers: Readonly<Record<string, string>>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [rawName, rawValue] of Object.entries(headers)) {
    const name = rawName.toLowerCase().trim();
    if (name === "" || forbiddenReplayHeaders.test(name) || /[\r\n]/u.test(rawValue)) continue;
    result[name] = rawValue;
  }
  result["content-type"] = "application/json";
  return result;
}

function isAcceptedEnvelope(path: string, value: unknown): value is Record<string, unknown> {
  const root = object(value);
  if (root === null || root.StatusCode !== 100) return false;
  return path === snapshotPath ? Array.isArray(root.sel) : path === deltaPath && Array.isArray(root.dc);
}

function requestKey(template: ImFootballRequestTemplate): string {
  return createHash("sha256").update(JSON.stringify([template.url, template.headers, template.body])).digest("hex");
}

export class ImFootballDirectTransport {
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;
  readonly #inFlight = new Map<string, Promise<Readonly<Record<string, unknown>>>>();

  constructor(options: DirectTransportOptions = {}) {
    this.#fetch = options.fetchImpl ?? fetch;
    this.#timeoutMs = options.timeoutMs ?? 3_000;
    if (!Number.isFinite(this.#timeoutMs) || this.#timeoutMs <= 0) throw new Error("IM_FOOTBALL_DIRECT_OPTIONS_INVALID");
  }

  async read(template: ImFootballRequestTemplate): Promise<Readonly<Record<string, unknown>>> {
    const key = requestKey(template);
    const active = this.#inFlight.get(key);
    if (active !== undefined) return active;
    const operation = this.#read(template).finally(() => {
      if (this.#inFlight.get(key) === operation) this.#inFlight.delete(key);
    });
    this.#inFlight.set(key, operation);
    return operation;
  }

  async #read(template: ImFootballRequestTemplate): Promise<Readonly<Record<string, unknown>>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      const url = validateTemplate(template);
      const response = await this.#fetch(url.toString(), {
        method: "POST",
        headers: replayHeaders(template.headers),
        body: JSON.stringify(template.body),
        cache: "no-store",
        redirect: "error",
        signal: controller.signal
      });
      if (!response.ok) throw new Error("IM_FOOTBALL_DIRECT_UNAVAILABLE");
      const body: unknown = await response.json();
      if (!isAcceptedEnvelope(url.pathname, body)) throw new Error("IM_FOOTBALL_DIRECT_UNAVAILABLE");
      return body;
    } catch {
      throw new Error("IM_FOOTBALL_DIRECT_UNAVAILABLE");
    } finally {
      clearTimeout(timer);
    }
  }
}
