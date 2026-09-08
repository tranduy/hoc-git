const QUERY_NAMES = ["eventId", "timeRange", "sportId", "leagueId", "marketType", "language", "AUTH_KEY", "OTHER"] as const;
const WRAPPER_NAMES = ["body", "data", "result", "leagues", "events"] as const;
const LABEL_NAMES = ["FOOTBALL", "LIVE", "TODAY", "EARLY", "PREMATCH", "ALL_MARKETS", "MORE_MARKETS",
  "CORNERS", "CARDS", "FIRST_HALF", "SECOND_HALF"] as const;
const CLASS_NAMES = ["sport-type-group-item", "period-item", "more-bet", "more-markets", "match-more",
  "event-more", "wrapper-match-component", "league-component"] as const;
const ATTRIBUTE_NAMES = ["data-event-id", "data-fixture-id", "data-match-id", "data-market-id",
  "data-selection-id", "data-sport-id", "aria-expanded", "role"] as const;
const SELECTOR_SHAPES = ["#wrapper-match-component-{numeric}", "#event-{numeric}", "#match-{numeric}",
  ...ATTRIBUTE_NAMES.map((name) => `[${name}]`)];

interface NativeEventShape {
  readonly eventId: string | null;
  readonly container: "ALL_ARRAY_CONTAINER" | "MALFORMED" | "MISSING";
  readonly nativeGroupCount: number;
  readonly groups: readonly { readonly groupId: string | null; readonly rowCount: number | null }[];
}
export interface SbobetDiscoverySummary {
  readonly kind: "SBOBET_PASSIVE_DISCOVERY";
  readonly method: "GET" | "POST" | "OTHER";
  readonly queryKeys: readonly (typeof QUERY_NAMES)[number][];
  readonly hasNumericEventId: boolean;
  readonly timeRange: "live" | "today" | "early" | null;
  readonly httpStatus: number | null;
  readonly membership: "UNPROVEN";
  readonly response: {
    readonly status: "NOT_OBSERVED" | "TOO_LARGE" | "INVALID_JSON" | "INSPECTED";
    readonly wrapperKeys: readonly string[];
    readonly sampledEventCount: number;
    readonly events: readonly NativeEventShape[];
    readonly truncated: boolean;
  };
}

/** Consumes already-observed traffic; never issues a request or infers detail completeness. */
export function summarizeSbobetDiscovery(input: { readonly url: string; readonly method: string;
  readonly httpStatus?: number; readonly body?: string }): SbobetDiscoverySummary | null {
  if (input.url.length > 24_000) return null;
  let url: URL;
  try { url = new URL(input.url); } catch { return null; }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" ||
    url.pathname !== "/api/v2/getEvent" || !(host === "sb21.net" || host.endsWith(".sb21.net") ||
      host === "zenandfe.com" || host === "prod20091.fxf774.com")) return null;
  const queryKeys = new Set<(typeof QUERY_NAMES)[number]>();
  let inspectedKeys = 0;
  for (const key of url.searchParams.keys()) {
    if (++inspectedKeys > 128) { queryKeys.add("OTHER"); break; }
    const known = QUERY_NAMES.slice(0, 6).find((name) => name.toLowerCase() === key.toLowerCase());
    queryKeys.add(known ?? (/^(?:token|access_?token|sbo_?token|auth|authorization|session|session_?id|signature|secret|key|credential|password)$/iu.test(key)
      ? "AUTH_KEY" : "OTHER"));
  }
  const eventIds = url.searchParams.getAll("eventId");
  const ranges = url.searchParams.getAll("timeRange");
  const range = ranges.length === 1 ? ranges[0]!.toLowerCase() : "";
  return { kind: "SBOBET_PASSIVE_DISCOVERY", method: input.method === "GET" || input.method === "POST"
    ? input.method : "OTHER", queryKeys: [...queryKeys],
  hasNumericEventId: eventIds.length === 1 && /^\d{1,30}$/u.test(eventIds[0]!),
  timeRange: range === "live" || range === "today" || range === "early" ? range : null,
  httpStatus: typeof input.httpStatus === "number" && Number.isInteger(input.httpStatus) &&
    input.httpStatus >= 100 && input.httpStatus <= 599 ? input.httpStatus : null,
  membership: "UNPROVEN", response: summarizeBody(input.body) };
}

