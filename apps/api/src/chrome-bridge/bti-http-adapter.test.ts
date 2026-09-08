import { describe, expect, it } from "vitest";
import type { ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import type { ObservedProviderCatalog } from "../providers/cmd/cmd-observed-catalog.js";
import { BtiHttpCatalogAdapter } from "./bti-http-adapter.js";

const selection = (id: string, side: 1 | 3, line: number, malay: string) =>
  [id, { VI: "team" }, { VI: "team line" }, false, false, 1.9, ["", "1.90", "", "", "", malay], side, 2, {}, "", "event", "market", line];
const market = ["hc", "Live", "Live", ["HC39", "full time", 1], "event", "league", "1", [
  selection("home", 1, -0.5, "0.82"), selection("away", 3, 0.5, "-0.92")]];
const payload = { serializedData: [["league", "Champions League", 0, "", false, "", "", "", "", "", "1", "Football", [[
  "event", [["h", { VI: "Alpha" }], ["a", { VI: "Beta" }]], "Alpha vs Beta", "", ["1", "0"], true, false, [],
  ["event", 0, [], [market]]
]]]] };

function envelope(body = JSON.stringify(payload)): ChromeBridgeEnvelope {
  return { version: 1, kind: "NETWORK", lobby: "BTI", sourceId: "chrome:BTI:1", tabId: 1,
    sequence: 9, observedAtMs: 1_786_805_000_000, receivedMonotonicMs: 20, transport: "HTTP_RESPONSE",
    request: { hostname: "prod.example.com", pathnameClass: "/api/eventlist/asia/leagues/v2/1/live", resourceType: "Fetch" },
    payload: { encoding: "UTF8", body } };
}

const listPaths = [
  "/api/eventlist/asia/leagues/v2/1/live",
  "/api/eventlist/asia/leagues/v2/1/live/initial",
  "/api/eventlist/asia/leagues/v2/1/prematch",
  "/api/eventlist/asia/leagues/v2/1/prematch/initial"
] as const;

function generationEnvelope(path: typeof listPaths[number], generation: string, sequence: number,
  body = JSON.stringify(payload)): ChromeBridgeEnvelope {
  return { ...envelope(body), sequence, request: { ...envelope().request, pathnameClass: path, streamId: generation } };
}

function completeGeneration(adapter: BtiHttpCatalogAdapter, generation: string, firstSequence: number,
  body = JSON.stringify(payload)) {
  return listPaths.map((path, index) => adapter.decode(generationEnvelope(path, generation,
    firstSequence + index, body)));
}

function committedCatalog(adapter: BtiHttpCatalogAdapter, generation = "bti:1000:1",
  firstSequence = 1, body = JSON.stringify(payload)) {
  return completeGeneration(adapter, generation, firstSequence, body)[3]![0]!.value;
}

function detailPayload(eventId = "event"): unknown {
  const detailSelection = (id: string, side: 1 | 3, points: number, malay: string) => {
    const value = Array<unknown>(30).fill(null);
    value[0] = id; value[2] = id.includes("over") ? { VI: "Over" } : id.includes("under") ? { VI: "Under" } :
      side === 1 ? { VI: "Home" } : { VI: "Away" };
    value[5] = false; value[8] = ["", "1.90", "", "", "", malay];
    value[9] = side; value[13] = false; value[16] = points;
    return value;
  };
  const detailMarket = Array<unknown>(30).fill(null);
  detailMarket[0] = "detail-ou"; detailMarket[1] = "OU1"; detailMarket[5] = ["OU1", "OU1"];
  detailMarket[6] = eventId; detailMarket[13] = [
    detailSelection("detail-over", 1, 2.75, "0.90"), detailSelection("detail-under", 3, 2.75, "-0.99")
  ];
  const detailEvent = Array<unknown>(39).fill(null);
  detailEvent[0] = eventId; detailEvent[1] = "league"; detailEvent[2] = "Champions League";
  detailEvent[3] = "1"; detailEvent[8] = [["h", { VI: "Home" }, "Home"], ["a", { VI: "Away" }, "Away"]];
  detailEvent[11] = "2026-08-19T00:15:00.000Z"; detailEvent[13] = true; detailEvent[20] = [detailMarket];
  return { data: [detailEvent] };
}

function detailEnvelope(body: unknown = detailPayload(), observedAtMs = envelope().observedAtMs,
  generation: string | null = "bti:1000:1", eventId = "event"): ChromeBridgeEnvelope {
  return { ...envelope(JSON.stringify(body)), sequence: 10, observedAtMs,
    request: { ...envelope().request, pathnameClass: `/api/eventpage/events/${eventId}`,
      ...(generation === null ? {} : { streamId: generation }) } };
}

describe("BtiHttpCatalogAdapter", () => {
  const now = envelope().observedAtMs;
  function cachedDetail(body: unknown, observedAtMs: number, requestedAtMs = observedAtMs,
    outerGeneration = "bti:1000:1", originalGeneration = outerGeneration) {
    return detailEnvelope({ ...body as object, fieldlineBtiDetails: [{ eventId: "event",
      observedAtMs, requestedAtMs, generation: originalGeneration }] }, now + 10_000,
    outerGeneration, "__fieldline_batch_0__");
  }
  function overlapDetail(line = -0.5, price = "0.60") {
    const body = detailPayload() as { data: unknown[][] };
    const event = body.data[0]!;
    const value = (event[20] as unknown[][])[0]!;
    const overlapping = structuredClone(value);
    overlapping[0] = "hc"; overlapping[1] = "HC39"; overlapping[5] = ["HC39", "full time"];
    const selections = overlapping[13] as unknown[][];
    selections[0]![0] = "home"; selections[0]![2] = { EN: "Home" }; selections[0]![16] = line;
    (selections[0]![8] as unknown[])[5] = price;
    selections[1]![0] = "away"; selections[1]![2] = { EN: "Away" }; selections[1]![16] = -line;
    event[20] = [value, overlapping];
    return body;
  }

  it("keeps newer main prices while retaining hidden detail with its original cache clock", () => {
    const adapter = new BtiHttpCatalogAdapter();
    committedCatalog(adapter);
    const catalog = adapter.decode(cachedDetail(overlapDetail(), now - 100))[0]!.value as ObservedProviderCatalog;
    expect(catalog.quotes.find((quote) => quote.providerSelectionId === "home")?.rawOdds).toBe("0.82");
    expect(catalog.quotes.find((quote) => quote.providerSelectionId === "detail-over")?.receivedMonotonicMs).toBe(-10_080);
    expect(catalog.nativeMarketObservations?.find((item) => item.providerMarketId === "detail-ou:2.75")?.observedAtMs).toBe(now - 100);
  });

  it("replaces a changed native line instead of leaving the stale detail line beside main", () => {
    const adapter = new BtiHttpCatalogAdapter();
    committedCatalog(adapter);
    const catalog = adapter.decode(cachedDetail(overlapDetail(-1.5), now - 100))[0]!.value as ObservedProviderCatalog;
    expect(catalog.markets.filter((item) => item.marketType === "FT_AH").map((item) => item.line)).toEqual(["-0.5"]);
    expect(catalog.markets.some((item) => item.marketType === "FH_TOTAL")).toBe(true);
  });

  it("retains hidden alternate selections when a shallow main family updates its visible line", () => {
    const adapter = new BtiHttpCatalogAdapter();
    committedCatalog(adapter);
    const body = overlapDetail(-1.5);
    const selections = ((body.data[0]![20] as unknown[][])[1]![13]) as unknown[][];
    const alternate = structuredClone(selections);
    alternate[0]![0] = "alt-home"; alternate[0]![16] = -2.5;
    alternate[1]![0] = "alt-away"; alternate[1]![16] = 2.5;
    selections.push(...alternate);
    const catalog = adapter.decode(cachedDetail(body, now - 100))[0]!.value as ObservedProviderCatalog;
    expect(catalog.markets.filter((item) => item.marketType === "FT_AH").map((item) => item.line).sort())
      .toEqual(["-0.5", "-2.5"]);
    expect(catalog.quotes.find((item) => item.providerSelectionId === "alt-home")?.receivedMonotonicMs).toBe(-10_080);
  });

  it("rejects an older request completing after newer hidden prices in the same generation", () => {
    const adapter = new BtiHttpCatalogAdapter();
    committedCatalog(adapter);
    adapter.decode(cachedDetail(detailPayload(), now + 200, now + 150));
    expect(adapter.decode(cachedDetail(detailPayload(), now + 300, now + 100))).toEqual([]);
  });

  it("honors explicit empty detail batch entries and remembers their removal clock", () => {
    const adapter = new BtiHttpCatalogAdapter();
    committedCatalog(adapter);
    adapter.decode(cachedDetail(detailPayload(), now + 100));
    const removed = adapter.decode(cachedDetail({ data: [] }, now + 200));
    expect(removed).toHaveLength(1);
    expect((removed[0]!.value as ObservedProviderCatalog).markets.map((item) => item.marketType)).toEqual(["FT_AH"]);
    expect(adapter.decode(cachedDetail(detailPayload(), now + 150))).toEqual([]);
  });

  it("preserves old detail cache clocks when a newer roster generation replays them", () => {
    const adapter = new BtiHttpCatalogAdapter();
    committedCatalog(adapter, "bti:2000:1");
    const catalog = adapter.decode(cachedDetail(detailPayload(), now - 100, now - 200,
      "bti:2000:1", "bti:1000:1"))[0]!.value as ObservedProviderCatalog;
    expect(catalog.quotes.find((quote) => quote.providerSelectionId === "detail-over")?.receivedMonotonicMs).toBe(-10_080);
  });

  it("rejects malformed or future detail metadata instead of falling back to fresh envelope time", () => {
    const adapter = new BtiHttpCatalogAdapter();
    committedCatalog(adapter);
    expect(adapter.decode(cachedDetail(detailPayload(), now + 20_000))).toEqual([]);
    expect(adapter.decode(detailEnvelope({ ...detailPayload() as object,
      fieldlineBtiDetails: [{ eventId: "event", observedAtMs: now }] }))).toEqual([]);
  });

  it("keeps cached roster quote timestamps at source acquisition time", () => {
    const adapter = new BtiHttpCatalogAdapter();
    const catalog = committedCatalog(adapter, "bti:1000:1", 1, JSON.stringify({ ...payload,
      fieldlineBtiRoster: { observedAtMs: now - 200, requestedAtMs: now - 300,
        generation: "bti:1000:1" } })) as ObservedProviderCatalog;
    expect(catalog.quotes[0]!.receivedMonotonicMs).toBe(-180);
  });

  it("updates hidden prices, suspension and replacement lines after bootstrap", () => {
    const adapter = new BtiHttpCatalogAdapter();
    committedCatalog(adapter);
    adapter.decode(cachedDetail(detailPayload(), now + 100));
    const changed = detailPayload() as { data: unknown[][] };
    const selections = ((changed.data[0]![20] as unknown[][])[0]![13]) as unknown[][];
    (selections[0]![8] as unknown[])[5] = "0.75";
    selections[0]![5] = true;
    selections[0]![16] = 3.5; selections[1]![16] = 3.5;
    const catalog = adapter.decode(cachedDetail(changed, now + 200))[0]!.value as ObservedProviderCatalog;
    expect(catalog.quotes.find((quote) => quote.providerSelectionId === "detail-over")).toMatchObject({
      rawOdds: "0.75", status: "SUSPENDED", providerMarketId: "detail-ou:3.5" });
    expect(catalog.markets.map((market) => market.providerMarketId)).not.toContain("detail-ou:2.75");
  });

  it("removes a previously open main family when newer detail explicitly closes it", () => {
    const adapter = new BtiHttpCatalogAdapter();
    committedCatalog(adapter);
    const changed = overlapDetail();
    (changed.data[0]![20] as unknown[][])[1]![15] = true;
    const catalog = adapter.decode(cachedDetail(changed, now + 100))[0]!.value as ObservedProviderCatalog;
    expect(catalog.markets.some((market) => market.marketType === "FT_AH")).toBe(false);
    expect(catalog.nativeMarketObservations).toContainEqual(expect.objectContaining({
      providerMarketId: "hc", reason: "MARKET_CLOSED" }));
  });

  it.each(["omitted", "empty"])("preserves a closed main family after a later %s detail partition", (kind) => {
    const adapter = new BtiHttpCatalogAdapter();
    committedCatalog(adapter);
    const closed = overlapDetail();
    (closed.data[0]![20] as unknown[][])[1]![15] = true;
    adapter.decode(cachedDetail(closed, now + 100));
    const body = kind === "empty" ? { data: [] } : detailPayload();
    const catalog = adapter.decode(cachedDetail(body, now + 200))[0]!.value as ObservedProviderCatalog;
    expect(catalog.markets.some((market) => market.marketType === "FT_AH")).toBe(false);
    expect(catalog.nativeMarketObservations).toContainEqual(expect.objectContaining({
      providerMarketId: "hc", reason: "MARKET_CLOSED", observedAtMs: now + 100 }));
  });

  it.each(["omitted", "empty"])("does not resurrect older main prices after ordinary %s detail removal", (kind) => {
    const adapter = new BtiHttpCatalogAdapter();
    committedCatalog(adapter);
    adapter.decode(cachedDetail(overlapDetail(), now + 100));
    const catalog = adapter.decode(cachedDetail(kind === "empty" ? { data: [] } : detailPayload(),
      now + 200))[0]!.value as ObservedProviderCatalog;
    expect(catalog.markets.some((market) => market.marketType === "FT_AH")).toBe(false);
    expect(catalog.quotes.some((quote) => quote.providerSelectionId === "home")).toBe(false);
    const later = adapter.decode(cachedDetail(detailPayload(), now + 300))[0]!.value as ObservedProviderCatalog;
    expect(later.markets.some((market) => market.marketType === "FT_AH")).toBe(false);
  });

  it("preserves main prices acquired after an ordinary detail removal", () => {
    const adapter = new BtiHttpCatalogAdapter();
    committedCatalog(adapter, "bti:1000:1", 1, JSON.stringify({ ...payload,
      fieldlineBtiRoster: { requestedAtMs: now - 300, observedAtMs: now - 300, generation: "bti:1000:1" } }));
    adapter.decode(cachedDetail(overlapDetail(), now - 200));
    committedCatalog(adapter, "bti:2000:1", 20);
    const catalog = adapter.decode(cachedDetail({ data: [] }, now - 100, now - 100,
      "bti:2000:1"))[0]!.value as ObservedProviderCatalog;
    expect(catalog.quotes.find((quote) => quote.providerSelectionId === "home")?.rawOdds).toBe("0.82");
  });

  it.each(["known", "unresolved"])("keeps good detail events when a batched event has %s roster identity", (identity) => {
    const adapter = new BtiHttpCatalogAdapter();
    const roster = structuredClone(payload);
    const events = roster.serializedData[0]![12] as unknown[][];
    const extra = structuredClone(events[0]!);
    extra[0] = "event-2";
    if (identity === "unresolved") { extra[1] = [["h", {}], ["a", {}]]; extra[2] = ""; }
    events.push(extra);
    committedCatalog(adapter, "bti:1000:1", 1, JSON.stringify(roster));
    const first = detailPayload() as { data: unknown[][] };
    const second = detailPayload("event-2") as { data: unknown[][] };
    second.data[0]![8] = [["h", {}], ["a", {}]];
    const updates = adapter.decode(detailEnvelope({ data: [first.data[0], second.data[0]],
      fieldlineBtiDetails: ["event", "event-2"].map((eventId) => ({ eventId,
        requestedAtMs: now + 50, observedAtMs: now + 100, generation: "bti:1000:1" })) },
    now + 100, "bti:1000:1", "__fieldline_batch_0__"));
    expect(updates).toHaveLength(1);
    const catalog = updates[0]!.value as ObservedProviderCatalog;
    expect(catalog.quotes.filter((quote) => quote.providerEventId === "event" &&
      quote.providerMarketId === "detail-ou:2.75")).toHaveLength(2);
    if (identity === "known") {
      expect(catalog.quotes.filter((quote) => quote.providerEventId === "event-2" &&
        quote.providerMarketId === "detail-ou:2.75")).toHaveLength(2);
    } else {
      expect(catalog.quotes.some((quote) => quote.providerEventId === "event-2")).toBe(false);
      expect(catalog.nativeMarketObservations).toContainEqual(expect.objectContaining({
        providerEventId: "event-2", disposition: "EXCLUDED", reason: "EVENT_IDENTITY_UNRESOLVED" }));
    }
  });

  it("does not combine a conflicting detail participant with a missing roster-supplied opponent", () => {
    const adapter = new BtiHttpCatalogAdapter();
    committedCatalog(adapter);
    const detail = detailPayload() as { data: unknown[][] };
    detail.data[0]![8] = [["h", { EN: "Different Club" }], ["a", {}]];
    const catalog = adapter.decode(cachedDetail(detail, now + 100))[0]!.value as ObservedProviderCatalog;
    expect(catalog.markets.some((market) => market.marketType === "FH_TOTAL")).toBe(false);
    expect(catalog.nativeMarketObservations).toContainEqual(expect.objectContaining({
      reason: "EVENT_IDENTITY_UNRESOLVED", disposition: "EXCLUDED" }));
  });

  it("retains unmatched native selection diagnostics when main only updates its visible pair", () => {
    const adapter = new BtiHttpCatalogAdapter();
    committedCatalog(adapter);
    const detail = overlapDetail(-1.5);
    const selections = (detail.data[0]![20] as unknown[][])[1]![13] as unknown[][];
    const unmatched = structuredClone(selections[0]!);
    unmatched[0] = "unmatched-hidden-home"; unmatched[16] = -2.5;
    selections.push(unmatched);
    const catalog = adapter.decode(cachedDetail(detail, now - 100))[0]!.value as ObservedProviderCatalog;
    expect(catalog.nativeMarketObservations).toContainEqual(expect.objectContaining({
      providerMarketId: "hc", disposition: "EXCLUDED", reason: "UNPAIRED_OR_INVALID_NATIVE_SELECTIONS",
      observedAtMs: now - 100 }));
  });

  it("honors whole-event closure with a safe numeric native event identity", () => {
    const adapter = new BtiHttpCatalogAdapter();
    const roster = structuredClone(payload);
    (roster.serializedData[0]![12] as unknown[][])[0]![0] = 123;
    committedCatalog(adapter, "bti:1000:1", 1, JSON.stringify(roster));
    const detail = detailPayload("123") as { data: unknown[][] };
    detail.data[0]![0] = 123; detail.data[0]![32] = true;
    const catalog = adapter.decode(detailEnvelope(detail, now + 100, "bti:1000:1", "123"))[0]!.value as ObservedProviderCatalog;
    expect(catalog.markets).toHaveLength(0);
  });

  it("hydrates cached unresolved detail when its roster arrives later without refreshing quote age", () => {
    const adapter = new BtiHttpCatalogAdapter();
    const detail = detailPayload() as { data: unknown[][] };
    detail.data[0]![8] = [["h", {}], ["a", {}]];
    expect(adapter.decode(cachedDetail(detail, now - 100))).toEqual([]);
    const catalog = committedCatalog(adapter) as ObservedProviderCatalog;
    expect(catalog.quotes.find((quote) => quote.providerSelectionId === "detail-over")).toMatchObject({
      rawOdds: "0.90", receivedMonotonicMs: -10_080, sequence: 10 });
    expect(catalog.nativeMarketObservations).toContainEqual(expect.objectContaining({
      providerMarketId: "detail-ou:2.75", disposition: "NORMALIZED", observedAtMs: now - 100 }));
  });

  it("skips an unresolved empty shell without dropping good batch updates or deleting its previous detail", () => {
    const adapter = new BtiHttpCatalogAdapter();
    const roster = structuredClone(payload);
    const events = roster.serializedData[0]![12] as unknown[][];
    const extra = structuredClone(events[0]!);
    extra[0] = "event-2"; extra[1] = [["h", {}], ["a", {}]]; extra[2] = "";
    events.push(extra);
    committedCatalog(adapter, "bti:1000:1", 1, JSON.stringify(roster));
    adapter.decode(detailEnvelope(detailPayload("event-2"), now + 50, "bti:1000:1", "event-2"));
    const good = detailPayload() as { data: unknown[][] };
    const shell = detailPayload("event-2") as { data: unknown[][] };
    shell.data[0]![8] = [["h", {}], ["a", {}]]; shell.data[0]![20] = [];
    const updates = adapter.decode(detailEnvelope({ data: [good.data[0], shell.data[0]],
      fieldlineBtiDetails: ["event", "event-2"].map((eventId) => ({ eventId,
        requestedAtMs: now + 75, observedAtMs: now + 100, generation: "bti:1000:1" })) },
    now + 100, "bti:1000:1", "__fieldline_batch_0__"));
    expect(updates).toHaveLength(1);
    const catalog = updates[0]!.value as ObservedProviderCatalog;
    expect(catalog.quotes.filter((quote) => quote.providerMarketId === "detail-ou:2.75")
      .map((quote) => quote.providerEventId).sort()).toEqual(["event", "event", "event-2", "event-2"]);
  });

  it("preserves whole-event closure after a later successful empty detail", () => {
    const adapter = new BtiHttpCatalogAdapter();
    committedCatalog(adapter);
    const closed = detailPayload() as { data: unknown[][] };
    closed.data[0]![32] = true;
    adapter.decode(cachedDetail(closed, now + 100));
    const catalog = adapter.decode(cachedDetail({ data: [] }, now + 200))[0]!.value as ObservedProviderCatalog;
    expect(catalog.markets).toHaveLength(0);
    expect(catalog.quotes).toHaveLength(0);
  });

  it("preserves buffered closure history when detail becomes empty before its roster commits", () => {
    const adapter = new BtiHttpCatalogAdapter();
    const closed = overlapDetail();
    (closed.data[0]![20] as unknown[][])[1]![15] = true;
    expect(adapter.decode(cachedDetail(closed, now + 100))).toEqual([]);
    expect(adapter.decode(cachedDetail({ data: [] }, now + 200))).toEqual([]);
    const catalog = committedCatalog(adapter) as ObservedProviderCatalog;
    expect(catalog.markets).toHaveLength(0);
  });

  it("allows only newer affirmative main evidence to reopen a retained closure", () => {
    const adapter = new BtiHttpCatalogAdapter();
    const originalRoster = JSON.stringify({ ...payload, fieldlineBtiRoster: {
      observedAtMs: now - 300, requestedAtMs: now - 300, generation: "bti:1000:1" } });
    committedCatalog(adapter, "bti:1000:1", 1, originalRoster);
    const closed = overlapDetail();
    (closed.data[0]![20] as unknown[][])[1]![15] = true;
    adapter.decode(cachedDetail(closed, now - 200));
    adapter.decode(cachedDetail({ data: [] }, now - 100));
    const stale = committedCatalog(adapter, "bti:2000:1", 20, originalRoster) as ObservedProviderCatalog;
    expect(stale.markets).toHaveLength(0);
    const fresh = committedCatalog(adapter, "bti:3000:1", 30) as ObservedProviderCatalog;
    expect(fresh.markets.map((market) => market.providerMarketId)).toEqual(["hc:-0.5"]);
  });

  it.each(["reset", "roster removal"])("discards closure history after source %s", (kind) => {
    const adapter = new BtiHttpCatalogAdapter();
    committedCatalog(adapter);
    const closed = overlapDetail();
    (closed.data[0]![20] as unknown[][])[1]![15] = true;
    adapter.decode(cachedDetail(closed, now + 100));
    adapter.decode(cachedDetail({ data: [] }, now + 200));
    if (kind === "reset") adapter.resetSource("chrome:BTI:1");
    else committedCatalog(adapter, "bti:2000:1", 20, JSON.stringify({ serializedData: [] }));
    const fresh = committedCatalog(adapter, "bti:3000:1", 30) as ObservedProviderCatalog;
    expect(fresh.markets.map((market) => market.providerMarketId)).toEqual(["hc:-0.5"]);
  });

  it("retires prematch detail when the roster moves the event live and ignores its old cache", () => {
    const adapter = new BtiHttpCatalogAdapter();
    const prematchRoster = structuredClone(payload);
    const event = (prematchRoster.serializedData[0]![12] as unknown[][])[0]!;
    event[5] = false; event[3] = "2026-08-19T00:15:00.000Z";
    committedCatalog(adapter, "bti:1000:1", 1, JSON.stringify(prematchRoster));
    const prematchDetail = detailPayload() as { data: unknown[][] };
    prematchDetail.data[0]![13] = false;
    adapter.decode(cachedDetail(prematchDetail, now - 100));
    const catalog = committedCatalog(adapter, "bti:2000:1", 20) as ObservedProviderCatalog;
    expect(catalog.markets.some((market) => market.marketType === "FH_TOTAL")).toBe(false);
    expect(adapter.decode(cachedDetail(prematchDetail, now - 100, now - 100,
      "bti:2000:1", "bti:1000:1"))).toEqual([]);
  });

  it("retires detail on an explicit closed event row while retaining closure evidence", () => {
    const adapter = new BtiHttpCatalogAdapter();
    committedCatalog(adapter);
    adapter.decode(cachedDetail(detailPayload(), now + 100));
    const closed = detailPayload() as { data: unknown[][] };
    closed.data[0]![32] = true;
    const updates = adapter.decode(cachedDetail(closed, now + 200));
    expect(updates).toHaveLength(1);
    const catalog = updates[0]!.value as ObservedProviderCatalog;
    expect(catalog.markets).toHaveLength(0);
    expect(catalog.nativeMarketObservations).toContainEqual(expect.objectContaining({
      providerMarketId: "detail-ou", reason: "EVENT_CLOSED" }));
  });

  it("keeps observations for native rows with no market id", () => {
    const adapter = new BtiHttpCatalogAdapter();
    committedCatalog(adapter);
    const body = detailPayload() as { data: unknown[][] };
    const market = (body.data[0]![20] as unknown[][])[0]!;
    market[0] = ""; market[1] = "ZZ999"; market[5] = ["ZZ999", "Mystery"];
    const catalog = adapter.decode(cachedDetail(body, now + 100))[0]!.value as ObservedProviderCatalog;
    expect(catalog.nativeMarketObservations).toContainEqual(expect.objectContaining({
      providerMarketId: "event:native:detail:20:0", disposition: "UNMAPPED" }));
  });

  it("publishes one BTI event-list generation only after every partition is complete", () => {
    const adapter = new BtiHttpCatalogAdapter();
    const updates = completeGeneration(adapter, "bti:2000:1", 20);

    expect(updates.slice(0, 3)).toEqual([[], [], []]);
    expect(updates[3]).toEqual([expect.objectContaining({ authoritativeBaseline: true,
      generation: "bti:2000:1",
      sequence: 23, value: expect.objectContaining({ events: [expect.objectContaining({
        providerEventId: "event" })] }) })]);
  });

  it("does not commit raw league pages before the complete hydrated roster of the same generation", () => {
    const adapter = new BtiHttpCatalogAdapter();
    const generation = "bti:4000:1";
    const clock = { observedAtMs: now, requestedAtMs: now - 100, generation };
    const partial = JSON.stringify({ ...payload, fieldlineBtiRoster: { ...clock, complete: false } });
    for (const [index, path] of [listPaths[0], listPaths[1], listPaths[3]].entries()) {
      expect(adapter.decode(generationEnvelope(path!, generation, 50 + index, partial))).toEqual([]);
    }
    const full = structuredClone(payload);
    const events = full.serializedData[0]![12] as unknown[][];
    const extra = structuredClone(events[0]!);
    extra[0] = "hydrated-event";
    events.push(extra);
    const catalog = committedCatalog(adapter, generation, 60, JSON.stringify({ ...full,
      fieldlineBtiRoster: { ...clock, complete: true } })) as ObservedProviderCatalog;
    expect(catalog.events.map((event) => event.providerEventId)).toEqual(["event", "hydrated-event"]);
  });

  it("publishes an atomic generation when the provider rejects the optional non-initial prematch route", () => {
    const adapter = new BtiHttpCatalogAdapter();
    const required = [listPaths[0], listPaths[1], listPaths[3]] as const;

    const updates = required.map((path, index) =>
      adapter.decode(generationEnvelope(path, "bti:2100:1", 30 + index)));

    expect(updates.slice(0, 2)).toEqual([[], []]);
    expect(updates[2]).toEqual([expect.objectContaining({ authoritativeBaseline: true,
      value: expect.objectContaining({ events: expect.any(Array), quotes: expect.any(Array) }) })]);
  });

  it("accepts the optional prematch partition when it arrives after the required generation commits", () => {
    const adapter = new BtiHttpCatalogAdapter();
    const required = [listPaths[0], listPaths[1], listPaths[3]] as const;
    const updates = required.map((path, index) =>
      adapter.decode(generationEnvelope(path, "bti:2200:1", 40 + index)));
    expect(updates[2]).toHaveLength(1);

    expect(adapter.decode(generationEnvelope(listPaths[2], "bti:2200:1", 43)))
      .toEqual([expect.objectContaining({ authoritativeBaseline: true, sequence: 43 })]);
  });

  it("keeps raw roster ids so later hidden detail can join even before names are populated", () => {
    const adapter = new BtiHttpCatalogAdapter();
    const rosterOnly = JSON.stringify({ serializedData: [["league-hidden", "Hidden League", 0, "", false,
      "", "", "", "", "", "1", "Football", [["hidden-event",
        [["h", {}], ["a", {}]], "",
        "2026-09-07T00:15:00.000Z", ["", ""], false, false, [], ["hidden-event", 0, [], []]]]]] });

    expect(adapter.decode(generationEnvelope(listPaths[0], "bti:2300:1", 50, rosterOnly))).toEqual([]);
    expect(adapter.decode(generationEnvelope(listPaths[1], "bti:2300:1", 51))).toEqual([]);
    const committed = adapter.decode(generationEnvelope(listPaths[3], "bti:2300:1", 52))[0]!.value as {
      events: Array<{ providerEventId: string }>;
    };
    expect(committed.events.map(({ providerEventId }) => providerEventId)).toEqual(["event"]);

    const enriched = adapter.decode(detailEnvelope(detailPayload("hidden-event"),
      envelope().observedAtMs + 1, "bti:2300:1", "hidden-event"))[0]!.value as {
      events: Array<{ providerEventId: string }>;
    };
    expect(enriched.events.map(({ providerEventId }) => providerEventId)).toEqual(
      expect.arrayContaining(["event", "hidden-event"]));
  });

  it("does not roll back when an older generation completes after a newer snapshot", () => {
    const adapter = new BtiHttpCatalogAdapter();
    for (const [index, path] of listPaths.slice(0, 3).entries()) {
      expect(adapter.decode(generationEnvelope(path, "bti:1000:9", index + 1))).toEqual([]);
    }
    const newestPayload = JSON.stringify({ ...payload, serializedData: payload.serializedData.map((league) =>
      league.map((value, index) => index === 12 ? (value as unknown[]).map((event) => {
        const copy = [...event as unknown[]]; copy[0] = "new-event"; return copy;
      }) : value)) });
    const newest = completeGeneration(adapter, "bti:2000:1", 10, newestPayload)[3]!;
    expect((newest[0]!.value as { events: Array<{ providerEventId: string }> }).events
      .map(({ providerEventId }) => providerEventId)).toEqual(["new-event"]);

    expect(adapter.decode(generationEnvelope(listPaths[3], "bti:1000:9", 30))).toEqual([]);
  });

  it("retires an incomplete generation as soon as any response from a newer generation arrives", () => {
    const adapter = new BtiHttpCatalogAdapter();
    for (const [index, path] of listPaths.slice(0, 3).entries()) {
      expect(adapter.decode(generationEnvelope(path, "bti:1000:1", index + 1))).toEqual([]);
    }
    expect(adapter.decode(generationEnvelope(listPaths[0], "bti:2000:1", 10))).toEqual([]);
    expect(adapter.decode(generationEnvelope(listPaths[3], "bti:1000:1", 11))).toEqual([]);
  });

  it("keeps the last good catalog when a newer refresh times out after empty partial responses", () => {
    const adapter = new BtiHttpCatalogAdapter();
    completeGeneration(adapter, "bti:1000:1", 1);
    const empty = JSON.stringify({ serializedData: [] });
    for (const [index, path] of listPaths.slice(0, 3).entries()) {
      expect(adapter.decode(generationEnvelope(path, "bti:2000:1", 10 + index, empty))).toEqual([]);
    }

    const detail = adapter.decode(detailEnvelope());
    expect((detail[0]!.value as { events: Array<{ providerEventId: string }> }).events
      .map(({ providerEventId }) => providerEventId)).toContain("event");
  });

  it("does not let an uncorrelated or older detail response overlay the current generation", () => {
    const adapter = new BtiHttpCatalogAdapter();
    committedCatalog(adapter, "bti:1000:1");
    expect(adapter.decode(detailEnvelope(detailPayload(), envelope().observedAtMs, null))).toEqual([]);
    committedCatalog(adapter, "bti:2000:1", 20);
    expect(adapter.decode(detailEnvelope(detailPayload(), envelope().observedAtMs + 1, "bti:1000:1"))).toEqual([]);
  });
  it("merges bounded event-page detail markets into the current BTI catalog", () => {
    const adapter = new BtiHttpCatalogAdapter();
    committedCatalog(adapter);
    expect(adapter.fingerprint(detailEnvelope())).toBe(true);
    const update = adapter.decode(detailEnvelope())[0]!;
    expect(update).toMatchObject({ authoritativeBaseline: false, generation: "bti:1000:1" });
    const combined = update.value as {
      events: unknown[]; markets: { marketType: string }[]; quotes: unknown[];
      nativeMarketObservations: Array<{ providerMarketId: string; disposition: string }>;
    };
    expect(combined.events).toHaveLength(1);
    expect(combined.markets.map(({ marketType }) => marketType)).toEqual(
      expect.arrayContaining(["FT_AH", "FH_TOTAL"]));
    expect(combined.quotes).toHaveLength(4);
    expect(combined.nativeMarketObservations).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerMarketId: "detail-ou:2.75", disposition: "NORMALIZED" })
    ]));
  });

  it("retains a detail event whose only market is an unmapped native group", () => {
    const adapter = new BtiHttpCatalogAdapter();
    committedCatalog(adapter);
    const nativeSelection = (id: string, name: string, side: number) => {
      const value = Array<unknown>(17).fill(null);
      value[0] = id; value[2] = { EN: name }; value[8] = [null, null, null, null, null, "0.80"];
      value[9] = side; value[13] = false; value[16] = 0;
      return value;
    };
    const nativeMarket = Array<unknown>(24).fill(null);
    nativeMarket[0] = "native-card-only";
    nativeMarket[1] = { EN: "Mystery cards" };
    nativeMarket[5] = ["ZZ999", { EN: "Mystery cards" }];
    nativeMarket[13] = [nativeSelection("native-yes", "Yes", 7),
      nativeSelection("native-no", "No", 8)];
    const nativeEvent = Array<unknown>(34).fill(null);
    nativeEvent[0] = "event"; nativeEvent[2] = "Champions League";
    nativeEvent[8] = [["h", { EN: "Alpha" }], ["a", { EN: "Beta" }]];
    nativeEvent[11] = "2026-08-19T00:15:00.000Z"; nativeEvent[13] = true;
    nativeEvent[20] = [nativeMarket]; nativeEvent[33] = [];

    const update = adapter.decode(detailEnvelope({ data: [nativeEvent] }))[0]!.value as {
      nativeMarketObservations: Array<{ providerMarketId: string; nativeType: string;
        disposition: string; reason: string }>;
    };

    expect(update.nativeMarketObservations).toContainEqual(expect.objectContaining({
      providerMarketId: "native-card-only", nativeType: "ZZ999",
      disposition: "UNMAPPED", reason: "NATIVE_TYPE_UNMAPPED"
    }));
  });

  it("merges every listed event from a compact BTI detail batch", () => {
    const adapter = new BtiHttpCatalogAdapter();
    const originalLeague = payload.serializedData[0] as unknown[];
    const league = [...originalLeague];
    const firstEvent = (originalLeague[12] as unknown[][])[0]!;
    const secondEvent = [...firstEvent];
    secondEvent[0] = "event-2";
    secondEvent[1] = [["h", { VI: "Gamma" }], ["a", { VI: "Delta" }]];
    secondEvent[2] = "Gamma vs Delta";
    league[12] = [firstEvent, secondEvent];
    committedCatalog(adapter, "bti:1000:1", 1, JSON.stringify({ serializedData: [league] }));
    const firstDetail = (detailPayload("event") as { data: unknown[] }).data[0];
    const secondDetail = (detailPayload("event-2") as { data: unknown[] }).data[0];

    const update = adapter.decode(detailEnvelope({ data: [firstDetail, secondDetail] },
      envelope().observedAtMs + 1, "bti:1000:1", "__fieldline_batch_0__"))[0]!;
    const combined = update.value as {
      events: Array<{ providerEventId: string }>;
      markets: Array<{ providerEventId: string; marketType: string }>;
    };

    expect(update).toMatchObject({ authoritativeBaseline: false, generation: "bti:1000:1" });
    expect(combined.events.map(({ providerEventId }) => providerEventId)).toEqual(["event", "event-2"]);
    expect(combined.markets.filter(({ marketType }) => marketType === "FH_TOTAL")
      .map(({ providerEventId }) => providerEventId)).toEqual(["event", "event-2"]);
  });

  it("preserves list participant identity when event detail only labels sides as Home and Away", () => {
    const adapter = new BtiHttpCatalogAdapter();
    committedCatalog(adapter);
    const combined = adapter.decode(detailEnvelope())[0]!.value as {
      events: { participantA: string; participantB: string }[];
    };

    expect(combined.events).toEqual([
      expect.objectContaining({ participantA: "Alpha", participantB: "Beta" })
    ]);
  });

  it("uses hydrated detail identity when the BTI roster only labels sides as Home and Away", () => {
    const adapter = new BtiHttpCatalogAdapter();
    const placeholderRoster = JSON.stringify({ ...payload, serializedData: payload.serializedData.map((league) =>
      league.map((value, index) => index === 12 ? (value as unknown[]).map((rawEvent) => {
        const event = [...rawEvent as unknown[]];
        event[1] = [["h", { VI: "Home" }], ["a", { VI: "Away" }]];
        event[2] = "Home vs Away";
        return event;
      }) : value)) });
    committedCatalog(adapter, "bti:1000:1", 1, placeholderRoster);
    const hydrated = detailPayload() as { data: unknown[][] };
    hydrated.data[0]![8] = [["h", { VI: "Alpha" }, "Alpha"], ["a", { VI: "Beta" }, "Beta"]];

    const combined = adapter.decode(detailEnvelope(hydrated))[0]!.value as {
      events: { participantA: string; participantB: string }[];
    };

    expect(combined.events).toEqual([
      expect.objectContaining({ participantA: "Alpha", participantB: "Beta" })
    ]);
  });

  it("retains hidden detail markets across list generations while the event remains listed", () => {
    const adapter = new BtiHttpCatalogAdapter();
    committedCatalog(adapter, "bti:1000:1");
    const withDetail = adapter.decode(detailEnvelope())[0]!.value as { markets: { marketType: string }[] };
    expect(withDetail.markets.some(({ marketType }) => marketType === "FH_TOTAL")).toBe(true);

    const nextGeneration = committedCatalog(adapter, "bti:2000:1", 20) as {
      markets: { marketType: string }[];
    };
    expect(nextGeneration.markets.some(({ marketType }) => marketType === "FH_TOTAL")).toBe(true);
  });

  it("buffers event detail that arrives before its list generation commits", () => {
    const adapter = new BtiHttpCatalogAdapter();
    expect(adapter.decode(detailEnvelope(detailPayload(), envelope().observedAtMs, "bti:1000:1"))).toEqual([]);

    const committed = committedCatalog(adapter, "bti:1000:1", 20) as {
      markets: { marketType: string }[];
    };
    expect(committed.markets.some(({ marketType }) => marketType === "FH_TOTAL")).toBe(true);
  });

  it("publishes removal immediately when a valid event detail becomes empty", () => {
    const adapter = new BtiHttpCatalogAdapter();
    committedCatalog(adapter);
    adapter.decode(detailEnvelope());
    const removed = adapter.decode(detailEnvelope({ data: [] }, envelope().observedAtMs + 1));
    expect(removed).toHaveLength(1);
    expect((removed[0]!.value as { markets: Array<{ marketType: string }> }).markets
      .some(({ marketType }) => marketType === "FH_TOTAL")).toBe(false);
  });

  it("replaces a valid empty BTI list generation instead of retaining stale events", () => {
    const adapter = new BtiHttpCatalogAdapter();
    committedCatalog(adapter);
    const empty = committedCatalog(adapter, "bti:2000:1", 10,
      JSON.stringify({ serializedData: [] })) as {
      events: unknown[]; markets: unknown[]; quotes: unknown[] };
    expect(empty).toMatchObject({ events: [], markets: [], quotes: [] });
  });

  it("decodes the live football event-list response", () => {
    const adapter = new BtiHttpCatalogAdapter();
    expect(adapter.fingerprint(envelope())).toBe(true);
    const catalog = committedCatalog(adapter) as { events: unknown[]; markets: unknown[]; quotes: unknown[] };
    expect(catalog).toMatchObject({ accountId: "catalog-source:BTI:FOOTBALL", provider: "BTI" });
    expect(catalog.events).toHaveLength(1);
    expect(catalog.markets).toHaveLength(1);
    expect(catalog.quotes).toHaveLength(2);
  });

  it("accepts prematch event-list responses and retains live plus prematch catalogs", () => {
    const adapter = new BtiHttpCatalogAdapter();
    const prematchPayload = { serializedData: [["league-p", "Prematch League", 0, "", false, "", "", "", "", "", "1", "Football", [[
      "event-p", [["h", { VI: "Alpha" }], ["a", { VI: "Beta" }]], "Alpha vs Beta", "2026-08-19T00:15:00.000Z",
      ["", "", null, {}], false, false, [false, 0, null, null, null], ["event-p", 0, [], [[
        "hc-p", "Prematch", "Prematch", ["HC0", "full time", 1], "event-p", "league-p", "1",
        [selection("home-p", 1, -0.5, "0.82"), selection("away-p", 3, 0.5, "-0.92")]
      ]]]
    ]]]]} ;
    const prematchEnvelope = generationEnvelope("/api/eventlist/asia/leagues/v2/1/prematch/initial",
      "bti:1000:1", 4, JSON.stringify(prematchPayload));
    expect(adapter.fingerprint(prematchEnvelope)).toBe(true);
    for (const [index, path] of listPaths.slice(0, 3).entries()) {
      expect(adapter.decode(generationEnvelope(path, "bti:1000:1", index + 1))).toEqual([]);
    }
    const combined = adapter.decode(prematchEnvelope)[0]!.value as { events: { providerEventId: string; isLive: boolean }[] };
    expect(combined.events.map(({ providerEventId, isLive }) => [providerEventId, isLive])).toEqual([
      ["event", true], ["event-p", false]
    ]);
  });

  it("keeps market and quote identities isolated when BTI reuses ids across events", () => {
    const adapter = new BtiHttpCatalogAdapter();
    const reusedIds = { serializedData: [["league-p", "Prematch League", 0, "", false, "", "", "", "", "", "1", "Football", [[
      "event-p", [["h", { VI: "Alpha" }], ["a", { VI: "Beta" }]], "Alpha vs Beta", "2026-08-19T00:15:00.000Z",
      ["", "", null, {}], false, false, [false, 0, null, null, null], ["event-p", 0, [], [[
        "hc", "Prematch", "Prematch", ["HC0", "full time", 1], "event-p", "league-p", "1",
        [selection("home", 1, -0.5, "0.82"), selection("away", 3, 0.5, "-0.92")]
      ]]]
    ]]]]} ;
    let update: unknown;
    for (const [index, path] of listPaths.entries()) {
      const body = path.includes("prematch") ? JSON.stringify(reusedIds) : JSON.stringify(payload);
      const result = adapter.decode(generationEnvelope(path, "bti:1000:1", index + 1, body));
      if (result.length > 0) update = result[0]!.value;
    }
    const catalog = update as {
        events: unknown[]; markets: unknown[]; quotes: unknown[];
      };
    expect(catalog.events).toHaveLength(2);
    expect(catalog.markets).toHaveLength(2);
    expect(catalog.quotes).toHaveLength(4);
  });

  it("rejects unrelated paths and malformed bodies", () => {
    const adapter = new BtiHttpCatalogAdapter();
    expect(adapter.decode({ ...envelope(), request: { ...envelope().request, pathnameClass: "/api/profile" } })).toEqual([]);
    expect(adapter.decode(envelope("not-json"))).toEqual([]);
  });
});
