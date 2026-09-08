/** Exact public request observed on the SBOBET More control, 2026-09-08. */
export interface SbobetMoreRequest {
  readonly url: string;
  readonly eventId: string;
  readonly leagueId: string;
}

export interface SbobetMoreBatch {
  readonly kind: "SBOBET_EVENT_MORE";
  readonly generation: string;
  readonly eventId: string;
  readonly leagueId: string;
  readonly requestStartSequence: number;
  readonly observedAtMs: number;
  readonly marketContainerComplete: false;
  readonly groups: Readonly<Record<string, readonly string[]>>;
}

export function sbobetMoreRequestFromObserved(urlValue: unknown, method: unknown): SbobetMoreRequest | null {
  if (method !== "GET" || typeof urlValue !== "string" || urlValue.length > 4096) return null;
  let url: URL;
  try { url = new URL(urlValue); } catch { return null; }
  if (url.origin !== "https://be.sb21.net" || url.username || url.password || url.hash ||
    url.pathname !== "/api/v2/getEventBetMore") return null;
  const names = ["eventId", "leagueId", "oddsStyle", "sportId", "sportType"];
  if ([...url.searchParams.keys()].some(key => !names.includes(key)) ||
    names.some(key => url.searchParams.getAll(key).length !== 1)) return null;
  const eventId = url.searchParams.get("eventId")!;
  const leagueId = url.searchParams.get("leagueId")!;
  if (!/^[1-9]\d{0,19}$/u.test(eventId) || !/^[1-9]\d{0,19}$/u.test(leagueId) ||
    url.searchParams.get("oddsStyle") !== "ma" || url.searchParams.get("sportId") !== "1" ||
    url.searchParams.get("sportType") !== "1_1") return null;
  return { url: urlValue, eventId, leagueId };
}

/** Raw complementary inventory only. Empty/missing groups are never deletion evidence. */
export function sbobetMoreBatchFromResponse(request: SbobetMoreRequest, body: string,
  receipt: { readonly generation: string; readonly requestStartSequence: number;
    readonly observedAtMs: number }): SbobetMoreBatch | null {
  const bound = sbobetMoreRequestFromObserved(request.url, "GET");
  if (body.length > 4_000_000 || bound?.eventId !== request.eventId || bound.leagueId !== request.leagueId) return null;
  let groups: unknown;
  try { groups = JSON.parse(body); } catch { return null; }
  if (groups === null || typeof groups !== "object" || Array.isArray(groups)) return null;
  const entries = Object.entries(groups);
  if (entries.length > 256) return null;
  let rowCount = 0;
  let priced = false;
  for (const [key, rows] of entries) {
    if (!/^\d{1,4}$/u.test(key) || !Array.isArray(rows) || (rowCount += rows.length) > 20_000) return null;
    for (const row of rows) {
      if (typeof row !== "string" || row.length > 1500 || /https?:\/\//iu.test(row)) return null;
      if (key === "0") {
        if (!/^\d+(?:,\d+)*$/u.test(row)) return null;
        continue;
      }
      const selections = row.trim().split(/\s+/u).filter(token => token.includes("*"));
      if (selections.length === 0 || selections.some(token => {
        const match = /^(-?\d+(?:\.\d+)?)\*(\d+[had])$/u.exec(token);
        return match === null || !match[2]!.startsWith(request.eventId);
      })) return null;
      priced = true;
    }
  }
  if (!priced) return null;
  return { kind: "SBOBET_EVENT_MORE", ...receipt, eventId: request.eventId, leagueId: request.leagueId,
    marketContainerComplete: false, groups: groups as Record<string, readonly string[]> };
}

/** The caller verifies the document and owner before evaluating this bounded page request. */
export function buildSbobetMoreFetchExpression(request: SbobetMoreRequest, executionOrigin: string): string | null {
  const bound = sbobetMoreRequestFromObserved(request.url, "GET");
  if (bound === null || bound.eventId !== request.eventId || bound.leagueId !== request.leagueId ||
    !/^https:\/\/[a-z0-9.-]+(?::\d+)?$/iu.test(executionOrigin)) return null;
  return `(async () => {
    const input = ${JSON.stringify({ url: bound.url, executionOrigin })};
    if (location.origin !== input.executionOrigin) return { status: 0 };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7500);
    try {
      const response = await fetch(input.url, { method: 'GET', credentials: 'omit',
        cache: 'no-store', redirect: 'error', signal: controller.signal });
      if (response.status !== 200) {
        const retry = response.headers?.get('retry-after');
        return { status: response.status, ...(typeof retry === 'string' && /^\\d+$/u.test(retry)
          ? { retryAfterMs: Math.min(Number(retry) * 1000, 300000) } : {}) };
      }
      if (Number(response.headers?.get('content-length')) > 4000000) return { status: 0 };
      const body = await response.text();
      return controller.signal.aborted || body.length > 4000000 ? { status: 0 } : { status: 200, body };
    } catch { return { status: 0 }; }
    finally { clearTimeout(timeout); }
  })()`;
}
