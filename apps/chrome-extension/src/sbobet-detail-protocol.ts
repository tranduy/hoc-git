import type { SbobetDetailBatch, SbobetPrematchEvent } from "./sbobet-catalog-refresh.js";
import { SBOBET_RETRY_AFTER_EXPRESSION } from "./sbobet-request-backoff.js";

export type SbobetDetailBinding = {
  readonly sourceGeneration: number;
  readonly tabGeneration: number;
  readonly executionOrigin: string;
} & ({ readonly frameId: string; readonly loaderId: string; readonly sessionId?: string;
  readonly verifiedWorker?: false } | { readonly verifiedWorker: true;
  readonly targetId: string; readonly sessionId: string });

export interface SbobetDetailTemplate {
  readonly url: string;
  readonly observedEventId: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly binding: SbobetDetailBinding;
}

/** The observer must verify the target/document before supplying this binding. */
export function sbobetDetailTemplateFromObserved(input: {
  readonly url: unknown; readonly method: unknown; readonly headers?: unknown;
  readonly binding: SbobetDetailBinding;
}): SbobetDetailTemplate | null {
  if (input.method !== "GET" || typeof input.url !== "string" || input.url.length > 16_384 ||
    !validBinding(input.binding)) return null;
  let url: URL;
  try { url = new URL(input.url); } catch { return null; }
  const eventIds = url.searchParams.getAll("eventId");
  if (url.protocol !== "https:" || !providerHost(url.hostname) || url.username || url.password || url.hash ||
    url.pathname !== "/api/v2/getEvent" || eventIds.length !== 1 || !/^\d{1,30}$/u.test(eventIds[0]!) ||
    !/[?&]eventId=\d{1,30}(?:&|$)/u.test(input.url)) return null;
  if (input.headers !== undefined && (input.headers === null || typeof input.headers !== "object" ||
    Array.isArray(input.headers))) return null;
  const entries = Object.entries(input.headers ?? {});
  if (entries.length > 64) return null;
  const headers: Record<string, string> = {};
  let chars = 0;
  for (const [name, value] of entries) {
    if (/^(?:cookie2?$|host$|content-length$|accept-encoding$|connection$|origin$|referer$|user-agent$|sec-|proxy-|:)/iu.test(name)) continue;
    if (!/^[a-z0-9-]{1,128}$/iu.test(name) || typeof value !== "string" || /[\r\n\0]/u.test(value) ||
      value.length > 8_192 || (chars += name.length + value.length) > 32_768) return null;
    headers[name] = value;
  }
  return { url: input.url, observedEventId: eventIds[0]!, headers, binding: { ...input.binding } };
}

/** No endpoint/query fallback: only an observed eventId value may change. */
export function buildSbobetDetailFetchExpression(template: SbobetDetailTemplate | null,
  eventId: string, options: { readonly timeoutMs?: number;
    /** True only after independent evidence proves this observed endpoint returns all native groups. */
    readonly marketContainerCompletenessVerified?: boolean } = {}): string | null {
  const timeoutMs = options.timeoutMs ?? 7_500;
  if (template === null || !/^\d{1,30}$/u.test(eventId) || !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0 || timeoutMs > 30_000) return null;
  const validated = sbobetDetailTemplateFromObserved({ ...template, method: "GET" });
  if (validated === null || validated.observedEventId !== template.observedEventId) return null;
  const request = { url: template.url.replace(/([?&]eventId=)\d{1,30}(?=&|$)/u, `$1${eventId}`),
    eventId, headers: validated.headers, executionOrigin: validated.binding.executionOrigin, timeoutMs,
    marketContainerCompletenessVerified: options.marketContainerCompletenessVerified === true };
  return `(async () => {
    const input = ${JSON.stringify(request)};
    const parseSbobetDetailEvent = (body, eventId) => (${parseNativeEvent.toString()})(
      body, eventId, ${nativeEventCandidates.toString()}, ${cloneNativeEvent.toString()});
    if (location.origin !== input.executionOrigin) return { status: 0, marketContainerComplete: false };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
    try {
      const response = await fetch(input.url, { method: 'GET', headers: input.headers,
        credentials: 'include', cache: 'no-store', redirect: 'error', signal: controller.signal });
      if (response.status !== 200) {
        return { status: response.status, marketContainerComplete: false,
          retryAfterMs: ${SBOBET_RETRY_AFTER_EXPRESSION}(response.headers?.get('retry-after')) };
      }
      const text = await response.text();
      if (controller.signal.aborted || text.length > 4000000) return { status: 200, marketContainerComplete: false };
      const event = parseSbobetDetailEvent(JSON.parse(text), input.eventId);
      return event === null ? { status: 200, marketContainerComplete: false }
        : { status: 200, marketContainerComplete: input.marketContainerCompletenessVerified, event };
    } catch { return { status: 0, marketContainerComplete: false }; }
    finally { clearTimeout(timeout); }
  })()`;
}

export function parseSbobetDetailEvent(body: unknown, eventId: string): SbobetDetailBatch["event"] | null {
  return parseNativeEvent(body, eventId, nativeEventCandidates, cloneNativeEvent);
}

// Serialized dependencies are explicit arguments: bundled/minified sibling names
// must never become free references in the separately evaluated browser realm.
function parseNativeEvent(body: unknown, eventId: string, candidates: typeof nativeEventCandidates,
  clone: typeof cloneNativeEvent): SbobetDetailBatch["event"] | null {
  if (!/^\d{1,30}$/u.test(eventId)) return null;
  const events = candidates(body, true);
  if (events === null || events.length !== 1 || String(events[0]!["8"]) !== eventId) return null;
  return clone(events[0]!);
}

