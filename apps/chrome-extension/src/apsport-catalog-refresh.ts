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
  readonly verifiedEmpty?: true;
  readonly trigger?: "SWEEP" | "EVENT_CHANGE";
  readonly prematchWindowHours: number;
  readonly records: readonly ApsportRawEvent[];
}

export interface CollectApsportCatalogOptions {
  /** A scheduled roster returns to the shared lane after one refused request. */
  readonly maxAttempts?: number;
  readonly generation: string;
  readonly nowMs: number;
  readonly prematchWindowHours: number;
  readonly template: ApsportRequestTemplate;
  readonly request: (request: ApsportCatalogPageRequest) => Promise<ApsportCatalogPageResponse>;
  readonly sleep: (delayMs: number) => Promise<void>;
  readonly isCurrent: () => boolean;
  /** Stops new legacy work without invalidating an actual in-flight response. */
  readonly shouldContinueDetails?: () => boolean;
  readonly onRoster: (batch: ApsportCatalogBatch) => Promise<void>;
  readonly onDetail: (batch: ApsportCatalogBatch) => Promise<void>;
  readonly onDetailState?: (state: ApsportDetailStateUpdate) => void;
  readonly detailBatchSize?: number;
  readonly detailDelayMs?: number;
}

export type ApsportDetailStateUpdate = {
  readonly eventId: string;
  readonly state: "QUEUED" | "IN_FLIGHT" | "FAILURE" | "INELIGIBLE" | "CANCELLED";
} | {
  readonly eventId: string;
  readonly state: "SUCCESS";
  readonly hasMarkets: boolean;
};

export interface CollectApsportEventDetailOptions {
  /** Scheduled jobs return the physical slot to their shared queue after one attempt. */
  readonly maxAttempts?: number;
  readonly eventId: string;
  readonly leagueId?: string;
  readonly template: ApsportRequestTemplate;
  readonly request: (request: ApsportCatalogPageRequest) => Promise<ApsportCatalogPageResponse>;
  readonly sleep: (delayMs: number) => Promise<void>;
  readonly isCurrent: () => boolean;
}

