export type ApsportRawEvent = Record<string, unknown>;

export interface ApsportRequestTemplate {
  readonly origin: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Readonly<Record<string, unknown>>;
}

type ApsportRosterRequestKind = "EVENTS" | "OTHER_LEAGUES" | "LEAGUE_TOPS";

export type ApsportCatalogPageRequest = {
  readonly kind: ApsportRosterRequestKind;
  readonly mode: 2 | 3 | 4;
  readonly url: string;
  readonly body: Readonly<Record<string, unknown>>;
} | {
  readonly kind: "DETAIL";
  readonly eventId: string;
  readonly url: string;
  readonly body: Readonly<Record<string, unknown>>;
};

export interface ApsportCatalogPageResponse {
  readonly status: number;
  readonly data: unknown;
  readonly retryAfterMs?: number;
}

export interface ApsportCatalogBatch {
  readonly schemaVersion: 1;
  readonly generation: string;
  readonly phase: "ROSTER" | "DETAIL";
  readonly complete: boolean;
  readonly trigger?: "SWEEP" | "EVENT_CHANGE";
  readonly prematchWindowHours: number;
  readonly records: readonly ApsportRawEvent[];
}

export interface CollectApsportCatalogOptions {
  readonly generation: string;
  readonly nowMs: number;
  readonly prematchWindowHours: number;
  readonly template: ApsportRequestTemplate;
  readonly request: (request: ApsportCatalogPageRequest) => Promise<ApsportCatalogPageResponse>;
  readonly sleep: (delayMs: number) => Promise<void>;
  readonly isCurrent: () => boolean;
  readonly onRoster: (batch: ApsportCatalogBatch) => Promise<void>;
  readonly onDetail: (batch: ApsportCatalogBatch) => Promise<void>;
  readonly detailBatchSize?: number;
  readonly detailDelayMs?: number;
}

export interface CollectApsportEventDetailOptions {
  readonly eventId: string;
  readonly template: ApsportRequestTemplate;
  readonly request: (request: ApsportCatalogPageRequest) => Promise<ApsportCatalogPageResponse>;
  readonly sleep: (delayMs: number) => Promise<void>;
  readonly isCurrent: () => boolean;
}

const modes = [2, 4, 3] as const;
const maxDetailAttempts = 5;
const maximumRetryDelayMs = 60_000;
const supportedMarketGroupIds = new Set([
  "3", "4", "5", "6", "19", "20", "21", "22", "31", "32", "33", "34", "80", "85"
]);
const marketSemanticsByGroup: Readonly<Record<string, { readonly marketType: string;
  readonly scope: string; readonly selections: readonly [string, string] }>> = {
  "3": { marketType: "FT_TOTAL", scope: "FULL_TIME", selections: ["OVER", "UNDER"] },
  "4": { marketType: "FH_TOTAL", scope: "FIRST_HALF", selections: ["OVER", "UNDER"] },
  "5": { marketType: "FT_AH", scope: "FULL_TIME", selections: ["HOME", "AWAY"] },
  "6": { marketType: "FH_AH", scope: "FIRST_HALF", selections: ["HOME", "AWAY"] },
  "19": { marketType: "CORNER_FT_AH", scope: "FULL_TIME", selections: ["HOME", "AWAY"] },
  "20": { marketType: "CORNER_FH_AH", scope: "FIRST_HALF", selections: ["HOME", "AWAY"] },
  "21": { marketType: "CORNER_FT_TOTAL", scope: "FULL_TIME", selections: ["OVER", "UNDER"] },
  "22": { marketType: "CORNER_FH_TOTAL", scope: "FIRST_HALF", selections: ["OVER", "UNDER"] },
  "31": { marketType: "CARD_FT_TOTAL", scope: "FULL_TIME", selections: ["OVER", "UNDER"] },
  "32": { marketType: "CARD_FH_TOTAL", scope: "FIRST_HALF", selections: ["OVER", "UNDER"] },
  "33": { marketType: "CARD_FT_AH", scope: "FULL_TIME", selections: ["HOME", "AWAY"] },
  "34": { marketType: "CARD_FH_AH", scope: "FIRST_HALF", selections: ["HOME", "AWAY"] },
  "80": { marketType: "SH_TOTAL", scope: "SECOND_HALF", selections: ["OVER", "UNDER"] },
  "85": { marketType: "SH_AH", scope: "SECOND_HALF", selections: ["HOME", "AWAY"] }
};

function record(value: unknown): ApsportRawEvent | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as ApsportRawEvent
    : null;
}