/** Phase comes from the proven roster request/receipt, never from a guessed compact field. */
export function extractSbobetPrematchRoster(body: unknown,
  options: { readonly phase: "PREMATCH" | "LIVE"; readonly maxEvents?: number }): readonly SbobetPrematchEvent[] | null {
  const maxEvents = options.maxEvents ?? 2_048;
  if (!Number.isSafeInteger(maxEvents) || maxEvents < 1 || maxEvents > 20_000 ||
    options.phase !== "PREMATCH" && options.phase !== "LIVE") return null;
  const candidates = nativeEventCandidates(body, false);
  if (candidates === null || candidates.length > maxEvents) return null;
  if (options.phase === "LIVE") return [];
  const ids = new Set<string>();
  const events: SbobetPrematchEvent[] = [];
  for (const candidate of candidates) {
    const eventId = String(candidate["8"]);
    const kickoff = candidate["0"];
    const home = candidate["2"];
    const away = candidate["3"];
    if (ids.has(eventId) || typeof home !== "string" || typeof away !== "string" ||
      !home.trim() || !away.trim() || home.trim() === away.trim() || typeof kickoff !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/u.test(kickoff)) return null;
    const startAtUtcMs = Date.parse(kickoff);
    if (!Number.isSafeInteger(startAtUtcMs) || startAtUtcMs < 0) return null;
    ids.add(eventId);
    events.push({ eventId, startAtUtcMs, phase: "PREMATCH" });
  }
  return events;
}

function providerHost(host: string): boolean {
  return host === "sb21.net" || host.endsWith(".sb21.net") ||
    host === "zenandfe.com" || host === "prod20091.fxf774.com";
}

function validBinding(binding: SbobetDetailBinding): boolean {
  if (binding === null || typeof binding !== "object" ||
    !Number.isSafeInteger(binding.sourceGeneration) || binding.sourceGeneration < 0 ||
    !Number.isSafeInteger(binding.tabGeneration) || binding.tabGeneration < 0) return false;
  try {
    const origin = new URL(binding.executionOrigin);
    if (origin.protocol !== "https:" || !providerHost(origin.hostname) || origin.origin !== binding.executionOrigin) return false;
  } catch { return false; }
  const identifier = (value: unknown): boolean => typeof value === "string" && value.length > 0 && value.length <= 512;
  return binding.verifiedWorker === true ? identifier(binding.targetId) && identifier(binding.sessionId)
    : identifier(binding.frameId) && identifier(binding.loaderId) &&
      (binding.sessionId === undefined || identifier(binding.sessionId));
}

/** Self-contained helpers are embedded in the bound browser expression. */
function nativeEventCandidates(body: unknown, allowDirect: boolean): readonly Record<string, unknown>[] | null {
  const object = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === "object" && !Array.isArray(value);
  const event = (value: unknown): value is Record<string, unknown> => {
    if (!object(value) || Object.hasOwn(value, "error") || Object.hasOwn(value, "errors") ||
      value.success === false || !Object.hasOwn(value, "8") || !Object.hasOwn(value, "7")) return false;
    const id = value["8"];
    const groups = value["7"];
    if (typeof id !== "string" && (typeof id !== "number" || !Number.isSafeInteger(id)) ||
      !/^\d{1,30}$/u.test(String(id)) || !object(groups)) return false;
    const rows = Object.values(groups);
    return rows.length <= 256 && rows.every(Array.isArray) &&
      rows.reduce<number>((count, group) => count + (group as unknown[]).length, 0) <= 20_000;
  };
  if (allowDirect && event(body)) return [body];
  if (!Array.isArray(body) || body.length > 20_000) return null;
  if (allowDirect && body.every(event)) return body;
  if (body.some(Array.isArray) && !body.every(Array.isArray)) return null;
  const leagues: unknown[] = body.every(Array.isArray) ? body.flat(1) : body;
  if (leagues.length > 20_000) return null;
  const events: Record<string, unknown>[] = [];
  for (const league of leagues) {
    if (!object(league) || Object.hasOwn(league, "error") || Object.hasOwn(league, "errors") ||
      league.success === false || typeof league["1"] !== "string" || !league["1"].trim() ||
      !Array.isArray(league["2"])) return null;
    if (events.length + league["2"].length > 20_000) return null;
    for (const candidate of league["2"]) {
      if (!event(candidate)) return null;
      events.push(candidate);
    }
  }
  return events;
}

function cloneNativeEvent(event: Record<string, unknown>): SbobetDetailBatch["event"] | null {
  let visited = 0;
  let chars = 0;
  const ancestors = new Set<object>();
  const clone = (value: unknown, depth: number): unknown => {
    if (++visited > 100_000 || depth > 20) throw new Error("NATIVE_LIMIT");
    if (typeof value === "string") { chars += value.length; if (chars > 4_000_000) throw new Error("NATIVE_LIMIT"); return value; }
    if (value === null || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value !== "object" || ancestors.has(value) ||
      !Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
      throw new Error("NATIVE_NOT_JSON");
    }
    ancestors.add(value);
    const result = Array.isArray(value) ? Array.from(value, (child) => clone(child, depth + 1))
      : Object.fromEntries(Object.entries(value).map(([key, child]) => {
        chars += key.length;
        if (chars > 4_000_000) throw new Error("NATIVE_LIMIT");
        return [key, clone(child, depth + 1)];
      }));
    ancestors.delete(value);
    return result;
  };
  try {
    const cloned = clone(event, 0);
    return JSON.stringify(cloned).length <= 4_000_000 ? cloned as SbobetDetailBatch["event"] : null;
  } catch { return null; }
}