function summarizeBody(body?: string): SbobetDiscoverySummary["response"] {
  const empty = { wrapperKeys: [], sampledEventCount: 0, events: [], truncated: false } as const;
  if (body === undefined) return { ...empty, status: "NOT_OBSERVED" };
  if (body.length > 1_000_000) return { ...empty, status: "TOO_LARGE", truncated: true };
  const deadline = performance.now() + 25;
  let parsed: unknown;
  try { parsed = JSON.parse(body) as unknown; } catch { return { ...empty, status: "INVALID_JSON" }; }
  const pending = [{ value: parsed, depth: 0 }];
  const events: NativeEventShape[] = [];
  const wrapperKeys = new Set<string>();
  let visited = 0;
  let sampledGroups = 0;
  let decodedChars = body.length;
  let truncated = false;
  while (pending.length > 0) {
    if (visited >= 512 || events.length >= 16 || sampledGroups >= 64 || performance.now() > deadline) {
      truncated = true; break;
    }
    const current = pending.pop()!;
    visited += 1;
    if (current.depth > 8) { truncated = true; continue; }
    if (typeof current.value === "string") {
      if (!/^[\[{]/u.test(current.value.trim())) continue;
      if (decodedChars + current.value.length > 2_000_000) { truncated = true; continue; }
      decodedChars += current.value.length;
      try { pending.push({ value: JSON.parse(current.value) as unknown, depth: current.depth + 1 }); }
      catch { /* Opaque non-JSON text is never included in diagnostics. */ }
      continue;
    }
    if (record(current.value) && Object.hasOwn(current.value, "8")) {
      const id = current.value["8"];
      const native = current.value["7"];
      const entries = record(native) ? Object.entries(native) : [];
      const groups: NativeEventShape["groups"][number][] = [];
      for (const [groupId, rows] of entries) {
        if (sampledGroups >= 64) { truncated = true; break; }
        sampledGroups += 1;
        groups.push({ groupId: /^\d{1,6}$/u.test(groupId) ? groupId : null,
          rowCount: Array.isArray(rows) ? Math.min(1_000_000, rows.length) : null });
      }
      events.push({ eventId: (typeof id === "string" || typeof id === "number") &&
        /^\d{1,30}$/u.test(String(id)) ? String(id) : null,
      container: !Object.hasOwn(current.value, "7") ? "MISSING"
        : record(native) && entries.every(([, rows]) => Array.isArray(rows)) ? "ALL_ARRAY_CONTAINER" : "MALFORMED",
      nativeGroupCount: entries.length, groups });
      continue;
    }
    const children = Array.isArray(current.value) ? current.value
      : record(current.value) ? Object.entries(current.value).flatMap(([name, value]) => {
        if ((WRAPPER_NAMES as readonly string[]).includes(name)) wrapperKeys.add(name);
        return [value];
      }) : [];
    const remaining = Math.max(0, 512 - visited - pending.length);
    if (children.length > remaining) truncated = true;
    for (let index = Math.min(children.length, remaining) - 1; index >= 0; index -= 1) {
      pending.push({ value: children[index], depth: current.depth + 1 });
    }
  }
  return { status: "INSPECTED", wrapperKeys: [...wrapperKeys], sampledEventCount: events.length, events, truncated };
}

/** Fits the observer's existing ASCII catalogShape diagnostic without including any input text. */
export function formatSbobetDiscovery(summary: SbobetDiscoverySummary): string {
  const queries = summary.queryKeys.slice(0, 8).filter((key) => (QUERY_NAMES as readonly string[]).includes(key)).join(",");
  const wrappers = summary.response.wrapperKeys.slice(0, 8).filter((key) => (WRAPPER_NAMES as readonly string[]).includes(key)).join(",");
  const groups = summary.response.events.slice(0, 16).flatMap((event) => event.groups.slice(0, 16)).slice(0, 16).map((group) =>
    `${typeof group.groupId === "string" && /^\d{1,6}$/u.test(group.groupId) ? group.groupId : "OTHER"}:` +
    `${group.rowCount === null ? "BAD" : boundedCount(group.rowCount, 1_000_000)}`).join(",");
  const method = summary.method === "GET" || summary.method === "POST" ? summary.method : "OTHER";
  const range = ["live", "today", "early"].includes(summary.timeRange ?? "") ? summary.timeRange : "NONE";
  const status = ["NOT_OBSERVED", "TOO_LARGE", "INVALID_JSON", "INSPECTED"].includes(summary.response.status)
    ? summary.response.status : "INVALID";
  return (`sbo[member=UNPROVEN method=${method} detail=${summary.hasNumericEventId === true ? 1 : 0}` +
    ` range=${range} http=${boundedCount(summary.httpStatus, 599)} shape=${status} trunc=${summary.response.truncated ? 1 : 0}` +
    ` query=${queries} wrap=${wrappers} native=${groups}]`).slice(0, 440);
}

export interface SbobetDomDiscoverySummary {
  readonly kind: "SBOBET_PASSIVE_DOM_DISCOVERY";
  readonly status: "INSPECTED" | "UNAVAILABLE";
  readonly inspectedNodeCount: number;
  readonly totalCandidateCount: number;
  readonly moreControlCount: number;
  readonly truncated: boolean;
  readonly labels: readonly { readonly name: string; readonly count: number }[];
  readonly classes: readonly string[];
  readonly attributes: readonly { readonly name: string; readonly count: number }[];
  readonly selectorShapes: readonly string[];
}

export const SBOBET_PASSIVE_DOM_DISCOVERY_EXPRESSION = `(() => {
  const kind = 'SBOBET_PASSIVE_DOM_DISCOVERY';
  const empty = { kind, status: 'UNAVAILABLE', inspectedNodeCount: 0, totalCandidateCount: 0,
    moreControlCount: 0, truncated: false, labels: [], classes: [], attributes: [], selectorShapes: [] };
  try {
    const deadline = performance.now() + 25;
    const nodes = document.querySelectorAll('h1,h2,h3,h4,[role="heading"],button,[role="button"],.more-bet,.more-markets,.match-more,.event-more,[id^="wrapper-match-component-"],[id^="event-"],[id^="match-"],[data-event-id],[data-fixture-id],[data-match-id],[data-sport-id]');
    const classAllowlist = ${JSON.stringify(CLASS_NAMES)};
    const attributeAllowlist = ${JSON.stringify(ATTRIBUTE_NAMES)};
    const labels = new Map(), attributes = new Map(), classes = new Set(), selectorShapes = new Set();
    let inspectedNodeCount = 0, moreControlCount = 0;
    const normalize = (value) => String(value || '').slice(0, 120).normalize('NFD')
      .replace(/[\\u0300-\\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
      .toLowerCase().replace(/\\s+/g, ' ').trim();
    const patterns = [
      ['FOOTBALL', /^(?:football|bong da)(?:\\s*\\d+)?$/],
      ['LIVE', /^(?:live|truc tiep)(?:\\s*\\d+)?$/],
      ['TODAY', /^(?:today|hom nay)(?:\\s*\\d+)?$/],
      ['EARLY', /^(?:early|som)(?:\\s*\\d+)?$/],
      ['PREMATCH', /^(?:prematch|pre-match|truoc tran)$/],
      ['ALL_MARKETS', /^(?:all markets|tat ca keo)$/],
      ['MORE_MARKETS', /^(?:more|more markets|xem them|them)(?:\\s*\\(?\\+?\\d+\\)?)?$/],
      ['CORNERS', /^(?:corners|corner|goc|phat goc)$/],
      ['CARDS', /^(?:cards|card|the|the phat)$/],
      ['FIRST_HALF', /^(?:first half|1st half|hiep 1)$/],
      ['SECOND_HALF', /^(?:second half|2nd half|hiep 2)$/]
    ];
    for (let index = 0; index < nodes.length && inspectedNodeCount < 400; index += 1) {
      if (performance.now() > deadline) break;
      const node = nodes[index];
      inspectedNodeCount += 1;
      if (node.closest('.odd-item,.odd-row,[data-selection-id],.bet-slip,.betslip')) continue;
      let moreClass = false;
      for (let at = 0; at < Math.min(node.classList.length, 32); at += 1) {
        const name = node.classList.item(at);
        if (classAllowlist.includes(name)) classes.add(name);
        if (['more-bet','more-markets','match-more','event-more'].includes(name)) moreClass = true;
      }
      for (const name of node.getAttributeNames().slice(0, 32)) {
        if (!attributeAllowlist.includes(name)) continue;
        attributes.set(name, (attributes.get(name) || 0) + 1);
        selectorShapes.add('[' + name + ']');
      }
      const id = String(node.id || '').slice(0, 100);
      for (const prefix of ['wrapper-match-component-', 'event-', 'match-']) {
        if (id.startsWith(prefix) && /^\\d{1,30}$/.test(id.slice(prefix.length)))
          selectorShapes.add('#' + prefix + '{numeric}');
      }
      const text = normalize(node.textContent);
      const label = patterns.find((entry) => entry[1].test(text))?.[0] ||
        (moreClass && /^\\+?\\d+$/.test(text) ? 'MORE_MARKETS' : null);
      if (label) labels.set(label, (labels.get(label) || 0) + 1);
      if (label === 'MORE_MARKETS') moreControlCount += 1;
    }
    return { kind, status: 'INSPECTED', inspectedNodeCount, totalCandidateCount: Math.min(nodes.length, 100000),
      moreControlCount, truncated: inspectedNodeCount < nodes.length,
      labels: [...labels].map(([name,count]) => ({name,count})), classes: [...classes],
      attributes: [...attributes].map(([name,count]) => ({name,count})), selectorShapes: [...selectorShapes] };
  } catch { return empty; }
})()`;

/** Validate page output at the boundary; unexpected page-owned text never reaches a diagnostic. */
export function formatSbobetDomDiscovery(value: unknown): string | null {
  if (!record(value) || value.kind !== "SBOBET_PASSIVE_DOM_DISCOVERY" || !Array.isArray(value.labels) ||
    !Array.isArray(value.attributes) || !Array.isArray(value.selectorShapes) || !Array.isArray(value.classes)) return null;
  const labels = value.labels.slice(0, 16).flatMap((item: unknown) => record(item) &&
    (LABEL_NAMES as readonly unknown[]).includes(item.name) ? [`${item.name}:${boundedCount(item.count, 400)}`] : []);
  const attributes = value.attributes.slice(0, 16).flatMap((item: unknown) => record(item) &&
    (ATTRIBUTE_NAMES as readonly unknown[]).includes(item.name) ? [`${item.name}:${boundedCount(item.count, 400)}`] : []);
  const selectorCount = value.selectorShapes.slice(0, 32).filter((shape: unknown) => (SELECTOR_SHAPES as readonly unknown[]).includes(shape)).length;
  const classCount = value.classes.slice(0, 32).filter((name: unknown) => (CLASS_NAMES as readonly unknown[]).includes(name)).length;
  return (`sbo-dom[status=${value.status === "INSPECTED" ? "INSPECTED" : "UNAVAILABLE"}` +
    ` nodes=${boundedCount(value.inspectedNodeCount, 400)} total=${boundedCount(value.totalCandidateCount, 100000)}` +
    ` more=${boundedCount(value.moreControlCount, 400)} trunc=${value.truncated === true ? 1 : 0}` +
    ` selectors=${Math.min(selectorCount, SELECTOR_SHAPES.length)} classes=${Math.min(classCount, CLASS_NAMES.length)}` +
    ` labels=${labels.join(",")} attrs=${attributes.join(",")}]`).slice(0, 440);
}

function boundedCount(value: unknown, maximum: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.min(maximum, Math.floor(value)) : 0;
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