function scalar(value: unknown): string | null {
  return typeof value === "string" || typeof value === "number" ? String(value) : null;
}

function eventId(value: ApsportRawEvent): string | null {
  const id = scalar(value["2"]);
  return id !== null && id.trim() !== "" && id.length <= 128 ? id : null;
}

function activeEventEvidence(value: ApsportRawEvent): boolean {
  if (value["10"] === "Active") return true;
  if (value["10"] !== undefined && value["10"] !== null && value["10"] !== "") return false;
  return Array.isArray(value["50"]) && value["50"].some((candidate) => {
    const group = record(candidate);
    return group !== null && group["10"] === "Active" && supportedMarketGroupIds.has(String(group["3"])) &&
      Array.isArray(group["9"]) && group["9"].length > 0;
  });
}

function virtualFootballIdentity(value: ApsportRawEvent): boolean {
  const league = typeof value["53"] === "string" ? value["53"] : "";
  const teams = [value["5"], value["22"]].filter((team): team is string =>
    typeof team === "string" && team.trim() !== "");
  const label = league.normalize("NFKC").toLocaleLowerCase("en");
  if (/(?:e[\s-]?soccer|\bvirtual\b|simulated reality|soccer marble|\bpes\b|ảo|điện tử)/u.test(label)) return true;
  if (teams.some((team) => /\(v\)\s*$/iu.test(team))) return true;
  return teams.length === 2 && teams.every((team) =>
    /(?:\((?:pg|e|pes|v|s)\)(?:\s*\([^)]*\))*|\([a-z0-9_]{4,}\))\s*$/iu.test(team));
}

export function eligibleApsportFootballEvent(
  value: ApsportRawEvent,
  nowMs: number,
  prematchWindowHours: number
): boolean {
  if (!Number.isFinite(nowMs) || !Number.isSafeInteger(prematchWindowHours) ||
    prematchWindowHours < 1 || prematchWindowHours > 48 || eventId(value) === null ||
    !activeEventEvidence(value) || virtualFootballIdentity(value)) return false;
  if (value["6"] === true) return true;
  if (typeof value["11"] !== "string") return false;
  const startAtMs = Date.parse(value["11"]);
  if (!Number.isFinite(startAtMs)) return false;
  const cutoffMs = nowMs + prematchWindowHours * 60 * 60 * 1_000;
  return startAtMs >= nowMs && startAtMs <= cutoffMs;
}

export function apsportSelectionPriceFromEvent(value: ApsportRawEvent, identity: {
  readonly providerEventId: string; readonly providerMarketId: string;
  readonly providerSelectionId: string; readonly marketType: string; readonly scope: string;
  readonly selection: string; readonly line: string | null;
}): { readonly status: "FOUND"; readonly rawOdds: string } |
  { readonly status: "NOT_FOUND" | "AMBIGUOUS" } {
  if (eventId(value) !== identity.providerEventId || !activeEventEvidence(value) ||
    identity.line === null || !Array.isArray(value["50"])) return { status: "NOT_FOUND" };
  const requestedLine = Number(identity.line);
  if (!Number.isFinite(requestedLine)) return { status: "NOT_FOUND" };
  const matches: string[] = [];
  for (const candidateGroup of value["50"]) {
    const group = record(candidateGroup);
    const semantics = group === null ? undefined : marketSemanticsByGroup[String(group["3"])];
    if (group === null || group["10"] !== "Active" || semantics === undefined ||
      semantics.marketType !== identity.marketType || semantics.scope !== identity.scope || !Array.isArray(group["9"])) continue;
    for (const candidateOdd of group["9"]) {
      const odd = record(candidateOdd);
      const line = odd === null ? Number.NaN : Number(scalar(odd["7"]));
      if (odd === null || scalar(odd["6"]) !== identity.providerMarketId || !Number.isFinite(line) ||
        Math.abs(line - requestedLine) > 1e-9) continue;
      const selectionIndex = semantics.selections.indexOf(identity.selection);
      if (selectionIndex < 0) continue;
      const selectionKey = selectionIndex === 0 ? "0" : "2";
      const priceKey = selectionIndex === 0 ? "8" : "9";
      if (scalar(odd[selectionKey]) !== identity.providerSelectionId) continue;
      const prices = record(odd[priceKey]);
      const rawOdds = prices === null ? null : scalar(prices["2"]);
      if (rawOdds !== null && /^[+-]?\d+(?:\.\d+)?$/u.test(rawOdds) && Number(rawOdds) !== 0) matches.push(rawOdds);
    }
  }
  const unique = [...new Set(matches)];
  return unique.length === 1 ? { status: "FOUND", rawOdds: unique[0]! }
    : { status: unique.length > 1 ? "AMBIGUOUS" : "NOT_FOUND" };
}

