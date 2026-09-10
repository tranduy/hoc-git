import type { ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import { describe, expect, it } from "vitest";
import type { SabaCollectorDomItem } from "./saba-collector-dom.js";
import { ChromeCatalogDataPlane } from "./chrome-catalog-data-plane.js";
import { SabaWsCatalogAdapter } from "./saba-ws-adapter.js";

const SOURCE = "chrome:SABA:7";
const EPOCH = "worker-a:13";
const TARGET_EPOCH = "worker-a:14";
const FRAME = "sports-frame";
const DOCUMENT = "document-1";
const WALL = Date.UTC(2026, 8, 8, 10);
const WS_FIELDS = ["type", "leagueid", "leaguenameen", "sporttype", "matchid", "hteamnameen",
  "ateamnameen", "kickofftime", "marketid", "oddsid", "bettype", "parenttypeid", "oddsstatus",
  "enable", "odds1a", "odds2a", "hdp1", "hdp2", "cs10", "cs11", "cs20", "cs21"];

const encodedWsRow = (entry: Record<string, unknown>) => Object.entries(entry)
  .flatMap(([key, entryValue]) => [WS_FIELDS.indexOf(key), entryValue]);

function wsEnvelope(rows: readonly unknown[], revision: string, sequence: number,
  receivedMonotonicMs: number): ChromeBridgeEnvelope {
  return { version: 1, kind: "NETWORK", lobby: "SABA", sourceId: SOURCE, sourceEpoch: EPOCH, tabId: 7,
    sequence, observedAtMs: WALL + sequence * 1_000, receivedMonotonicMs, transport: "WS_FRAME",
    request: { hostname: "sports.example", pathnameClass: "/socket.io/",
      resourceType: "WebSocket", streamId: "1" },
    payload: { encoding: "UTF8", body: `42${JSON.stringify(["m", "b1", rows, revision])}` } };
}

const group = (marketOddsId: string, betTypeIds = ["1"], price = "0.91"): {
  betTypeIds: string[]; labels: string[]; odds: Array<{ marketOddsId: string; priceText: string;
    status: string | null; greyedOut: string | null; lineText?: string }>
} => ({
  betTypeIds, labels: [betTypeIds[0] === "3" ? "2.5" : "0.5"], odds: [
    { marketOddsId, priceText: price, status: null, greyedOut: null, lineText: "0.5" },
    { marketOddsId, priceText: "-0.93", status: null, greyedOut: null }
  ]
});

const record = (matchId: string, marketOddsId = `${matchId}-market`, price = "0.91",
  timeText = "09/08 08:00PM", groups = [group(marketOddsId, ["1"], price)]) => ({
    sportId: "1" as const, leagueId: "league-1", leagueName: "League", matchId, timeText,
    teamNames: [`${matchId} home`, `${matchId} away`], groups
  });

const capture = (generation: string, period: "TODAY" | "EARLY", ownerMatchId: string,
  captureOrdinal: number, capturedMonotonicMs: number,
  captureKind: "ROSTER" | "OWNER_GROUPS_EXPANDED" = "ROSTER",
  kickoffDate: { kind: "EXPLICIT"; isoDate: string } | { kind: "UNKNOWN" } =
    { kind: "EXPLICIT", isoDate: "2026-09-08" }, capturedRecord = record(ownerMatchId)):
SabaCollectorDomItem => ({ kind: "CAPTURE", collectorGeneration: generation, period, ownerMatchId,
  captureKind, kickoffDate, capturedAtMs: WALL + captureOrdinal, capturedMonotonicMs,
  captureOrdinal, record: capturedRecord });

function completeItems(generation: string, todayId = "today-1", earlyId = "early-1"):
SabaCollectorDomItem[] {
  const today = todayId === "" ? [] : [todayId];
  const early = earlyId === "" ? [] : [earlyId];
  const captures: SabaCollectorDomItem[] = [];
  let ordinal = 0;
  if (todayId !== "") captures.push(capture(generation, "TODAY", todayId, ordinal++, 10.5));
  if (earlyId !== "") captures.push(capture(generation, "EARLY", earlyId, ordinal++, 20.5));
  return [...captures,
    ...today.map((ownerMatchId) => ({ kind: "OWNER_COMPLETE" as const,
      collectorGeneration: generation, period: "TODAY" as const, ownerMatchId,
      safeControlOutcome: "NO_ELIGIBLE_CONTROL" as const, restored: true })),
    ...early.map((ownerMatchId) => ({ kind: "OWNER_COMPLETE" as const,
      collectorGeneration: generation, period: "EARLY" as const, ownerMatchId,
      safeControlOutcome: "NO_ELIGIBLE_CONTROL" as const, restored: true })),
    { kind: "PERIOD_COMPLETE", collectorGeneration: generation, period: "TODAY",
      rosterMatchIds: today, rosterCount: today.length },
    { kind: "PERIOD_COMPLETE", collectorGeneration: generation, period: "EARLY",
      rosterMatchIds: early, rosterCount: early.length },
    { kind: "TERMINAL", collectorGeneration: generation,
      periods: [{ period: "TODAY", rosterMatchIds: today, rosterCount: today.length },
        { period: "EARLY", rosterMatchIds: early, rosterCount: early.length }],
      owners: [...today.map((ownerMatchId) => ({ period: "TODAY" as const, ownerMatchId })),
        ...early.map((ownerMatchId) => ({ period: "EARLY" as const, ownerMatchId }))],
      todayRestoration: { selected: true, rosterMatchIds: today, rosterCount: today.length },
      unresolvedOwners: [], failedOwners: [] }
  ];
}

function domEnvelope(rawChunk: unknown, sequence = 1, sourceEpoch = EPOCH,
  receivedMonotonicMs = 1_000.5): ChromeBridgeEnvelope {
  return { version: 1, kind: "NETWORK", lobby: "SABA", sourceId: SOURCE, sourceEpoch, tabId: 7,
    sequence, observedAtMs: WALL + 1_000 + sequence, receivedMonotonicMs, transport: "DOM_SNAPSHOT",
    request: { hostname: "sports.example", pathnameClass: "/__fieldline_dom_snapshot__",
      resourceType: "DOM" }, payload: { encoding: "UTF8", body: JSON.stringify(rawChunk) } };
}

function collectorEnvelope(generation: string, items: readonly unknown[], sequence = 1,
  sourceEpoch = EPOCH): ChromeBridgeEnvelope {
  return domEnvelope({ schemaVersion: 2, snapshotId: `saba:collector:snapshot-${sequence}`,
    chunkIndex: 0, chunkCount: 1, sweepId: generation, sweepComplete: true,
    sweepFrameKey: FRAME, sweepDocumentKey: DOCUMENT, records: items }, sequence, sourceEpoch);
}

function mainItems(generation: string): SabaCollectorDomItem[] {
  const all = completeItems(generation);
  const terminal = all.at(-1)!;
  if (terminal.kind !== "TERMINAL") throw new Error("terminal fixture missing");
  const { unresolvedOwners: _unresolved, failedOwners: _failed, ...manifest } = terminal;
  return [...all.flatMap((item) => item.kind === "CAPTURE" && item.captureKind === "ROSTER" ?
    [{ ...item, record: { ...item.record, providerTimezoneOffsetMinutes: 480 } }] : []),
    { ...manifest, kind: "MAIN_ROSTER_TERMINAL", hiddenMarketsComplete: false }];
}

const value = (updates: readonly { value?: unknown }[]) => updates[0]?.value as {
  events: Array<{ providerEventId: string; isLive: boolean; startAtUtcMs: number }>;
  markets: Array<{ providerEventId: string; providerMarketId: string; line: string | null;
    status: string }>;
  quotes: Array<{ providerEventId: string; providerMarketId: string; rawOdds: string;
    receivedMonotonicMs: number; sequence: number | null }>;
  nativeMarketObservations: Array<{ providerEventId: string; providerMarketId: string;
    nativeType: string; disposition: string; reason: string; observedAtMs: number }>;
};

describe("SabaWsCatalogAdapter collector boundary", () => {
  it("withdraws an unavailable team-total OVER slot on the next accepted main roster", () => {
    const adapter = new SabaWsCatalogAdapter({ requireSocketBaseline: true });
    const roster = (generation: string, overPrice: string) => mainItems(generation).map(item => {
      if (item.kind !== "CAPTURE") return item;
      return { ...item, record: { ...item.record, groups: [{ betTypeIds: ["461"], labels: ["1.5", "u"],
        odds: [overPrice, "1.51"].map(priceText => ({ marketOddsId: `${item.ownerMatchId}-total`,
          priceText, status: null, greyedOut: "false" })) }] } };
    });
    const firstGeneration = "saba:collector:team-total-first";
    const first = value(adapter.decode(collectorEnvelope(firstGeneration, roster(firstGeneration, "2.38"), 1)));
    expect(first.quotes).toHaveLength(4);
    expect(first.quotes).toContainEqual(expect.objectContaining({ selection: "OVER", rawOdds: "2.38",
      rawFormat: "DECIMAL" }));
    const nextGeneration = "saba:collector:team-total-next";
    const next = value(adapter.decode(collectorEnvelope(nextGeneration, roster(nextGeneration, "0"), 2)));
    expect(next.quotes).toHaveLength(2);
    expect(next.quotes.every(quote => (quote as { selection?: string }).selection === "UNDER" &&
      quote.rawOdds === "1.51")).toBe(true);
    expect(next.nativeMarketObservations).toHaveLength(2);
  });

  it("authorizes validated main rosters before any More result and marks hidden completion separately", () => {
    const adapter = new SabaWsCatalogAdapter({ requireSocketBaseline: true });
    const generation = "saba:collector:main-authority:main";
    const initial = adapter.decode(collectorEnvelope(generation, mainItems(generation), 1));
    expect(initial).toEqual([expect.objectContaining({ evidenceMode: "BASELINE", authoritativeBaseline: true })]);
    expect(value(initial).events.map(({ providerEventId }) => providerEventId).sort()).toEqual(["early-1", "today-1"]);
    expect(adapter.collectorCoverage(SOURCE, EPOCH)).toMatchObject({ mainRosterComplete: true,
      hiddenMarketsComplete: false, collectorGeneration: generation });
    const failedHidden = completeItems("saba:collector:main-authority").filter((item) => item.kind !== "OWNER_COMPLETE");
    expect(adapter.decode(collectorEnvelope("saba:collector:main-authority", failedHidden, 2))).toEqual([]);
    const refreshed = adapter.decode(liveSnapshot(3));
    expect(value(refreshed).quotes.filter(({ providerEventId }) => providerEventId !== "9"))
      .toEqual(value(initial).quotes);
    expect(adapter.collectorCoverage(SOURCE, EPOCH)?.hiddenMarketsComplete).toBe(false);
    expect(adapter.decode(collectorEnvelope("saba:collector:main-authority",
      completeItems("saba:collector:main-authority"), 4))).toHaveLength(1);
    expect(adapter.collectorCoverage(SOURCE, EPOCH)?.hiddenMarketsComplete).toBe(true);
  });

  it.each([null, undefined])("rejects main timezone %s before changing prior authority or clocks", (offset) => {
    const adapter = new SabaWsCatalogAdapter({ requireSocketBaseline: true });
    const generation = "saba:collector:main-proven:main";
    const initial = adapter.decode(collectorEnvelope(generation, mainItems(generation), 1));
    const invalidGeneration = "saba:collector:main-unknown:main";
    const unknown = mainItems(invalidGeneration).map((item) => item.kind !== "CAPTURE" ? item : {
      ...item, record: { ...item.record, providerTimezoneOffsetMinutes: offset }
    });
    expect(adapter.decode(collectorEnvelope(invalidGeneration, unknown, 2))).toEqual([]);
    expect(adapter.collectorCoverage(SOURCE, EPOCH)?.collectorGeneration).toBe(generation);
    expect(value(adapter.decode(liveSnapshot(3))).quotes.filter(({ providerEventId }) => providerEventId !== "9"))
      .toEqual(value(initial).quotes);
    adapter.resetSource(SOURCE);
    expect(adapter.collectorCoverage(SOURCE, EPOCH)).toBeNull();
  });

  it("publishes a production main baseline with original clocks while More is incomplete and requires new epoch proof", async () => {
    const plane = new ChromeCatalogDataPlane({ now: () => WALL + 10_000, monotonicNow: () => 10_000 });
    const generation = "saba:collector:production-main:main";
    expect(plane.ingest(collectorEnvelope(generation, mainItems(generation), 1))).toBe(true);
    const initial = await plane.read("catalog-source:SABA:FOOTBALL");
    expect(initial.events).toHaveLength(2);
    expect(plane.ingest(liveSnapshot(2))).toBe(true);
    const updated = await plane.read("catalog-source:SABA:FOOTBALL");
    expect(updated.quotes.filter(({ providerEventId }) => providerEventId !== "9")).toEqual(initial.quotes);
    expect(plane.ingest({ ...liveSnapshot(3), sourceEpoch: TARGET_EPOCH })).toBe(true);
    const replacement = await plane.read("catalog-source:SABA:FOOTBALL");
    expect(replacement.events.map(({ providerEventId }) => providerEventId)).toEqual(["9"]);
    expect(replacement.quotes.every(({ providerEventId }) => providerEventId === "9")).toBe(true);
  });

  it.each([420, 480])("uses public timezone %i through the complete collector and keeps acquisition clocks", (offset) => {
    const adapter = new SabaWsCatalogAdapter({ requireSocketBaseline: true });
    const generation = `saba:collector:timezone-${offset}`;
    const items = completeItems(generation).map((item) => item.kind !== "CAPTURE" ? item : {
      ...item, record: { ...item.record, providerTimezoneOffsetMinutes: offset }
    });
    const catalog = value(adapter.decode(collectorEnvelope(generation, items)));
    expect(catalog.events.find(({ providerEventId }) => providerEventId === "today-1")?.startAtUtcMs)
      .toBe(Date.UTC(2026, 8, 8, 20) - offset * 60_000);
    expect(catalog.quotes.find(({ providerEventId }) => providerEventId === "today-1"))
      .toMatchObject({ receivedMonotonicMs: 10.5, sequence: 0 });
  });

  it.each([420, 480])("retains public timezone %i through the visible DOM decoder", (offset) => {
    const records = Array.from({ length: 50 }, (_, index) => ({ ...record(String(index + 2)),
      providerTimezoneOffsetMinutes: offset }));
    const catalog = value(new SabaWsCatalogAdapter().decode(domEnvelope({ schemaVersion: 2,
      snapshotId: "saba:7:timezone-visible", chunkIndex: 0, chunkCount: 1, records })));
    expect(catalog.events[0]?.startAtUtcMs).toBe(Date.UTC(2026, 8, 8, 20) - offset * 60_000);
  });

  it("refuses a complete collector with explicitly unproven timezone while retaining the prior full catalog", () => {
    const adapter = new SabaWsCatalogAdapter({ requireSocketBaseline: true });
    const priorGeneration = "saba:collector:proven-timezone";
    const before = value(adapter.decode(collectorEnvelope(priorGeneration, completeItems(priorGeneration))));
    const nextGeneration = "saba:collector:unproven-timezone";
    const unknown = completeItems(nextGeneration).map((item) => item.kind !== "CAPTURE" ? item : {
      ...item, record: { ...item.record, providerTimezoneOffsetMinutes: null }
    });
    expect(adapter.decode(collectorEnvelope(nextGeneration, unknown, 2))).toEqual([]);
    expect(adapter.takeIgnoreReason()).toBe("collector-timezone-unproven");
    const after = value(adapter.decode(liveSnapshot(3)));
    expect(after.quotes.filter(({ providerEventId }) => providerEventId !== "9")).toEqual(before.quotes);
  });
  const liveSnapshot = (sequence: number) => wsEnvelope([["f", 0, WS_FIELDS], [0, "reset"],
    encodedWsRow({ type: "l", leagueid: 1, leaguenameen: "League", sporttype: 1 }),
    encodedWsRow({ type: "m", matchid: 9, leagueid: 1, hteamnameen: "Live home",
      ateamnameen: "Live away", kickofftime: WALL / 1_000, marketid: "L", sporttype: 1 }),
    encodedWsRow({ type: "o", oddsid: 90, matchid: 9, bettype: 1, parenttypeid: 1,
      oddsstatus: "running", enable: 1, odds1a: 0.91, odds2a: -0.97, hdp1: 0.5, hdp2: 0 }),
    [0, "done"]], `strict-${sequence}`, sequence, 100 + sequence);

  it("publishes a validated socket partition while collector coverage is still incomplete", () => {
    const adapter = new SabaWsCatalogAdapter({ requireSocketBaseline: true });
    const native = adapter.decode(liveSnapshot(1));
    expect(native).toEqual([expect.objectContaining({ authoritativeBaseline: true,
      evidenceMode: "BASELINE", provenance: "WS" })]);
    expect(value(native).events.map(({ providerEventId }) => providerEventId)).toEqual(["9"]);
    expect(adapter.collectorCoverage(SOURCE, EPOCH)).toBeNull();
    const generation = "saba:collector:strict-complete";
    const items = completeItems(generation);
    expect(adapter.decode(collectorEnvelope(generation, items.slice(0, -1), 2))).toEqual([]);
    const updates = adapter.decode(collectorEnvelope(generation, items, 3));
    expect(updates).toEqual([expect.objectContaining({ authoritativeBaseline: true,
      evidenceMode: "BASELINE", generation })]);
    expect(value(updates).events.map(({ providerEventId }) => providerEventId).sort())
      .toEqual(["9", "early-1", "today-1"]);
  });

  it("authorizes a complete production collector without socket or large viewport and retains capture clocks", () => {
    const adapter = new SabaWsCatalogAdapter({ requireSocketBaseline: true });
    const generation = "saba:collector:strict-independent";
    const initial = adapter.decode(collectorEnvelope(generation, completeItems(generation), 1));
    expect(initial).toEqual([expect.objectContaining({ authoritativeBaseline: true,
      evidenceMode: "BASELINE", generation })]);
    const updated = adapter.decode(domEnvelope({ schemaVersion: 2, snapshotId: "strict-small-dom",
      chunkIndex: 0, chunkCount: 1, records: [record("today-1")] }, 2, EPOCH, 2_000));
    expect(updated).toEqual([expect.objectContaining({ evidenceMode: "DELTA", generation })]);
    expect(updated[0]).not.toHaveProperty("authoritativeBaseline", true);
    expect(value(updated).quotes.filter(({ providerEventId }) => providerEventId === "early-1"))
      .toEqual(value(initial).quotes.filter(({ providerEventId }) => providerEventId === "early-1"));
  });

  it("keeps a completed prematch collector when one production socket partition becomes empty", () => {
    const adapter = new SabaWsCatalogAdapter({ requireSocketBaseline: true });
    const generation = "saba:collector:strict-empty-partition";
    const initial = adapter.decode(collectorEnvelope(generation, completeItems(generation), 1));
    const socket = adapter.decode(liveSnapshot(2));
    expect(socket).toEqual([expect.objectContaining({ evidenceMode: "BASELINE",
      authoritativeBaseline: true, generation: `${EPOCH}:saba:1:2` })]);
    const emptied = adapter.decode(wsEnvelope([[0, "empty"], [0, "done"]], "strict-empty", 3, 103));
    expect(emptied).toEqual([expect.objectContaining({ evidenceMode: "BASELINE",
      authoritativeBaseline: true, generation: `${EPOCH}:saba:1:3` })]);
    expect(value(emptied).events.map(({ providerEventId }) => providerEventId).sort())
      .toEqual(["early-1", "today-1"]);
    expect(value(emptied).quotes).toEqual(value(initial).quotes);
  });

  it("accepts a newly validated socket snapshot after collector expiry without reviving old collector quotes", () => {
    const adapter = new SabaWsCatalogAdapter({ requireSocketBaseline: true });
    const generation = "saba:collector:strict-expiry";
    expect(adapter.decode(collectorEnvelope(generation, completeItems(generation), 1))).toHaveLength(1);
    const updated = adapter.decode({ ...liveSnapshot(2), observedAtMs: WALL + 3_601_002 });
    expect(value(updated).events.map(({ providerEventId }) => providerEventId)).toEqual(["9"]);
    expect(adapter.collectorCoverage(SOURCE, EPOCH)).toBeNull();
    adapter.resetSource(SOURCE);
    expect(adapter.decode(liveSnapshot(3))).toEqual([expect.objectContaining({
      evidenceMode: "BASELINE", provenance: "WS" })]);
  });

  it("requires native reset/done before production publication and then accepts fresh price deltas", async () => {
    const plane = new ChromeCatalogDataPlane({ now: () => WALL + 10_000, monotonicNow: () => 10_000 });
    const premature = wsEnvelope([["f", 0, WS_FIELDS],
      encodedWsRow({ type: "o", oddsid: 90, matchid: 9, odds1a: 0.8 })], "premature", 1, 101);
    expect(plane.ingest(premature)).toBe(false);
    expect(plane.ingest(liveSnapshot(2))).toBe(true);
    const before = await plane.read("catalog-source:SABA:FOOTBALL");
    expect(before.events.map(({ providerEventId }) => providerEventId)).toEqual(["9"]);
    const delta = wsEnvelope([encodedWsRow({ type: "o", oddsid: 90, matchid: 9,
      odds1a: 0.82, odds2a: -0.94 })], "native-delta", 3, 103);
    expect(plane.ingest(delta)).toBe(true);
    expect((await plane.read("catalog-source:SABA:FOOTBALL")).quotes)
      .toEqual(expect.arrayContaining([expect.objectContaining({ rawOdds: "0.82" })]));
  });

  it("restores same-epoch socket authority from retained complete periods without another collector or renewed quote clocks", async () => {
    const plane = new ChromeCatalogDataPlane({ now: () => WALL + 10_000, monotonicNow: () => 10_000 });
    const generation = "saba:collector:socket-reconnect";
    expect(plane.ingest(collectorEnvelope(generation, completeItems(generation), 1))).toBe(true);
    const original = await plane.read("catalog-source:SABA:FOOTBALL");
    expect(plane.ingest(liveSnapshot(2))).toBe(true);
    const state = (status: "OPEN" | "CLOSED", sequence: number, streamId: string): ChromeBridgeEnvelope => ({
      ...wsEnvelope([], "state", sequence, 100 + sequence), transport: "WS_STATE",
      request: { ...wsEnvelope([], "state", sequence, 100 + sequence).request, streamId },
      payload: { encoding: "UTF8", body: JSON.stringify({ state: status }) }
    });
    expect(plane.ingest(state("CLOSED", 3, "1"))).toBe(true);
    await expect(plane.read("catalog-source:SABA:FOOTBALL")).rejects.toThrow("PROVIDER_FEED_NOT_LIVE");
    expect(plane.ingest(state("OPEN", 4, "2"))).toBe(false);
    const replacement = liveSnapshot(5);
    expect(plane.ingest({ ...replacement, request: { ...replacement.request, streamId: "2" } })).toBe(true);
    const restored = await plane.read("catalog-source:SABA:FOOTBALL");
    expect(restored.events.map(({ providerEventId }) => providerEventId).sort())
      .toEqual(["9", "early-1", "today-1"]);
    expect(restored.quotes.filter(({ providerEventId }) => providerEventId !== "9")).toEqual(original.quotes);
    const delta = wsEnvelope([encodedWsRow({ type: "o", oddsid: 90, matchid: 9,
      odds1a: 0.72, odds2a: -0.82 })], "strict-6", 6, 106);
    expect(plane.ingest({ ...delta, request: { ...delta.request, streamId: "2" } })).toBe(true);
    expect((await plane.read("catalog-source:SABA:FOOTBALL")).quotes
      .filter(({ providerEventId }) => providerEventId !== "9")).toEqual(original.quotes);
  });

  it("accepts validated empty periods and then admits socket deltas through the production data plane", async () => {
    const plane = new ChromeCatalogDataPlane({ now: () => WALL + 3_000,
      monotonicNow: () => 3_000 });
    const generation = "saba:collector:strict-empty-periods";
    const complete = collectorEnvelope(generation, completeItems(generation, "", ""), 1);
    expect(plane.ingest(complete)).toBe(true);
    expect((await plane.read("catalog-source:SABA:FOOTBALL")).events).toHaveLength(0);
    expect(plane.ingest(liveSnapshot(2))).toBe(true);
    expect((await plane.read("catalog-source:SABA:FOOTBALL")).events).toHaveLength(1);
  });

  it("publishes one atomic terminal candidate with capture clocks and expanded detail", () => {
    const generation = "saba:collector:generation-detail";
    const items = completeItems(generation, "today-detail", "");
    items.splice(1, 0, capture(generation, "TODAY", "today-detail", 1, 12.75,
      "OWNER_GROUPS_EXPANDED", { kind: "EXPLICIT", isoDate: "2026-09-08" },
      record("today-detail", "detail-total", "0.88", "09/08 08:00PM", [
        group("today-detail-market"), group("detail-total", ["3"], "0.88")
      ])));
    const owner = items.find((item) => item.kind === "OWNER_COMPLETE")!;
    items[items.indexOf(owner)] = { ...owner, safeControlOutcome: "OWNER_GROUPS_EXPANDED" };
    const adapter = new SabaWsCatalogAdapter();

    const catalog = value(adapter.decode(collectorEnvelope(generation, items)));

    expect(catalog.markets).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerEventId: "today-detail", providerMarketId: "detail-total" })
    ]));
    expect(catalog.quotes.filter(({ providerMarketId }) => providerMarketId === "detail-total"))
      .toEqual(expect.arrayContaining([expect.objectContaining({ rawOdds: "0.88",
        receivedMonotonicMs: 12.75, sequence: 1 })]));
  });

  it("never falls a partial or malformed collector generation through to legacy DOM authority", () => {
    const adapter = new SabaWsCatalogAdapter();
    const records = Array.from({ length: 50 }, (_, index) => record(`legacy-${index}`));
    const malformed = { schemaVersion: 2, snapshotId: "saba:collector:malformed",
      chunkIndex: 0, chunkCount: 1, sweepId: "saba:collector:malformed",
      sweepComplete: true, sweepFrameKey: FRAME, sweepDocumentKey: DOCUMENT, records };

    expect(adapter.decode(domEnvelope(malformed))).toEqual([]);
    expect(adapter.takeIgnoreReason()).toMatch(/^collector-/u);
  });

  it("does not mutate qualified DOM state for a terminal collector without markets", () => {
    const adapter = new SabaWsCatalogAdapter();
    const legacyRecords = Array.from({ length: 50 }, (_, index) => record(`legacy-${index}`));
    const legacyChunk = (sequence: number) => domEnvelope({ schemaVersion: 2,
      snapshotId: `saba:7:atomic-legacy-${sequence}`, chunkIndex: 0, chunkCount: 1,
      records: legacyRecords }, sequence, EPOCH, 1_000.5 + sequence);
    expect(value(adapter.decode(legacyChunk(1))).events).toHaveLength(50);
    const generation = "saba:collector:marketless-terminal";
    const items = completeItems(generation, "marketless-disjoint", "");
    const roster = items.find((item) => item.kind === "CAPTURE")!;
    if (roster.kind === "CAPTURE") {
      items[items.indexOf(roster)] = { ...roster,
        record: record("marketless-disjoint", "unused", "0.91", "09/08 08:00PM", []) };
    }

    expect(adapter.decode(collectorEnvelope(generation, items, 2))).toEqual([]);
    expect(adapter.takeIgnoreReason()).toBe("incomplete-normalized-catalog");
    const retained = adapter.decode(legacyChunk(3));

    expect(retained).toHaveLength(1);
    expect(retained[0]).toMatchObject({ authoritativeBaseline: true, evidenceMode: "BASELINE" });
    expect(value(retained).events).toHaveLength(50);
    expect(value(retained).events.map(({ providerEventId }) => providerEventId))
      .not.toContain("marketless-disjoint");
  });

  it("keeps collector hidden markets after a later legacy refresh and uses only the newer quote clock", () => {
    const generation = "saba:collector:legacy-refresh";
    const adapter = new SabaWsCatalogAdapter();
    const initial = value(adapter.decode(collectorEnvelope(generation,
      completeItems(generation, "overlap", "hidden-early"))));
    expect(initial.events.map(({ providerEventId }) => providerEventId)).toContain("hidden-early");
    const pendingGeneration = "saba:collector:pending-replacement";
    const pendingItems = completeItems(pendingGeneration, "replacement", "");
    expect(adapter.decode(domEnvelope({ schemaVersion: 2, snapshotId: "saba:collector:pending-1",
      chunkIndex: 0, chunkCount: 2, sweepId: pendingGeneration, sweepComplete: true,
      sweepFrameKey: FRAME, sweepDocumentKey: DOCUMENT,
      records: pendingItems.slice(0, 2) }, 2))).toEqual([]);
    const records = [record("overlap", "overlap-market", "0.77", "09/08 08:00PM"),
      ...Array.from({ length: 49 }, (_, index) =>
        record(`visible-${index}`, `visible-market-${index}`, "0.80", "09/08 08:00PM"))];
    const legacy = domEnvelope({ schemaVersion: 2, snapshotId: "legacy-refresh-1",
      chunkIndex: 0, chunkCount: 1, records }, 3, EPOCH, 2_000.5);

    const refreshed = value(adapter.decode(legacy));

    expect(refreshed.events.map(({ providerEventId }) => providerEventId)).toContain("hidden-early");
    expect(refreshed.events.map(({ providerEventId }) => providerEventId)).not.toContain("visible-0");
    expect(refreshed.quotes.filter(({ providerEventId }) => providerEventId === "overlap"))
      .toEqual(expect.arrayContaining([expect.objectContaining({ rawOdds: "0.77",
        receivedMonotonicMs: 2_000.5 })]));
    expect(refreshed.quotes.filter(({ providerEventId }) => providerEventId === "overlap")
      .every(({ receivedMonotonicMs }) => receivedMonotonicMs === 2_000.5)).toBe(true);
  });

  it("does not let an older collector capture overwrite a newer qualified DOM quote", () => {
    const adapter = new SabaWsCatalogAdapter();
    const records = [record("overlap", "overlap-market", "0.77", "09/09 08:00PM"),
      ...Array.from({ length: 49 }, (_, index) => record(`prior-${index}`))];
    const legacy = domEnvelope({ schemaVersion: 2, snapshotId: "legacy-before-collector",
      chunkIndex: 0, chunkCount: 1, records }, 1, EPOCH, 2_000.5);
    expect(adapter.decode(legacy)).toHaveLength(1);
    const generation = "saba:collector:older-than-dom";

    const catalog = value(adapter.decode(collectorEnvelope(generation,
      completeItems(generation, "overlap", "hidden"), 2)));

    expect(catalog.events.map(({ providerEventId }) => providerEventId)).not.toContain("prior-0");
    expect(catalog.events.map(({ providerEventId }) => providerEventId)).toContain("hidden");
    expect(catalog.events.find(({ providerEventId }) => providerEventId === "overlap")?.startAtUtcMs)
      .toBe(Date.UTC(2026, 8, 8, 12));
    expect(catalog.quotes.filter(({ providerEventId }) => providerEventId === "overlap"))
      .toEqual(expect.arrayContaining([expect.objectContaining({ rawOdds: "0.77",
        receivedMonotonicMs: 2_000.5 })]));
  });

  it("keeps market and native metadata with the partition owning the newest quote clock", () => {
    const adapter = new SabaWsCatalogAdapter();
    const generation = "saba:collector:newer-than-late-dom";
    const collector = completeItems(generation, "overlap", "");
    expect(adapter.decode(collectorEnvelope(generation, collector))).toHaveLength(1);
    const staleGroup = { betTypeIds: ["1"], labels: ["1.5"], odds: [
      { marketOddsId: "overlap-market", priceText: "0.71", status: null,
        greyedOut: "true", lineText: "1.5" },
      { marketOddsId: "overlap-market", priceText: "-0.93", status: null,
        greyedOut: "true" }
    ] };
    const records = [record("overlap", "overlap-market", "0.71", "09/08 08:00PM", [staleGroup]),
      ...Array.from({ length: 49 }, (_, index) => record(`stale-${index}`))];
    const legacy = domEnvelope({ schemaVersion: 2, snapshotId: "saba:7:late-stale-metadata",
      chunkIndex: 0, chunkCount: 1, records }, 2, EPOCH, 5.5);

    const updates = adapter.decode(legacy);
    expect(updates, adapter.takeIgnoreReason() ?? undefined).toHaveLength(1);
    const catalog = value(updates);

    expect(catalog.quotes.filter(({ providerEventId }) => providerEventId === "overlap"))
      .toEqual(expect.arrayContaining([expect.objectContaining({ rawOdds: "0.91",
        receivedMonotonicMs: 10.5 })]));
    expect(catalog.markets.find(({ providerEventId }) => providerEventId === "overlap"))
      .toMatchObject({ line: "-0.5", status: "OPEN" });
    expect(catalog.nativeMarketObservations.filter(({ providerEventId }) => providerEventId === "overlap"))
      .toEqual([expect.objectContaining({ disposition: "NORMALIZED", observedAtMs: WALL })]);
  });

  it("retains unknown-date native inventory without guessing an undated kickoff", () => {
    const generation = "saba:collector:unknown-date";
    const items = completeItems(generation, "known", "unknown");
    const unknownCapture = items.find((item) => item.kind === "CAPTURE" &&
      item.ownerMatchId === "unknown")!;
    if (unknownCapture.kind === "CAPTURE") {
      items[items.indexOf(unknownCapture)] = { ...unknownCapture, kickoffDate: { kind: "UNKNOWN" },
        record: record("unknown", "unknown-native", "0.91", "01:45AM", [group("unknown-native", ["999"])]) };
    }

    const catalog = value(new SabaWsCatalogAdapter().decode(collectorEnvelope(generation, items)));

    expect(catalog.events.map(({ providerEventId }) => providerEventId)).not.toContain("unknown");
    expect(catalog.nativeMarketObservations).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerEventId: "unknown", disposition: "EXCLUDED",
        reason: "EVENT_NOT_COMPARABLE" })
    ]));
  });

  it("publishes excluded-only native inventory without claiming a canonical provider baseline", () => {
    const generation = "saba:collector:excluded-only";
    const items = completeItems(generation, "unknown-only", "");
    const unknownCapture = items.find((item) => item.kind === "CAPTURE")!;
    if (unknownCapture.kind === "CAPTURE") {
      items[items.indexOf(unknownCapture)] = { ...unknownCapture, kickoffDate: { kind: "UNKNOWN" },
        record: record("unknown-only", "unknown-only-market", "0.91", "01:45AM",
          [group("unknown-only-market", ["999"])]) };
    }

    const updates = new SabaWsCatalogAdapter().decode(collectorEnvelope(generation, items));
    const catalog = value(updates);

    expect(updates[0]).toMatchObject({ evidenceMode: "DELTA" });
    expect(updates[0]).not.toHaveProperty("authoritativeBaseline");
    expect(catalog).toMatchObject({ events: [], markets: [], quotes: [] });
    expect(catalog.nativeMarketObservations).toEqual([
      expect.objectContaining({ providerEventId: "unknown-only", disposition: "EXCLUDED",
        reason: "EVENT_NOT_COMPARABLE" })
    ]);
  });

  it("retains collector UNKNOWN inventory across an omitting WS reset then accepts its newer WS quote", () => {
    const generation = "saba:collector:ws-omission-retention";
    const items = completeItems(generation, "2", "");
    const hiddenCapture = items.find((item) => item.kind === "CAPTURE")!;
    if (hiddenCapture.kind === "CAPTURE") {
      items[items.indexOf(hiddenCapture)] = { ...hiddenCapture,
        record: record("2", "2__4", "0.88", "09/08 08:00PM",
          [group("2__4", ["3"], "0.88"), group("2__3", [], "0.81")]) };
    }
    const rawRecord = items.find((item) => item.kind === "CAPTURE")!;
    const adapter = new SabaWsCatalogAdapter();

    const collectorUpdates = adapter.decode(collectorEnvelope(generation, items));
    expect(collectorUpdates, adapter.takeIgnoreReason() ?? undefined).toHaveLength(1);
    const collector = value(collectorUpdates);
    expect(collector.nativeMarketObservations).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerEventId: "2", providerMarketId: "3", nativeType: "UNKNOWN",
        disposition: "EXCLUDED", reason: "AMBIGUOUS_NATIVE_TYPE" })
    ]));
    expect(rawRecord.kind === "CAPTURE" && rawRecord.record.groups[1]?.odds[0]?.marketOddsId)
      .toBe("2__3");

    const resetWithoutHiddenMarket = [["f", 0, WS_FIELDS], [0, "reset"],
      encodedWsRow({ type: "l", leagueid: 1, leaguenameen: "League", sporttype: 1 }),
      encodedWsRow({ type: "m", matchid: 2, leagueid: 1, hteamnameen: "2 home", ateamnameen: "2 away",
        kickofftime: WALL / 1_000, marketid: "L", sporttype: 1 }),
      encodedWsRow({ type: "o", oddsid: 4, matchid: 2, bettype: 3, parenttypeid: 3,
        oddsstatus: "running", enable: 1, odds1a: 0.88, odds2a: -0.94, hdp1: 2.5, hdp2: 0 }),
      [0, "done"]];
    const afterOmission = value(adapter.decode(wsEnvelope(resetWithoutHiddenMarket, "reset-1", 2, 30)));
    expect(afterOmission.nativeMarketObservations).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerEventId: "2", providerMarketId: "3", nativeType: "UNKNOWN",
        disposition: "EXCLUDED", reason: "AMBIGUOUS_NATIVE_TYPE" })
    ]));
    expect(afterOmission.markets).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerEventId: "2", providerMarketId: "4" })
    ]));

    const hiddenMarketUpdate = [encodedWsRow({ type: "o", oddsid: 3, matchid: 2, bettype: 1,
      parenttypeid: 1, oddsstatus: "running", enable: 1, odds1a: 0.72, odds2a: -0.82,
      hdp1: 0.5, hdp2: 0 })];
    const updated = value(adapter.decode(wsEnvelope(hiddenMarketUpdate, "delta-2", 3, 40)));

    expect(updated.quotes.filter(({ providerMarketId }) => providerMarketId === "3"))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ rawOdds: "0.72", receivedMonotonicMs: 40, sequence: 3 }),
        expect.objectContaining({ rawOdds: "-0.82", receivedMonotonicMs: 40, sequence: 3 })
      ]));
    expect(updated.nativeMarketObservations.filter(({ providerMarketId }) => providerMarketId === "3"))
      .toEqual([expect.objectContaining({ disposition: "NORMALIZED", observedAtMs: WALL + 3_000 })]);
    expect(updated.markets.some(({ providerMarketId }) => providerMarketId === "2__3")).toBe(false);
  });

  it("keeps seeded collector retention out of WS output until fresh DOM qualifies it", () => {
    const generation = "saba:collector:pending-cross-epoch";
    const items = completeItems(generation, "2", "");
    const roster = items.find((item) => item.kind === "CAPTURE")!;
    if (roster.kind === "CAPTURE") {
      items[items.indexOf(roster)] = { ...roster,
        record: record("2", "2__4", "0.88", "09/08 08:00PM",
          [group("2__4", ["3"], "0.88"), group("2__3", [], "0.81")]) };
    }
    const previous = new SabaWsCatalogAdapter();
    expect(previous.decode(collectorEnvelope(generation, items))).toHaveLength(1);
    const replacement = new SabaWsCatalogAdapter();
    expect(replacement.seedPendingCollectorRetentionFrom(
      previous, SOURCE, EPOCH, TARGET_EPOCH, WALL + 1_002)).toBe(true);

    const rows = [["f", 0, WS_FIELDS], [0, "reset"],
      encodedWsRow({ type: "l", leagueid: 1, leaguenameen: "League", sporttype: 1 }),
      encodedWsRow({ type: "m", matchid: 2, leagueid: 1, hteamnameen: "2 home",
        ateamnameen: "2 away", kickofftime: WALL / 1_000, marketid: "L", sporttype: 1 }),
      encodedWsRow({ type: "o", oddsid: 4, matchid: 2, bettype: 3, parenttypeid: 3,
        oddsstatus: "running", enable: 1, odds1a: 0.72, odds2a: -0.82, hdp1: 2.5, hdp2: 0 }),
      encodedWsRow({ type: "m", matchid: 9, leagueid: 1, hteamnameen: "Live home",
        ateamnameen: "Live away", kickofftime: WALL / 1_000, marketid: "L", sporttype: 1 }),
      encodedWsRow({ type: "o", oddsid: 90, matchid: 9, bettype: 1, parenttypeid: 1,
        oddsstatus: "running", enable: 1, odds1a: 0.91, odds2a: -0.97, hdp1: 0.5, hdp2: 0 }),
      [0, "done"]];
    const preDomEnvelope = { ...wsEnvelope(rows, "target-reset", 2, 40),
      sourceEpoch: TARGET_EPOCH, observedAtMs: WALL + 1_003 };
    const preDom = value(replacement.decode(preDomEnvelope));
    expect(preDom.nativeMarketObservations.some(({ providerMarketId }) => providerMarketId === "3"))
      .toBe(false);

    const domRecords = [record("2", "2__4", "0.77"),
      ...Array.from({ length: 49 }, (_, index) => record("visible-" + index))];
    const qualified = value(replacement.decode(domEnvelope({ schemaVersion: 2,
      snapshotId: "qualified-target-dom", chunkIndex: 0, chunkCount: 1, records: domRecords },
    3, TARGET_EPOCH, 50)));

    expect(qualified.nativeMarketObservations).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerEventId: "2", providerMarketId: "3",
        nativeType: "UNKNOWN", observedAtMs: WALL })
    ]));
    expect(qualified.quotes.filter(({ providerMarketId }) => providerMarketId === "4"))
      .toEqual(expect.arrayContaining([expect.objectContaining({
        rawOdds: "0.72", receivedMonotonicMs: 40, sequence: 2
      })]));
    expect(qualified.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerEventId: "9", isLive: true })
    ]));
  });

  it("publishes a disjoint retained collector after an independently qualified DOM baseline", () => {
    const generation = "saba:collector:pending-disjoint";
    const previous = new SabaWsCatalogAdapter();
    expect(previous.decode(collectorEnvelope(generation,
      completeItems(generation, "retained-today", "retained-early")))).toHaveLength(1);
    const replacement = new SabaWsCatalogAdapter();
    expect(replacement.seedPendingCollectorRetentionFrom(
      previous, SOURCE, EPOCH, TARGET_EPOCH, WALL + 2_000)).toBe(true);
    const legacy = Array.from({ length: 50 }, (_, index) => record("legacy-" + index));

    const updates = replacement.decode(domEnvelope({ schemaVersion: 2,
      snapshotId: "saba:7:disjoint-qualified", chunkIndex: 0, chunkCount: 1, records: legacy },
    3, TARGET_EPOCH, 50));

    expect(updates).toHaveLength(1);
    expect(value(updates).events.map(({ providerEventId }) => providerEventId).sort())
      .toEqual(["retained-early", "retained-today"]);
    expect(value(updates).events.some(({ providerEventId }) => providerEventId.startsWith("legacy-")))
      .toBe(false);
  });

  it("does not activate disjoint retention from a raw DOM catalog with no normalized markets", () => {
    const generation = "saba:collector:pending-disjoint-unmapped";
    const previous = new SabaWsCatalogAdapter();
    expect(previous.decode(collectorEnvelope(generation,
      completeItems(generation, "retained-today", "")))).toHaveLength(1);
    const replacement = new SabaWsCatalogAdapter();
    expect(replacement.seedPendingCollectorRetentionFrom(
      previous, SOURCE, EPOCH, TARGET_EPOCH, WALL + 2_000)).toBe(true);
    const unmapped = Array.from({ length: 50 }, (_, index) => record("unmapped-" + index,
      "unmapped-" + index + "__unknown", "0.91", "09/08 08:00PM",
      [group("unmapped-" + index + "__unknown", [], "0.91")]));

    expect(replacement.decode(domEnvelope({ schemaVersion: 2,
      snapshotId: "saba:7:disjoint-unmapped", chunkIndex: 0, chunkCount: 1, records: unmapped },
    3, TARGET_EPOCH, 50))).toEqual([]);

    const mapped = Array.from({ length: 50 }, (_, index) => record("unmapped-" + index));
    const updates = replacement.decode(domEnvelope({ schemaVersion: 2,
      snapshotId: "saba:7:disjoint-mapped", chunkIndex: 0, chunkCount: 1, records: mapped },
    4, TARGET_EPOCH, 60));
    expect(value(updates).events.map(({ providerEventId }) => providerEventId))
      .toContain("retained-today");
  });

  it("lets a fresh target collector replace activated pending retention", () => {
    const oldGeneration = "saba:collector:pending-old";
    const previous = new SabaWsCatalogAdapter();
    expect(previous.decode(collectorEnvelope(oldGeneration,
      completeItems(oldGeneration, "old-today", "old-early")))).toHaveLength(1);
    const replacement = new SabaWsCatalogAdapter();
    expect(replacement.seedPendingCollectorRetentionFrom(
      previous, SOURCE, EPOCH, TARGET_EPOCH, WALL + 1_002)).toBe(true);
    const targetDom = [record("old-today"),
      ...Array.from({ length: 49 }, (_, index) => record("target-visible-" + index))];
    expect(replacement.decode(domEnvelope({ schemaVersion: 2, snapshotId: "saba:7:activate-old",
      chunkIndex: 0, chunkCount: 1, records: targetDom }, 3, TARGET_EPOCH, 50))).toHaveLength(1);
    const newGeneration = "saba:collector:pending-new";

    const catalog = value(replacement.decode(collectorEnvelope(newGeneration,
      completeItems(newGeneration, "new-today", ""), 4, TARGET_EPOCH)));

    expect(catalog.events.map(({ providerEventId }) => providerEventId)).toEqual(["new-today"]);
  });

  it("preserves original retention age and validates the source epoch clock domain", () => {
    const generation = "saba:collector:pending-age";
    const previous = new SabaWsCatalogAdapter();
    expect(previous.decode(collectorEnvelope(generation, completeItems(generation)))).toHaveLength(1);
    const originalObservedAtMs = WALL + 1_001;

    const sameEpoch = new SabaWsCatalogAdapter();
    expect(sameEpoch.seedPendingCollectorRetentionFrom(
      previous, SOURCE, EPOCH, EPOCH, originalObservedAtMs + 1)).toBe(true);
    expect(sameEpoch.seedPendingCollectorRetentionFrom(
      previous, SOURCE, EPOCH, EPOCH, originalObservedAtMs + 2)).toBe(false);
    expect(new SabaWsCatalogAdapter().seedPendingCollectorRetentionFrom(
      previous, SOURCE, EPOCH, "other-worker:14", originalObservedAtMs + 2)).toBe(false);
    expect(new SabaWsCatalogAdapter().seedPendingCollectorRetentionFrom(
      previous, SOURCE, EPOCH, "worker-a:12", originalObservedAtMs + 2)).toBe(false);
    expect(new SabaWsCatalogAdapter().seedPendingCollectorRetentionFrom(
      previous, SOURCE, EPOCH, TARGET_EPOCH, originalObservedAtMs - 1)).toBe(false);

    const expired = new SabaWsCatalogAdapter();
    expect(expired.seedPendingCollectorRetentionFrom(
      previous, SOURCE, EPOCH, TARGET_EPOCH, originalObservedAtMs + 10)).toBe(true);
    const currentDom = Array.from({ length: 50 }, (_, index) => record("current-" + index));
    const catalog = value(expired.decode({ ...domEnvelope({ schemaVersion: 2,
      snapshotId: "saba:7:expired-pending", chunkIndex: 0, chunkCount: 1, records: currentDom },
    5, TARGET_EPOCH, 60), observedAtMs: originalObservedAtMs + 3_600_001 }));
    expect(catalog.events.map(({ providerEventId }) => providerEventId)).not.toContain("today-1");
  });

  it("does not transfer readiness, wrong-source state, or replay-only collector input", () => {
    const generation = "saba:collector:pending-no-readiness";
    const previous = new SabaWsCatalogAdapter();
    const readyRecords = Array.from({ length: 50 }, (_, index) => record("ready-" + index));
    expect(previous.decode(domEnvelope({ schemaVersion: 2, snapshotId: "saba:7:ready-source",
      chunkIndex: 0, chunkCount: 1, records: readyRecords }))).toHaveLength(1);
    expect(previous.decode(collectorEnvelope(generation,
      completeItems(generation, "", ""), 2))).toHaveLength(1);
    const replacement = new SabaWsCatalogAdapter();

    expect(replacement.seedPendingCollectorRetentionFrom(
      previous, "chrome:SABA:other", EPOCH, TARGET_EPOCH, WALL + 2_000)).toBe(false);
    expect(replacement.seedPendingCollectorRetentionFrom(
      previous, SOURCE, EPOCH, TARGET_EPOCH, WALL + 2_000)).toBe(true);
    const small = Array.from({ length: 20 }, (_, index) => record("small-" + index));
    expect(replacement.decode(domEnvelope({ schemaVersion: 2, snapshotId: "saba:7:small-target",
      chunkIndex: 0, chunkCount: 1, records: small }, 3, TARGET_EPOCH))).toEqual([]);
    expect(replacement.takeIgnoreReason()).toBe("dom-first-generation-20-under-50");

    const replayOnly = new SabaWsCatalogAdapter();
    const replay = collectorEnvelope("saba:collector:pending-replay",
      completeItems("saba:collector:pending-replay"), 4);
    expect(replayOnly.decode({ ...replay, request: { ...replay.request, replayed: true } })).toEqual([]);
    expect(new SabaWsCatalogAdapter().seedPendingCollectorRetentionFrom(
      replayOnly, SOURCE, EPOCH, TARGET_EPOCH, WALL + 5_000)).toBe(false);
  });

  it("drops pending retention on exact overlapping business-identity contradiction", () => {
    const generation = "saba:collector:pending-identity";
    const items = completeItems(generation, "same-owner", "");
    const roster = items.find((item) => item.kind === "CAPTURE")!;
    if (roster.kind === "CAPTURE") {
      items[items.indexOf(roster)] = { ...roster,
        record: record("same-owner", "same-owner__4", "0.88", "09/08 08:00PM", [
          group("same-owner__4", ["3"], "0.88"),
          group("same-owner__3", [], "0.81")
        ]) };
    }
    const previous = new SabaWsCatalogAdapter();
    expect(previous.decode(collectorEnvelope(generation, items))).toHaveLength(1);
    const replacement = new SabaWsCatalogAdapter();
    expect(replacement.seedPendingCollectorRetentionFrom(
      previous, SOURCE, EPOCH, TARGET_EPOCH, WALL + 2_000)).toBe(true);
    const conflicting = { ...record("same-owner"), leagueName: "Different League" };
    const current = [conflicting,
      ...Array.from({ length: 49 }, (_, index) => record("identity-current-" + index))];

    const catalog = value(replacement.decode(domEnvelope({ schemaVersion: 2,
      snapshotId: "saba:7:identity-conflict", chunkIndex: 0, chunkCount: 1, records: current },
    3, TARGET_EPOCH, 50)));

    expect(catalog.nativeMarketObservations.some(({ providerMarketId }) => providerMarketId === "3"))
      .toBe(false);
    expect(catalog.events.find(({ providerEventId }) => providerEventId === "same-owner"))
      .toMatchObject({ competition: "Different League" });
  });

  it("clears a pending collector snapshot on resetSource", () => {
    const generation = "saba:collector:pending-reset";
    const previous = new SabaWsCatalogAdapter();
    expect(previous.decode(collectorEnvelope(generation,
      completeItems(generation, "retired-owner", "")))).toHaveLength(1);
    const replacement = new SabaWsCatalogAdapter();
    expect(replacement.seedPendingCollectorRetentionFrom(
      previous, SOURCE, EPOCH, TARGET_EPOCH, WALL + 2_000)).toBe(true);

    replacement.resetSource(SOURCE);
    const current = Array.from({ length: 50 }, (_, index) => record("after-reset-" + index));
    const catalog = value(replacement.decode(domEnvelope({ schemaVersion: 2,
      snapshotId: "saba:7:after-reset", chunkIndex: 0, chunkCount: 1, records: current },
    3, TARGET_EPOCH, 50)));

    expect(catalog.events.map(({ providerEventId }) => providerEventId)).not.toContain("retired-owner");
  });

  it("coalesces a mapped composite collector market with its newer two-way WS quote", () => {
    const generation = "saba:collector:composite-known";
    const items = completeItems(generation, "2", "");
    const roster = items.find((item) => item.kind === "CAPTURE")!;
    if (roster.kind === "CAPTURE") {
      items[items.indexOf(roster)] = { ...roster,
        record: record("2", "2__3", "0.81", "09/08 08:00PM", [group("2__3", ["1"], "0.81")]) };
    }
    const adapter = new SabaWsCatalogAdapter();
    expect(adapter.decode(collectorEnvelope(generation, items))).toHaveLength(1);
    const reset = [["f", 0, WS_FIELDS], [0, "reset"],
      encodedWsRow({ type: "l", leagueid: 1, leaguenameen: "League", sporttype: 1 }),
      encodedWsRow({ type: "m", matchid: 2, leagueid: 1, hteamnameen: "2 home", ateamnameen: "2 away",
        kickofftime: WALL / 1_000, marketid: "L", sporttype: 1 }),
      encodedWsRow({ type: "o", oddsid: 3, matchid: 2, bettype: 1, parenttypeid: 1,
        oddsstatus: "running", enable: 1, odds1a: 0.72, odds2a: -0.82, hdp1: 0.5, hdp2: 0 }),
      [0, "done"]];

    const updated = value(adapter.decode(wsEnvelope(reset, "known-reset", 2, 40)));

    expect(updated.markets.filter(({ providerEventId, providerMarketId }) =>
      providerEventId === "2" && providerMarketId === "3")).toHaveLength(1);
    expect(updated.markets.some(({ providerMarketId }) => providerMarketId === "2__3")).toBe(false);
    expect(updated.quotes.filter(({ providerEventId, providerMarketId }) =>
      providerEventId === "2" && providerMarketId === "3"))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ rawOdds: "0.72", receivedMonotonicMs: 40 }),
        expect.objectContaining({ rawOdds: "-0.82", receivedMonotonicMs: 40 })
      ]));
    expect(updated.quotes.filter(({ providerEventId, providerMarketId }) =>
      providerEventId === "2" && providerMarketId === "3")).toHaveLength(2);
  });

  it("retains two clean-sheet markets from public More and takes newer native four-field prices", () => {
    const generation = "saba:collector:clean-sheet";
    const items = completeItems(generation, "2", "");
    const roster = items.find((item) => item.kind === "CAPTURE")!;
    const cleanSheet = { betTypeIds: [],
      labels: ["Giữ sạch lưới", "Đội Nhà Có", "Đội Nhà Không", "Đội Khách Có", "Đội Khách Không"],
      odds: ["2.72", "1.36", "3.60", "1.22"].map((priceText) => ({
        marketOddsId: "2__3", priceText, status: "running", greyedOut: null
      })) };
    if (roster.kind === "CAPTURE") items[items.indexOf(roster)] = { ...roster,
      record: record("2", "2__4", "0.88", "09/08 08:00PM", [group("2__4", ["3"]), cleanSheet]) };
    const adapter = new SabaWsCatalogAdapter();
    const initial = value(adapter.decode(collectorEnvelope(generation, items)));
    expect(initial.markets.filter(({ providerMarketId }) => providerMarketId.endsWith("clean-sheet"))).toHaveLength(2);
    expect(initial.quotes.filter(({ providerMarketId }) => providerMarketId.endsWith("clean-sheet")))
      .toEqual(expect.arrayContaining([expect.objectContaining({ providerMarketId: "3:home-clean-sheet",
        selection: "YES", rawOdds: "2.72", rawFormat: "DECIMAL", receivedMonotonicMs: 10.5 })]));
    const reset = [["f", 0, WS_FIELDS], [0, "reset"],
      encodedWsRow({ type: "l", leagueid: 1, leaguenameen: "League", sporttype: 1 }),
      encodedWsRow({ type: "m", matchid: 2, leagueid: 1, hteamnameen: "2 home", ateamnameen: "2 away",
        kickofftime: WALL / 1000, marketid: "L", sporttype: 1 }),
      encodedWsRow({ type: "o", oddsid: 3, matchid: 2, bettype: 13, parenttypeid: 13,
        oddsstatus: "running", enable: 1, cs11: 2.95, cs10: 1.36, cs21: 3.60, cs20: 1.22 }),
      [0, "done"]];
    const updated = value(adapter.decode(wsEnvelope(reset, "clean-sheet-reset", 2, 40)));
    expect(updated.markets.filter(({ providerMarketId }) => providerMarketId.endsWith("clean-sheet"))).toHaveLength(2);
    const quotes = updated.quotes.filter(({ providerMarketId }) => providerMarketId.endsWith("clean-sheet"));
    expect(quotes).toHaveLength(4);
    expect(quotes).toEqual(expect.arrayContaining([expect.objectContaining({
      providerMarketId: "3:home-clean-sheet", selection: "YES", rawOdds: "2.95",
      rawFormat: "DECIMAL", receivedMonotonicMs: 40, sequence: 2 })]));
    expect(updated.markets.some(({ providerMarketId }) => providerMarketId.startsWith("2__3"))).toBe(false);
  });

  it("canonicalizes the same exact owner-prefixed id at the legacy DOM boundary", () => {
    const records = [record("2", "2__3", "0.81"),
      ...Array.from({ length: 49 }, (_, index) => record(`legacy-canonical-${index}`))];
    const envelope = domEnvelope({ schemaVersion: 2, snapshotId: "legacy-canonical",
      chunkIndex: 0, chunkCount: 1, records });

    const catalog = value(new SabaWsCatalogAdapter().decode(envelope));

    expect(catalog.markets).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerEventId: "2", providerMarketId: "3" })
    ]));
    expect(catalog.markets.some(({ providerMarketId }) => providerMarketId === "2__3")).toBe(false);
  });

  it.each([
    ["wrong owner prefix", "9__3"],
    ["non-digit suffix", "2__three"],
    ["extra delimiter", "2__3__4"],
    ["bare id", "3"]
  ])("leaves a %s market id unchanged", (_caseName, rawMarketId) => {
    const generation = `saba:collector:literal-${rawMarketId}`;
    const items = completeItems(generation, "2", "");
    const roster = items.find((item) => item.kind === "CAPTURE")!;
    if (roster.kind === "CAPTURE") {
      items[items.indexOf(roster)] = { ...roster,
        record: record("2", "2__4", "0.88", "09/08 08:00PM",
          [group("2__4", ["3"], "0.88"), group(rawMarketId, [], "0.81")]) };
    }

    const catalog = value(new SabaWsCatalogAdapter().decode(collectorEnvelope(generation, items)));

    expect(catalog.nativeMarketObservations).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerEventId: "2", providerMarketId: rawMarketId })
    ]));
  });

  it("fails the entire collector candidate when distinct raw ids canonicalize to one owner market", () => {
    const generation = "saba:collector:canonical-collision";
    const items = completeItems(generation, "2", "");
    const roster = items.find((item) => item.kind === "CAPTURE")!;
    if (roster.kind === "CAPTURE") {
      items[items.indexOf(roster)] = { ...roster,
        record: record("2", "2__3", "0.81", "09/08 08:00PM",
          [group("2__3", [], "0.81"), group("3", [], "0.82")]) };
    }
    const adapter = new SabaWsCatalogAdapter();

    expect(adapter.decode(collectorEnvelope(generation, items))).toEqual([]);
    expect(adapter.takeIgnoreReason()).toBe("collector-market-id-collision");
  });

  it("pins the first collector epoch until resetSource", () => {
    const adapter = new SabaWsCatalogAdapter();
    const firstGeneration = "saba:collector:epoch-a";
    const secondGeneration = "saba:collector:epoch-b";
    expect(value(adapter.decode(collectorEnvelope(firstGeneration,
      completeItems(firstGeneration, "epoch-a", "")))).events)
      .toEqual([expect.objectContaining({ providerEventId: "epoch-a" })]);

    expect(adapter.decode(collectorEnvelope(secondGeneration,
      completeItems(secondGeneration, "epoch-b", ""), 2, "worker-b:14"))).toEqual([]);
    adapter.resetSource(SOURCE);
    expect(value(adapter.decode(collectorEnvelope(secondGeneration,
      completeItems(secondGeneration, "epoch-b", ""), 3, "worker-b:14"))).events)
      .toEqual([expect.objectContaining({ providerEventId: "epoch-b" })]);
  });

  it("retains an existing WS live partition when collector prematch detail arrives", () => {
    const fields = ["type", "leagueid", "leaguenameen", "sporttype", "matchid", "hteamnameen",
      "ateamnameen", "kickofftime", "marketid", "oddsid", "bettype", "parenttypeid", "oddsstatus",
      "enable", "odds1a", "odds2a", "hdp1", "hdp2"];
    const encoded = (entry: Record<string, unknown>) => Object.entries(entry)
      .flatMap(([key, entryValue]) => [fields.indexOf(key), entryValue]);
    const rows = [["f", 0, fields], [0, "reset"],
      encoded({ type: "l", leagueid: 1, leaguenameen: "Live League", sporttype: 1 }),
      encoded({ type: "m", matchid: 2, leagueid: 1, hteamnameen: "Live Home",
        ateamnameen: "Live Away", kickofftime: WALL / 1_000, marketid: "L", sporttype: 1 }),
      encoded({ type: "o", oddsid: 3, matchid: 2, bettype: 1, parenttypeid: 1,
        oddsstatus: "running", enable: 1, odds1a: 0.92, odds2a: -0.98, hdp1: 0.5, hdp2: 0 }),
      [0, "done"]];
    const ws: ChromeBridgeEnvelope = { version: 1, kind: "NETWORK", lobby: "SABA", sourceId: SOURCE,
      sourceEpoch: EPOCH, tabId: 7, sequence: 1, observedAtMs: WALL,
      receivedMonotonicMs: 5, transport: "WS_FRAME",
      request: { hostname: "sports.example", pathnameClass: "/socket.io/",
        resourceType: "WebSocket", streamId: "1" },
      payload: { encoding: "UTF8", body: `42${JSON.stringify(["m", "b1", rows, 1])}` } };
    const adapter = new SabaWsCatalogAdapter();
    expect(adapter.decode(ws)).toHaveLength(1);
    const generation = "saba:collector:with-ws";

    const catalog = value(adapter.decode(collectorEnvelope(generation,
      completeItems(generation, "prematch", ""), 2)));

    expect(catalog.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerEventId: "2" }),
      expect.objectContaining({ providerEventId: "prematch", isLive: false })
    ]));
  });
});
