import { extractSbobetMoreRoster } from "./sbobet-more-roster.js";

const MAX_BODY_BYTES = 12_000_000;
const REQUIRED_QUERY: Readonly<Record<string, string>> = { sportId: "1", sportType: "1_1", oddsStyle: "ma" };
const ALLOWED_QUERY = new Set(["timeRange", ...Object.keys(REQUIRED_QUERY), "agentId", "pinLeague", "sortByTime"]);

export interface SbobetEarlyRequest { readonly url: string }
export interface SbobetEarlyBatch {
  readonly kind: "SBOBET_EARLY_CATALOG";
  readonly generation: string;
  readonly requestStartSequence: number;
  readonly observedAtMs: number;
  readonly rosterComplete: true;
  readonly body: readonly unknown[];
}

/** All dates is the unfiltered getEvent/early route, distinct from getEventByDate. */
export function sbobetEarlyRequestFromObserved(urlValue: unknown, method: unknown): SbobetEarlyRequest | null {
  return method === "GET" && scopedRequest(urlValue, ["early"]) !== null ? { url: urlValue as string } : null;
}

/** The caller must establish a successful, current native main receipt before deriving this URL. */
export function sbobetEarlyRequestFromMain(urlValue: unknown): SbobetEarlyRequest | null {
  const url = scopedRequest(urlValue, ["live", "today"]);
  if (url === null) return null;
  url.searchParams.set("timeRange", "early");
  return { url: url.href };
}

function scopedRequest(value: unknown, phases: readonly string[]): URL | null {
  if (typeof value !== "string" || value.length > 4096 || /[\u0000-\u0020\u007f]/u.test(value)) return null;
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.origin !== "https://be.sb21.net" || url.username || url.password || url.hash ||
    url.pathname !== "/api/v2/getEvent") return null;
  const query = url.searchParams;
  if ([...query.keys()].some(key => !ALLOWED_QUERY.has(key) || query.getAll(key).length !== 1) ||
    !phases.includes(query.get("timeRange") ?? "") ||
    Object.entries(REQUIRED_QUERY).some(([key, expected]) => query.get(key) !== expected) ||
    query.has("pinLeague") && query.get("pinLeague") !== "false" ||
    query.has("sortByTime") && !["true", "false"].includes(query.get("sortByTime") ?? "") ||
    query.has("agentId") && (!query.get("agentId")?.trim() || /[\u0000-\u001f\u007f]/u.test(query.get("agentId")!))) return null;
  return url;
}

/** Complete Early roster authority only; retain the native response and every duplicate container. */
export function sbobetEarlyBatchFromResponse(request: SbobetEarlyRequest, body: string,
  receipt: { readonly generation: string; readonly requestStartSequence: number; readonly observedAtMs: number }): SbobetEarlyBatch | null {
  if (sbobetEarlyRequestFromObserved(request.url, "GET") === null || typeof body !== "string" ||
    body.length > MAX_BODY_BYTES || new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES ||
    typeof receipt.generation !== "string" || !receipt.generation.trim() || receipt.generation.length > 256 ||
    /[\u0000-\u001f\u007f]/u.test(receipt.generation) ||
    !Number.isSafeInteger(receipt.requestStartSequence) || receipt.requestStartSequence < 0 ||
    !Number.isSafeInteger(receipt.observedAtMs) || receipt.observedAtMs <= 0) return null;
  let native: unknown;
  try { native = JSON.parse(body); } catch { return null; }
  const owners = extractSbobetMoreRoster(native, "PREMATCH");
  if (owners === null || owners.length > 2048) return null;
  const payload = native as unknown[];
  const leagues = payload.some(Array.isArray) ? (payload as unknown[][]).flat() : payload;
  for (const league of leagues as Record<string, unknown>[]) {
    for (const event of league["2"] as Record<string, unknown>[]) {
      const eventId = String(event["8"]);
      for (const rows of Object.values(event["7"] as Record<string, unknown[]>)) {
        for (const row of rows) {
          if (typeof row !== "string" || row.length > 1500) return null;
          for (const token of row.trim().split(/\s+/u)) {
            if (!token.includes("*")) continue;
            const selection = /^-?\d+(?:\.\d+)?\*(\d+[had])$/u.exec(token);
            if (selection === null || !selection[1]!.startsWith(eventId)) return null;
          }
        }
      }
    }
  }
  return { kind: "SBOBET_EARLY_CATALOG", generation: receipt.generation,
    requestStartSequence: receipt.requestStartSequence, observedAtMs: receipt.observedAtMs,
    rosterComplete: true, body: payload };
}

/** Return bounded raw HTTP evidence. The observer emits the correlated native receipt exactly once. */
export function buildSbobetEarlyFetchExpression(request: SbobetEarlyRequest, executionOrigin: string,
  headers: Readonly<Record<string, string>>): string | null {
  const bound = sbobetEarlyRequestFromObserved(request.url, "GET");
  let origin: URL;
  try { origin = new URL(executionOrigin); } catch { return null; }
  if (bound === null || origin.protocol !== "https:" || origin.origin !== executionOrigin ||
    origin.username || origin.password || origin.search || origin.hash) return null;
  const forbidden = /^(?:cookie2?$|host$|content-length$|accept-charset$|accept-encoding$|access-control-request-|connection$|date$|dnt$|expect$|keep-alive$|origin$|permissions-policy$|referer$|te$|trailer$|transfer-encoding$|upgrade$|user-agent$|via$|sec-|proxy-)/iu;
  const nativeHeaders = Object.fromEntries(Object.entries(headers).filter(([name, value]) =>
    /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/u.test(name) && !forbidden.test(name) &&
    typeof value === "string" && !/[\u0000-\u001f\u007f]/u.test(value)));
  return `(async () => {
    const input = ${JSON.stringify({ url: bound.url, executionOrigin, headers: nativeHeaders, maxBytes: MAX_BODY_BYTES })};
    if (location.origin !== input.executionOrigin) return { status: 0 };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7500);
    try {
      const response = await fetch(input.url, { method: 'GET', credentials: 'include', headers: input.headers,
        cache: 'no-store', redirect: 'error', signal: controller.signal });
      if (controller.signal.aborted || location.origin !== input.executionOrigin) return { status: 0 };
      if (response.status !== 200) {
        const retry = response.headers?.get('retry-after');
        return { status: response.status, ...(typeof retry === 'string' && /^\\d+$/u.test(retry)
          ? { retryAfterMs: Math.min(Number(retry) * 1000, 300000) } : {}) };
      }
      if (Number(response.headers?.get('content-length')) > input.maxBytes || !response.body) {
        controller.abort();
        return { status: 0 };
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8', { fatal: true });
      let body = '', bytes = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (controller.signal.aborted || location.origin !== input.executionOrigin) return { status: 0 };
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > input.maxBytes) { controller.abort(); return { status: 0 }; }
          body += decoder.decode(chunk.value, { stream: true });
        }
        body += decoder.decode();
        return { status: 200, body };
      } finally { reader.releaseLock(); }
    } catch { return { status: 0 }; }
    finally { clearTimeout(timeout); }
  })()`;
}