export function apsportEventsFromProviderData(value: unknown): ApsportRawEvent[] {
  if (Array.isArray(value)) return value.flatMap(apsportEventsFromProviderData);
  const parent = record(value);
  if (parent === null || !Array.isArray(parent["15"])) return [];
  const leagueName = typeof parent["5"] === "string" ? parent["5"] : null;
  return parent["15"].flatMap((candidate) => {
    const item = record(candidate);
    if (item === null) return [];
    return [{ ...item, ...(item["53"] === undefined && leagueName !== null ? { "53": leagueName } : {}) }];
  });
}

export function buildApsportPageRequestExpression(
  template: ApsportRequestTemplate,
  request: ApsportCatalogPageRequest
): string {
  const target = new URL(request.url);
  if (target.origin !== template.origin || target.protocol !== "https:" || target.username !== "" ||
    target.password !== "" || !target.pathname.startsWith("/be-ui/pac/api/v3/")) {
    throw new Error("APSPORT_REQUEST_TARGET_INVALID");
  }
  const input = JSON.stringify({ url: target.toString(), headers: template.headers, body: request.body });
  return `(async () => {
    try {
      const input = ${input};
      const response = await fetch(input.url, { method: 'POST', headers: input.headers,
        body: JSON.stringify(input.body), credentials: 'include', cache: 'no-store' });
      const text = await response.text();
      let value = text.length === 0 ? null : JSON.parse(text);
      if (value && typeof value === 'object' && typeof value.data === 'string') {
        value = value.data.length === 0 ? null : JSON.parse(value.data);
      } else if (value && typeof value === 'object' && 'data' in value) {
        value = value.data;
      }
      const retryAfterSeconds = Number(response.headers.get('retry-after') || 0);
      return { status: response.status, data: value,
        retryAfterMs: Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
          ? Math.min(60000, retryAfterSeconds * 1000) : undefined };
    } catch { return { status: 0, data: null }; }
  })()`;
}

export function apsportPageResponseFromEvaluation(value: unknown): ApsportCatalogPageResponse {
  const outer = record(value);
  const evaluated = outer === null ? null : record(outer.result);
  const response = evaluated === null ? null : record(evaluated.value);
  const status = response === null ? Number.NaN : Number(response.status);
  const retryAfterMs = response === null ? Number.NaN : Number(response.retryAfterMs);
  return { status: Number.isSafeInteger(status) && status >= 0 && status <= 599 ? status : 0,
    data: response?.data ?? null,
    ...(Number.isFinite(retryAfterMs) && retryAfterMs > 0
      ? { retryAfterMs: Math.min(maximumRetryDelayMs, retryAfterMs) }
      : {}) };
}

function otherLeagueCursors(value: unknown): Array<{ readonly li: string; readonly in: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    const item = record(candidate);
    const leagueId = item === null ? null : scalar(item["4"]);
    const cursor = item === null ? null : scalar(item["17"]);
    return leagueId === null || cursor === null ? [] : [{ li: leagueId, in: cursor }];
  });
}

function rosterBody(mode: 2 | 3 | 4): Readonly<Record<string, unknown>> {
  return { mno: String(mode), si: "1", mg: "1", do: mode === 3 ? "0" : "1", so: "0",
    il: false, ls: false, st: false, lmt: false, co: false };
}

function otherLeaguesBody(mode: 2 | 3 | 4): Readonly<Record<string, unknown>> {
  return { mno: String(mode), si: "1", mg: "1", so: "0" };
}

function endpoint(template: ApsportRequestTemplate, suffix: string): string {
  return `${template.origin}/be-ui/pac/api/v3/${suffix}`;
}

async function detailResponse(options: Pick<CollectApsportEventDetailOptions,
  "template" | "request" | "sleep" | "isCurrent">,
  rawEvent: ApsportRawEvent): Promise<ApsportCatalogPageResponse | null> {
  const id = eventId(rawEvent);
  if (id === null) return null;
  for (let attempt = 0; attempt < maxDetailAttempts; attempt += 1) {
    if (!options.isCurrent()) return null;
    const response = await options.request({ kind: "DETAIL", eventId: id,
      url: endpoint(options.template, `events/${encodeURIComponent(id)}`),
      body: { si: 1, li: rawEvent["1"], isExtra: false, opl: false, mg: 1 } });
    if (response.status !== 429) return response;
    if (attempt + 1 >= maxDetailAttempts) return null;
    const requestedDelay = Number.isFinite(response.retryAfterMs) && (response.retryAfterMs ?? 0) > 0
      ? response.retryAfterMs!
      : 15_000 * (attempt + 1);
    await options.sleep(Math.min(maximumRetryDelayMs, requestedDelay));
  }
  return null;
}