const modes = [2, 4, 3] as const;
const maxRosterAttempts = 3;
const maxDetailAttempts = 5;
const maximumRetryDelayMs = 60_000;
const marketSemanticsByGroup: Readonly<Record<string, { readonly marketType: string;
  readonly scope: string; readonly selections: readonly [string, string]; readonly linePolicy: "LINE" | "NONE" }>> = {
  "3": { marketType: "FT_TOTAL", scope: "FULL_TIME", selections: ["OVER", "UNDER"], linePolicy: "LINE" },
  "4": { marketType: "FH_TOTAL", scope: "FIRST_HALF", selections: ["OVER", "UNDER"], linePolicy: "LINE" },
  "5": { marketType: "FT_AH", scope: "FULL_TIME", selections: ["HOME", "AWAY"], linePolicy: "LINE" },
  "6": { marketType: "FH_AH", scope: "FIRST_HALF", selections: ["HOME", "AWAY"], linePolicy: "LINE" },
  "8": { marketType: "FT_ODD_EVEN", scope: "FULL_TIME", selections: ["ODD", "EVEN"], linePolicy: "NONE" },
  "9": { marketType: "FH_ODD_EVEN", scope: "FIRST_HALF", selections: ["ODD", "EVEN"], linePolicy: "NONE" },
  "19": { marketType: "CORNER_FT_AH", scope: "FULL_TIME", selections: ["HOME", "AWAY"], linePolicy: "LINE" },
  "20": { marketType: "CORNER_FH_AH", scope: "FIRST_HALF", selections: ["HOME", "AWAY"], linePolicy: "LINE" },
  "21": { marketType: "CORNER_FT_TOTAL", scope: "FULL_TIME", selections: ["OVER", "UNDER"], linePolicy: "LINE" },
  "22": { marketType: "CORNER_FH_TOTAL", scope: "FIRST_HALF", selections: ["OVER", "UNDER"], linePolicy: "LINE" },
  "31": { marketType: "CARD_FT_TOTAL", scope: "FULL_TIME", selections: ["OVER", "UNDER"], linePolicy: "LINE" },
  "32": { marketType: "CARD_FH_TOTAL", scope: "FIRST_HALF", selections: ["OVER", "UNDER"], linePolicy: "LINE" },
  "33": { marketType: "CARD_FT_AH", scope: "FULL_TIME", selections: ["HOME", "AWAY"], linePolicy: "LINE" },
  "34": { marketType: "CARD_FH_AH", scope: "FIRST_HALF", selections: ["HOME", "AWAY"], linePolicy: "LINE" },
  "36": { marketType: "FT_BTTS", scope: "FULL_TIME", selections: ["YES", "NO"], linePolicy: "NONE" },
  "37": { marketType: "FH_BTTS", scope: "FIRST_HALF", selections: ["YES", "NO"], linePolicy: "NONE" },
  "56": { marketType: "CORNER_FT_ODD_EVEN", scope: "FULL_TIME", selections: ["ODD", "EVEN"], linePolicy: "NONE" },
  "57": { marketType: "CORNER_FH_ODD_EVEN", scope: "FIRST_HALF", selections: ["ODD", "EVEN"], linePolicy: "NONE" },
  "60": { marketType: "SENDING_OFF", scope: "FULL_TIME", selections: ["YES", "NO"], linePolicy: "NONE" },
  "61": { marketType: "HOME_CORNER_FT_TOTAL", scope: "FULL_TIME", selections: ["OVER", "UNDER"], linePolicy: "LINE" },
  "62": { marketType: "HOME_CORNER_FH_TOTAL", scope: "FIRST_HALF", selections: ["OVER", "UNDER"], linePolicy: "LINE" },
  "63": { marketType: "AWAY_CORNER_FT_TOTAL", scope: "FULL_TIME", selections: ["OVER", "UNDER"], linePolicy: "LINE" },
  "64": { marketType: "AWAY_CORNER_FH_TOTAL", scope: "FIRST_HALF", selections: ["OVER", "UNDER"], linePolicy: "LINE" },
  "69": { marketType: "HOME_FT_SCORE_BOTH_HALVES", scope: "FULL_TIME", selections: ["YES", "NO"], linePolicy: "NONE" },
  "70": { marketType: "AWAY_FT_SCORE_BOTH_HALVES", scope: "FULL_TIME", selections: ["YES", "NO"], linePolicy: "NONE" },
  "71": { marketType: "HOME_FT_WIN_BOTH_HALVES", scope: "FULL_TIME", selections: ["YES", "NO"], linePolicy: "NONE" },
  "72": { marketType: "AWAY_FT_WIN_BOTH_HALVES", scope: "FULL_TIME", selections: ["YES", "NO"], linePolicy: "NONE" },
  "73": { marketType: "HOME_FT_WIN_EITHER_HALF", scope: "FULL_TIME", selections: ["YES", "NO"], linePolicy: "NONE" },
  "74": { marketType: "AWAY_FT_WIN_EITHER_HALF", scope: "FULL_TIME", selections: ["YES", "NO"], linePolicy: "NONE" },
  "76": { marketType: "HOME_FT_ODD_EVEN", scope: "FULL_TIME", selections: ["ODD", "EVEN"], linePolicy: "NONE" },
  "77": { marketType: "AWAY_FT_ODD_EVEN", scope: "FULL_TIME", selections: ["ODD", "EVEN"], linePolicy: "NONE" },
  "78": { marketType: "HOME_FT_WIN_TO_NIL", scope: "FULL_TIME", selections: ["YES", "NO"], linePolicy: "NONE" },
  "79": { marketType: "AWAY_FT_WIN_TO_NIL", scope: "FULL_TIME", selections: ["YES", "NO"], linePolicy: "NONE" },
  "80": { marketType: "SH_TOTAL", scope: "SECOND_HALF", selections: ["OVER", "UNDER"], linePolicy: "LINE" },
  "83": { marketType: "HOME_FT_CLEAN_SHEET", scope: "FULL_TIME", selections: ["YES", "NO"], linePolicy: "NONE" },
  "84": { marketType: "AWAY_FT_CLEAN_SHEET", scope: "FULL_TIME", selections: ["YES", "NO"], linePolicy: "NONE" },
  "85": { marketType: "SH_AH", scope: "SECOND_HALF", selections: ["HOME", "AWAY"], linePolicy: "LINE" },
  "86": { marketType: "SH_ODD_EVEN", scope: "SECOND_HALF", selections: ["ODD", "EVEN"], linePolicy: "NONE" },
  "99": { marketType: "FT_BOTH_HALVES_OVER_TOTAL", scope: "FULL_TIME", selections: ["YES", "NO"], linePolicy: "LINE" },
  "100": { marketType: "FT_BOTH_HALVES_UNDER_TOTAL", scope: "FULL_TIME", selections: ["YES", "NO"], linePolicy: "LINE" },
  "101": { marketType: "HOME_FT_TOTAL", scope: "FULL_TIME", selections: ["OVER", "UNDER"], linePolicy: "LINE" },
  "102": { marketType: "AWAY_FT_TOTAL", scope: "FULL_TIME", selections: ["OVER", "UNDER"], linePolicy: "LINE" },
  "139": { marketType: "YELLOW_CARD_FT_TOTAL", scope: "FULL_TIME", selections: ["OVER", "UNDER"], linePolicy: "LINE" },
  "148": { marketType: "HOME_FT_TO_WIN", scope: "FULL_TIME", selections: ["YES", "NO"], linePolicy: "NONE" },
  "149": { marketType: "AWAY_FT_TO_WIN", scope: "FULL_TIME", selections: ["YES", "NO"], linePolicy: "NONE" },
  "154": { marketType: "FT_ANY_TEAM_TO_WIN", scope: "FULL_TIME", selections: ["YES", "NO"], linePolicy: "NONE" }
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

export function validateApsportDetail(value: ApsportRawEvent): {
  readonly eventId: string;
  readonly hasMarkets: boolean;
} | null {
  const id = eventId(value);
  const home = typeof value["5"] === "string" ? value["5"].trim() : "";
  const away = typeof value["22"] === "string" ? value["22"].trim() : "";
  const league = typeof value["53"] === "string" ? value["53"].trim() : "";
  if (id === null || home === "" || home.length > 512 || away === "" || away.length > 512 ||
    home.toLocaleLowerCase("en") === away.toLocaleLowerCase("en") || league === "" || league.length > 512 ||
    value["6"] !== true && (typeof value["11"] !== "string" || !Number.isFinite(Date.parse(value["11"]))) ||
    !Array.isArray(value["50"])) return null;
  let present = false;
  for (const candidate of value["50"]) {
    const group = record(candidate);
    const groupId = group === null ? null : scalar(group["3"]);
    if (group === null || groupId === null || groupId.trim() === "" || groupId.length > 64 ||
      !Array.isArray(group["9"]) || !group["9"].every((odd) => record(odd) !== null)) return null;
    if (group["9"].length > 0) present = true;
  }
  return { eventId: id, hasMarkets: present };
}

function activeEventEvidence(value: ApsportRawEvent): boolean {
  if (value["10"] === "Active") return true;
  if (value["10"] !== undefined && value["10"] !== null && value["10"] !== "") return false;
  return Array.isArray(value["50"]) && value["50"].some((candidate) => {
    const group = record(candidate);
    return group !== null && group["10"] === "Active" &&
      Array.isArray(group["9"]) && group["9"].length > 0;
  });
}

function virtualFootballIdentity(value: ApsportRawEvent): boolean {
  const league = typeof value["53"] === "string" ? value["53"] : "";
  const teams = [value["5"], value["22"]].filter((team): team is string =>
    typeof team === "string" && team.trim() !== "");
  const label = league.normalize("NFKC").toLocaleLowerCase("en");
  if (/(?:\be[\s-]?soccer\b|\bvirtual\b|simulated reality|soccer marble|\bpes\b|ảo|điện tử)/u.test(label)) return true;
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
  return startAtMs >= nowMs;
}

export function apsportSelectionPriceFromEvent(value: ApsportRawEvent, identity: {
  readonly providerEventId: string; readonly providerMarketId: string;
  readonly providerSelectionId: string; readonly marketType: string; readonly scope: string;
  readonly selection: string; readonly line: string | null;
}): { readonly status: "FOUND"; readonly rawOdds: string } |
  { readonly status: "NOT_FOUND" | "AMBIGUOUS" } {
  if (eventId(value) !== identity.providerEventId || value["9"] === true || !activeEventEvidence(value) ||
    !Array.isArray(value["50"])) return { status: "NOT_FOUND" };
  const matches: string[] = [];
  for (const candidateGroup of value["50"]) {
    const group = record(candidateGroup);
    const semantics = group === null ? undefined : marketSemanticsByGroup[String(group["3"])];
    if (group === null || group["10"] !== "Active" || group["6"] === true || semantics === undefined ||
      semantics.marketType !== identity.marketType || semantics.scope !== identity.scope || !Array.isArray(group["9"])) continue;
    if ((semantics.linePolicy === "NONE" && identity.line !== null) ||
      (semantics.linePolicy === "LINE" && identity.line === null)) continue;
    const requestedLine = identity.line === null ? null : Number(identity.line);
    if (requestedLine !== null && !Number.isFinite(requestedLine)) continue;
    for (const candidateOdd of group["9"]) {
      const odd = record(candidateOdd);
      const line = odd === null ? Number.NaN : Number(scalar(odd["7"]));
      const nativeOfferId = odd === null ? null : scalar(odd["6"]);
      // Catalog IDs include the native group because AP can reuse an offer ID
      // across groups. Match the full identity without stripping that boundary.
      const marketMatches = nativeOfferId !== null && (identity.providerMarketId === nativeOfferId ||
        identity.providerMarketId === `tsport:${String(group["3"])}:${nativeOfferId}`);
      if (odd === null || odd["13"] === true || !marketMatches ||
        (requestedLine !== null && (!Number.isFinite(line) || Math.abs(line - requestedLine) > 1e-9))) continue;
      const selectionIndex = semantics.selections.indexOf(identity.selection);
      if (selectionIndex < 0) continue;
      const selectionKey = selectionIndex === 0 ? "0" : "2";
      const priceKey = selectionIndex === 0 ? "8" : "9";
      if (scalar(odd[selectionKey]) !== identity.providerSelectionId) continue;
      const prices = record(odd[priceKey]);
      const malay = prices === null ? null : scalar(prices["2"]);
      const decimal = prices === null ? null : scalar(prices["0"]);
      const rawOdds = malay !== null && /^[+-]?\d+(?:\.\d+)?$/u.test(malay) && Number(malay) !== 0
        ? malay
        : decimal !== null && /^\d+(?:\.\d+)?$/u.test(decimal) && Number(decimal) > 1 ? decimal : null;
      if (rawOdds !== null) matches.push(rawOdds);
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
      const controller = new AbortController();
      const requestTimer = setTimeout(() => controller.abort(), 8000);
      try {
        const response = await fetch(input.url, { method: 'POST', headers: input.headers,
          body: JSON.stringify(input.body), credentials: 'include', cache: 'no-store',
          signal: controller.signal });
        const header = response.headers.get('retry-after')?.trim() || '';
        const delay = /^[0-9]+(?:[.][0-9]+)?$/.test(header)
          ? Number(header) * 1000 : Date.parse(header) - Date.now();
        const retryAfterMs = Number.isFinite(delay) && delay > 0
          ? Math.min(Number.MAX_SAFE_INTEGER, delay) : undefined;
        let value = null;
        try {
          const text = await response.text();
          value = text.length === 0 ? null : JSON.parse(text);
          if (value && typeof value === 'object' && typeof value.data === 'string') {
            value = value.data.length === 0 ? null : JSON.parse(value.data);
          } else if (value && typeof value === 'object' && 'data' in value) {
            value = value.data;
          }
        } catch { /* A refusal body cannot erase its status or Retry-After. */ }
        return { status: response.status, data: value, retryAfterMs };
      } finally { clearTimeout(requestTimer); }
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
      ? { retryAfterMs: Math.min(Number.MAX_SAFE_INTEGER, retryAfterMs) }
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

function compareDetailPriority(left: ApsportRawEvent, right: ApsportRawEvent): number {
  const leftLive = left["6"] === true;
  const rightLive = right["6"] === true;
  if (leftLive !== rightLive) return leftLive ? -1 : 1;
  if (leftLive) return 0;
  const leftStartAtMs = Date.parse(String(left["11"]));
  const rightStartAtMs = Date.parse(String(right["11"]));
  return leftStartAtMs - rightStartAtMs;
}

async function detailResponse(options: Pick<CollectApsportEventDetailOptions,
  "template" | "request" | "sleep" | "isCurrent" | "maxAttempts">,
  rawEvent: ApsportRawEvent): Promise<ApsportCatalogPageResponse | null> {
  const id = eventId(rawEvent);
  if (id === null) return null;
  const attempts = options.maxAttempts ?? maxDetailAttempts;
  if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > maxDetailAttempts) return null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (!options.isCurrent()) return null;
    let response: ApsportCatalogPageResponse;
    try {
      response = await options.request({ kind: "DETAIL", eventId: id,
        url: endpoint(options.template, `events/${encodeURIComponent(id)}`),
        body: { si: 1, li: rawEvent["1"], isExtra: false, opl: false, mg: 1 } });
    } catch {
      response = { status: 0, data: null };
    }
    const transient = response.status === 0 || response.status === 408 || response.status === 429 ||
      response.status >= 500 && response.status <= 599;
    if (!transient) return response;
    if (attempt + 1 >= attempts || !options.isCurrent()) return null;
    const requestedDelay = (response.status === 429 || response.status === 503) && Number.isFinite(response.retryAfterMs) &&
      (response.retryAfterMs ?? 0) > 0
      ? response.retryAfterMs!
      : response.status === 429 ? 15_000 * (attempt + 1) : 1_000 * (attempt + 1);
    const providerDelay = (response.status === 429 || response.status === 503) &&
      Number.isFinite(response.retryAfterMs) && (response.retryAfterMs ?? 0) > 0;
    await options.sleep(providerDelay ? requestedDelay : Math.min(maximumRetryDelayMs, requestedDelay));
    if (!options.isCurrent()) return null;
  }
  return null;
}

async function rosterResponse(options: Pick<CollectApsportCatalogOptions,
  "request" | "sleep" | "isCurrent" | "maxAttempts">,
  input: Extract<ApsportCatalogPageRequest, { readonly kind: ApsportRosterRequestKind }>
): Promise<ApsportCatalogPageResponse | null> {
  const attempts = options.maxAttempts ?? maxRosterAttempts;
  if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > maxRosterAttempts) throw new Error("APSPORT_ROSTER_ATTEMPTS_INVALID");
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (!options.isCurrent()) return null;
    let response: ApsportCatalogPageResponse;
    try { response = await options.request(input); }
    catch { response = { status: 0, data: null }; }
    if (!options.isCurrent()) return null;
    if (response.status === 200) {
      assertRosterResponse(response);
      return response;
    }
    const transient = response.status === 0 || response.status === 408 || response.status === 429 ||
      response.status >= 500 && response.status <= 599;
    if (!transient || attempt + 1 >= attempts) assertRosterResponse(response);
    const requestedDelay = (response.status === 429 || response.status === 503) && Number.isFinite(response.retryAfterMs) &&
      (response.retryAfterMs ?? 0) > 0
      ? response.retryAfterMs!
      : response.status === 429 ? 15_000 * (attempt + 1) : 1_000 * (attempt + 1);
    const providerDelay = (response.status === 429 || response.status === 503) &&
      Number.isFinite(response.retryAfterMs) && (response.retryAfterMs ?? 0) > 0;
    await options.sleep(providerDelay ? requestedDelay : Math.min(maximumRetryDelayMs, requestedDelay));
    if (!options.isCurrent()) return null;
  }
  return null;
}