export async function collectApsportEventDetail(
  options: CollectApsportEventDetailOptions
): Promise<ApsportRawEvent | null> {
  const id = eventId({ "2": options.eventId });
  if (id === null || !options.isCurrent()) return null;
  const response = await detailResponse(options, { "2": id });
  if (response?.status !== 200 || !options.isCurrent()) return null;
  return apsportEventsFromProviderData(response.data).find((item) => eventId(item) === id) ?? null;
}

export async function collectApsportCatalog(options: CollectApsportCatalogOptions): Promise<void> {
  if (!/^[a-z0-9._:-]{1,128}$/iu.test(options.generation) || !options.isCurrent()) return;
  const indexed = new Map<string, ApsportRawEvent>();
  for (const mode of modes) {
    if (!options.isCurrent()) return;
    const body = rosterBody(mode);
    const top = await options.request({ kind: "EVENTS", mode,
      url: endpoint(options.template, "events"), body });
    for (const item of apsportEventsFromProviderData(top.data)) {
      const id = eventId(item);
      if (id !== null) indexed.set(id, item);
    }
    const other = await options.request({ kind: "OTHER_LEAGUES", mode,
      url: endpoint(options.template, "other-leagues"), body: otherLeaguesBody(mode) });
    const lis = otherLeagueCursors(other.data);
    if (lis.length > 0) {
      const lazy = await options.request({ kind: "LEAGUE_TOPS", mode,
        url: endpoint(options.template, "leagues/tops"),
        body: { lis, mno: String(mode), mg: "1", si: 1, do: mode === 3 ? "0" : "1" } });
      for (const item of apsportEventsFromProviderData(lazy.data)) {
        const id = eventId(item);
        if (id !== null) indexed.set(id, item);
      }
    }
  }
  if (!options.isCurrent()) return;
  const retained = [...indexed.values()].filter((item) =>
    eligibleApsportFootballEvent(item, options.nowMs, options.prematchWindowHours));
  await options.onRoster({ schemaVersion: 1, generation: options.generation,
    phase: "ROSTER", complete: true, prematchWindowHours: options.prematchWindowHours, records: retained });
  if (!options.isCurrent()) return;

  const detailBatchSize = options.detailBatchSize ?? 10;
  if (!Number.isSafeInteger(detailBatchSize) || detailBatchSize < 1 || detailBatchSize > 50) {
    throw new Error("APSPORT_DETAIL_BATCH_SIZE_INVALID");
  }
  let batch: ApsportRawEvent[] = [];
  const detailDelayMs = options.detailDelayMs ?? 0;
  if (!Number.isSafeInteger(detailDelayMs) || detailDelayMs < 0 || detailDelayMs > 60_000) {
    throw new Error("APSPORT_DETAIL_DELAY_INVALID");
  }
  for (let index = 0; index < retained.length; index += 1) {
    if (!options.isCurrent()) return;
    const response = await detailResponse(options, retained[index]!);
    if (!options.isCurrent()) return;
    if (response?.status === 200) {
      const id = eventId(retained[index]!);
      const detailed = apsportEventsFromProviderData(response.data).find((item) => eventId(item) === id);
      if (detailed !== undefined && eligibleApsportFootballEvent(
        detailed, options.nowMs, options.prematchWindowHours)) batch.push(detailed);
    }
    const isLast = index + 1 === retained.length;
    if (batch.length >= detailBatchSize || isLast) {
      await options.onDetail({ schemaVersion: 1, generation: options.generation,
        phase: "DETAIL", complete: isLast, prematchWindowHours: options.prematchWindowHours, records: batch });
      batch = [];
    }
    if (!isLast && detailDelayMs > 0 && options.isCurrent()) await options.sleep(detailDelayMs);
  }
  if (retained.length === 0 && options.isCurrent()) {
    await options.onDetail({ schemaVersion: 1, generation: options.generation,
      phase: "DETAIL", complete: true, prematchWindowHours: options.prematchWindowHours, records: [] });
  }
}