export async function collectApsportEventDetail(
  options: CollectApsportEventDetailOptions
): Promise<ApsportRawEvent | null> {
  const id = eventId({ "2": options.eventId });
  if (id === null || !options.isCurrent()) return null;
  const leagueId = scalar(options.leagueId);
  const response = await detailResponse(options, { "2": id,
    ...(leagueId === null ? {} : { "1": leagueId }) });
  if (response?.status !== 200 || !options.isCurrent()) return null;
  const detailed = apsportEventsFromProviderData(response.data).find((item) => eventId(item) === id);
  return detailed !== undefined && validateApsportDetail(detailed)?.eventId === id ? detailed : null;
}

export async function collectApsportCatalog(options: CollectApsportCatalogOptions): Promise<void> {
  if (!/^[a-z0-9._:-]{1,128}$/iu.test(options.generation) || !options.isCurrent()) return;
  const indexed = new Map<string, ApsportRawEvent>();
  for (const mode of modes) {
    if (!options.isCurrent()) return;
    const body = rosterBody(mode);
    const top = await rosterResponse(options, { kind: "EVENTS", mode,
      url: endpoint(options.template, "events"), body });
    if (top === null) return;
    for (const item of apsportEventsFromProviderData(top.data)) {
      const id = eventId(item);
      if (id !== null) indexed.set(id, item);
    }
    const other = await rosterResponse(options, { kind: "OTHER_LEAGUES", mode,
      url: endpoint(options.template, "other-leagues"), body: otherLeaguesBody(mode) });
    if (other === null) return;
    const lis = otherLeagueCursors(other.data);
    if (lis.length > 0) {
      const lazy = await rosterResponse(options, { kind: "LEAGUE_TOPS", mode,
        url: endpoint(options.template, "leagues/tops"),
        body: { lis, mno: String(mode), mg: "1", si: 1, do: mode === 3 ? "0" : "1" } });
      if (lazy === null) return;
      for (const item of apsportEventsFromProviderData(lazy.data)) {
        const id = eventId(item);
        if (id !== null) indexed.set(id, item);
      }
    }
  }
  if (!options.isCurrent()) return;
  const retained = [...indexed.values()].filter((item) =>
    eligibleApsportFootballEvent(item, options.nowMs, options.prematchWindowHours))
    .sort(compareDetailPriority);
  await options.onRoster({ schemaVersion: 1, generation: options.generation,
    phase: "ROSTER", complete: true, ...(retained.length === 0 ? { verifiedEmpty: true as const } : {}),
    prematchWindowHours: options.prematchWindowHours, records: retained });
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
  const continueDetails = () => options.shouldContinueDetails?.() !== false;
  if (!continueDetails()) return;
  const detailCandidates = retained.filter((item) => item["6"] !== true);
  for (const candidate of detailCandidates) {
    const id = eventId(candidate);
    if (id !== null) options.onDetailState?.({ eventId: id, state: "QUEUED" });
  }
  let allDetailsSucceeded = true;
  for (let index = 0; index < detailCandidates.length; index += 1) {
    if (!options.isCurrent()) return;
    if (!continueDetails()) {
      if (batch.length > 0) await options.onDetail({ schemaVersion: 1, generation: options.generation,
        phase: "DETAIL", complete: false, prematchWindowHours: options.prematchWindowHours, records: batch });
      return;
    }
    const candidateId = eventId(detailCandidates[index]!);
    if (candidateId !== null) options.onDetailState?.({ eventId: candidateId, state: "IN_FLIGHT" });
    const response = await detailResponse({ ...options, isCurrent: () => options.isCurrent() && continueDetails() }, detailCandidates[index]!);
    if (!options.isCurrent()) return;
    let detailResolved = false;
    if (response?.status === 200) {
      const id = eventId(detailCandidates[index]!);
      const detailed = apsportEventsFromProviderData(response.data).find((item) => eventId(item) === id);
      const validation = detailed === undefined ? null : validateApsportDetail(detailed);
      if (detailed !== undefined && validation?.eventId === id) {
        if (detailed["6"] !== true && eligibleApsportFootballEvent(
          detailed, options.nowMs, options.prematchWindowHours)) {
          batch.push(detailed);
          detailResolved = true;
          options.onDetailState?.({ eventId: id!, state: "SUCCESS", hasMarkets: validation.hasMarkets });
        } else {
          detailResolved = true;
          options.onDetailState?.({ eventId: id!, state: "INELIGIBLE" });
        }
      }
    }
    if (!detailResolved) {
      allDetailsSucceeded = false;
      if (candidateId !== null) options.onDetailState?.({ eventId: candidateId, state: !continueDetails() && response === null ? "CANCELLED" : "FAILURE" });
    }
    const isLast = index + 1 === detailCandidates.length;
    if (batch.length >= detailBatchSize || isLast) {
      await options.onDetail({ schemaVersion: 1, generation: options.generation,
        phase: "DETAIL", complete: isLast && allDetailsSucceeded,
        prematchWindowHours: options.prematchWindowHours, records: batch });
      batch = [];
    }
    if (!isLast && detailDelayMs > 0 && options.isCurrent() && continueDetails()) await options.sleep(detailDelayMs);
  }
  if (detailCandidates.length === 0 && options.isCurrent()) {
    await options.onDetail({ schemaVersion: 1, generation: options.generation,
      phase: "DETAIL", complete: true, prematchWindowHours: options.prematchWindowHours, records: [] });
  }
}

function assertRosterResponse(response: ApsportCatalogPageResponse): void {
  // Status and top-level shape are safe protocol diagnostics. Keeping them in
  // the bounded work-health code distinguishes an expired page context (0),
  // provider throttling/auth (4xx), upstream failure (5xx), and schema drift
  // without retaining response bodies or credentials.
  if (response.status !== 200) throw new Error(`APSPORT_ROSTER_HTTP_${String(response.status)}`);
  if (!Array.isArray(response.data)) throw new Error("APSPORT_ROSTER_DATA_SHAPE");
}
