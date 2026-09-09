import { describe, expect, it } from "vitest";
import { normalizeObservedFootballCatalog, observeNativeCmdMarkets } from "@tool-chenh/adapters";
import { SabaCollectorDomAssembler, type SabaCollectorDomItem } from "./saba-collector-dom.js";

const SOURCE = "chrome:SABA:2105831237";
const EPOCH = "worker-a:13";
const GENERATION = "saba:collector:generation-0001";
const FRAME = "sports-frame";
const DOCUMENT = "worker-a:13:sports-frame:document-1";

const record = (matchId: string, marketOddsId = `${matchId}-odd`) => ({
  sportId: "1" as const,
  leagueId: "league-1",
  leagueName: "League",
  matchId,
  timeText: "08:00PM",
  teamNames: [`${matchId} home`, `${matchId} away`],
  groups: [{ betTypeIds: ["15"], labels: ["Odd", "Even"], odds: [
    { marketOddsId, priceText: "0.91", status: null, greyedOut: null },
    { marketOddsId, priceText: "-0.93", status: null, greyedOut: null }
  ] }]
});

const capture = (period: "TODAY" | "EARLY", ownerMatchId: string, captureOrdinal: number,
  captureKind: "ROSTER" | "ALTERNATE_ROWS_ADDED" = "ROSTER",
  date: { kind: "EXPLICIT"; isoDate: string } | { kind: "UNKNOWN" } = { kind: "UNKNOWN" }):
  SabaCollectorDomItem => ({
    kind: "CAPTURE", collectorGeneration: GENERATION, period, ownerMatchId, captureKind,
    kickoffDate: date, capturedAtMs: 1_788_800_000_000 + captureOrdinal,
    capturedMonotonicMs: 10_000 + captureOrdinal, captureOrdinal,
    record: record(ownerMatchId, `${ownerMatchId}-${captureKind}`)
  });

const owner = (period: "TODAY" | "EARLY", ownerMatchId: string,
  safeControlOutcome: "NO_ELIGIBLE_CONTROL" | "NO_STRUCTURAL_CHANGE" |
    "ALTERNATE_ROWS_ADDED" = "NO_ELIGIBLE_CONTROL", restored = true): SabaCollectorDomItem => ({
      kind: "OWNER_COMPLETE", collectorGeneration: GENERATION, period, ownerMatchId,
      safeControlOutcome, restored
    });

const period = (value: "TODAY" | "EARLY", rosterMatchIds: string[]): SabaCollectorDomItem => ({
  kind: "PERIOD_COMPLETE", collectorGeneration: GENERATION, period: value,
  rosterMatchIds, rosterCount: rosterMatchIds.length
});

const terminal = (today: string[], early: string[], overrides: Record<string, unknown> = {}):
  SabaCollectorDomItem => ({
    kind: "TERMINAL", collectorGeneration: GENERATION,
    periods: [
      { period: "TODAY", rosterMatchIds: today, rosterCount: today.length },
      { period: "EARLY", rosterMatchIds: early, rosterCount: early.length }
    ],
    owners: [
      ...today.map((ownerMatchId) => ({ period: "TODAY" as const, ownerMatchId })),
      ...early.map((ownerMatchId) => ({ period: "EARLY" as const, ownerMatchId }))
    ],
    todayRestoration: { selected: true, rosterMatchIds: today, rosterCount: today.length },
    unresolvedOwners: [], failedOwners: [], ...overrides
  } as SabaCollectorDomItem);

const completeItems = (): SabaCollectorDomItem[] => [
  capture("TODAY", "today-1", 1, "ROSTER", { kind: "EXPLICIT", isoDate: "2026-09-08" }),
  capture("TODAY", "today-1", 2, "ALTERNATE_ROWS_ADDED",
    { kind: "EXPLICIT", isoDate: "2026-09-08" }),
  owner("TODAY", "today-1", "ALTERNATE_ROWS_ADDED"),
  capture("EARLY", "early-1", 3), owner("EARLY", "early-1"),
  period("TODAY", ["today-1"]), period("EARLY", ["early-1"]),
  terminal(["today-1"], ["early-1"])
];

const chunk = (snapshotId: string, chunkIndex: number, chunkCount: number,
  records: readonly unknown[], overrides: Record<string, unknown> = {}) => ({
    schemaVersion: 2 as const, snapshotId, chunkIndex, chunkCount,
    sweepId: GENERATION, sweepComplete: true, sweepFrameKey: FRAME,
    sweepDocumentKey: DOCUMENT, records, ...overrides
  });

const ingest = (assembler: SabaCollectorDomAssembler, rawChunk: unknown,
  receivedMonotonicMs = 100_000, sourceEpoch = EPOCH,
  generationObservedAtMs = 1_788_800_100_000) => assembler.ingest({
    sourceId: SOURCE, sourceEpoch, rawChunk, receivedMonotonicMs, generationObservedAtMs
  });
const activeAssembler = (sourceEpoch = EPOCH) => {
  const assembler = new SabaCollectorDomAssembler();
  expect(assembler.activateSourceEpoch(SOURCE, sourceEpoch)).toBe(true);
  return assembler;
};

const mainRosterItems = (): unknown[] => {
  const full = completeItems();
  const proof = full.at(-1)!;
  if (proof.kind !== "TERMINAL") throw new Error("terminal fixture missing");
  const { unresolvedOwners: _unresolved, failedOwners: _failed, ...manifest } = proof;
  return [...full.flatMap((item) => item.kind === "CAPTURE" && item.captureKind === "ROSTER" ?
    [{ ...item, record: { ...item.record, providerTimezoneOffsetMinutes: 480 } }] : []),
    { ...manifest, kind: "MAIN_ROSTER_TERMINAL", hiddenMarketsComplete: false }];
};

describe("SabaCollectorDomAssembler", () => {
  it("validates both main rosters independently of hidden owner completion and preserves acquisition clocks", () => {
    const items = mainRosterItems();
    const result = ingest(activeAssembler(), chunk("saba:collector:main-proof", 0, 1, items));
    expect(result).toMatchObject({ coverage: "MAIN_ROSTER", hiddenMarketsComplete: false,
      owners: [], sourceId: SOURCE, sourceEpoch: EPOCH });
    expect(result?.captures).toEqual(items.slice(0, -1));
  });

  it.each([
    ["missing capture", (items: any[]) => items.slice(1)],
    ["duplicate capture", (items: any[]) => [items[0], items[0], ...items.slice(1)]],
    ["omitted owner", (items: any[]) => [...items.slice(0, -1), { ...items.at(-1), owners: [] }]],
    ["duplicate owner", (items: any[]) => [...items.slice(0, -1), { ...items.at(-1),
      owners: [...items.at(-1).owners, items.at(-1).owners[0]] }]],
    ["missing Early", (items: any[]) => [...items.slice(0, -1), { ...items.at(-1),
      periods: items.at(-1).periods.slice(0, 1) }]],
    ["unrestored Today", (items: any[]) => [...items.slice(0, -1), { ...items.at(-1),
      todayRestoration: { ...items.at(-1).todayRestoration, selected: false } }]],
    ["restore roster mismatch", (items: any[]) => [...items.slice(0, -1), { ...items.at(-1),
      todayRestoration: { selected: true, rosterMatchIds: [], rosterCount: 0 } }]],
    ["hidden proof mixed in", (items: any[]) => [...items, owner("TODAY", "today-1")]],
    ["fake hidden completion", (items: any[]) => [...items.slice(0, -1), { ...items.at(-1), hiddenMarketsComplete: true }]],
    ["future capture", (items: any[]) => [{ ...items[0], capturedMonotonicMs: 1_000_000 }, ...items.slice(1)]],
    ["unproven timezone", (items: any[]) => [{ ...items[0],
      record: { ...items[0].record, providerTimezoneOffsetMinutes: null } }, ...items.slice(1)]],
    ["foreign generation", (items: any[]) => [{ ...items[0], collectorGeneration: "foreign" }, ...items.slice(1)]]
  ])("rejects an invalid main roster atomically: %s", (_label, change) => {
    expect(ingest(activeAssembler(), chunk("saba:collector:invalid-main", 0, 1,
      change(mainRosterItems())))).toBeNull();
  });

  it("accepts explicitly empty main periods without manufacturing hidden completion", () => {
    const proof = mainRosterItems().at(-1) as Record<string, unknown>;
    const empty = { ...proof, periods: ["TODAY", "EARLY"].map((period) => ({
      period, rosterMatchIds: [], rosterCount: 0 })), owners: [],
      todayRestoration: { selected: true, rosterMatchIds: [], rosterCount: 0 } };
    expect(ingest(activeAssembler(), chunk("saba:collector:empty-main", 0, 1, [empty])))
      .toMatchObject({ coverage: "MAIN_ROSTER", hiddenMarketsComplete: false, captures: [], owners: [] });
  });

  it("accepts a main publication and later full hidden publication without deduping either stage", () => {
    const assembler = activeAssembler();
    const mainGeneration = `${GENERATION}:main`;
    const main = mainRosterItems().map((item) => ({ ...(item as Record<string, unknown>),
      collectorGeneration: mainGeneration }));
    expect(ingest(assembler, chunk("saba:collector:staged-main", 0, 1, main,
      { sweepId: mainGeneration }))).toMatchObject({ coverage: "MAIN_ROSTER" });
    expect(ingest(assembler, chunk("saba:collector:staged-hidden", 0, 1, completeItems()),
      100_001, EPOCH, 1_788_800_100_001)).toMatchObject({ coverage: "HIDDEN_COMPLETE", hiddenMarketsComplete: true });
  });

  it("rejects main chunks from another document or retired epoch", () => {
    const assembler = activeAssembler();
    const items = mainRosterItems();
    expect(ingest(assembler, chunk("saba:collector:main-binding", 0, 2, items.slice(0, 1)))).toBeNull();
    expect(ingest(assembler, chunk("saba:collector:main-binding", 1, 2, items.slice(1),
      { sweepDocumentKey: "foreign-document" }), 100_001)).toBeNull();
    assembler.activateSourceEpoch(SOURCE, "worker-a:14");
    expect(ingest(assembler, chunk("saba:collector:retired-main", 0, 1, items))).toBeNull();
  });

  it.each([420, 480, null])("retains explicit public timezone metadata %s through collector validation", (offset) => {
    const items = completeItems().map((item) => item.kind !== "CAPTURE" ? item : {
      ...item, record: { ...item.record, providerTimezoneOffsetMinutes: offset }
    });
    const result = ingest(activeAssembler(), chunk("saba:collector:timezone", 0, 1, items));
    expect(result?.captures[0]?.record).toHaveProperty("providerTimezoneOffsetMinutes", offset);
  });
  it.each([26, 128])("preserves %i unknown public outcomes without treating them as a binary market", (count) => {
    const items = completeItems().map((item) => item.kind !== "CAPTURE" ? item : {
      ...item, record: { ...item.record, groups: [{ betTypeIds: [], labels: ["Unclassified public market"],
        odds: Array.from({ length: count }, (_, index) => ({ marketOddsId: `${item.ownerMatchId}-unknown`,
          priceText: String(2 + index), status: "running", greyedOut: null })) }] }
    });
    const result = ingest(activeAssembler(), chunk(`saba:collector:unknown-${count}`, 0, 1, items));
    expect(result?.captures[0]?.record.groups[0]?.odds).toHaveLength(count);
    expect(result?.captures[0]?.record.groups[0]?.betTypeIds).toEqual([]);
    const records = [{ ...result!.captures[0]!.record, timeText: "09/08 08:00PM" }];
    const options = { observedAtMs: 1_788_800_000_000, receivedMonotonicMs: 10_000,
      sequence: 1, timezoneOffsetMinutes: 480 };
    const normalized = normalizeObservedFootballCatalog("SABA", records, options);
    expect(normalized.markets).toEqual([]);
    expect(normalized.quotes).toEqual([]);
    expect(observeNativeCmdMarkets("SABA", records, options)).toMatchObject([
      { nativeType: "UNKNOWN", disposition: "EXCLUDED", reason: "AMBIGUOUS_NATIVE_TYPE" }
    ]);
  });

  it("rejects 129 outcomes atomically instead of truncating public inventory", () => {
    const items = completeItems().map((item) => item.kind !== "CAPTURE" ? item : {
      ...item, record: { ...item.record, groups: [{ betTypeIds: [], labels: [],
        odds: Array.from({ length: 129 }, () => ({ marketOddsId: `${item.ownerMatchId}-unknown`,
          priceText: "2", status: "running", greyedOut: null })) }] }
    });
    expect(ingest(activeAssembler(), chunk("saba:collector:oversized-outcomes", 0, 1, items))).toBeNull();
  });

  it("publishes one bound candidate after out-of-order chunks and preserves capture clocks and ordinals", () => {
    const assembler = activeAssembler();
    const items = completeItems();
    const id = "saba:collector:snapshot-0001";

    expect(ingest(assembler, chunk(id, 1, 2, items.slice(4)), 100_001)).toBeNull();
    const result = ingest(assembler, chunk(id, 0, 2, items.slice(0, 4)), 100_002);

    expect(result).toMatchObject({ sourceId: SOURCE, sourceEpoch: EPOCH,
      collectorGeneration: GENERATION, sweepFrameKey: FRAME, sweepDocumentKey: DOCUMENT });
    expect(result?.captures.map(({ ownerMatchId, captureKind, kickoffDate, capturedAtMs,
      capturedMonotonicMs, captureOrdinal }) => ({ ownerMatchId, captureKind, kickoffDate,
      capturedAtMs, capturedMonotonicMs, captureOrdinal }))).toEqual([
        { ownerMatchId: "today-1", captureKind: "ROSTER",
          kickoffDate: { kind: "EXPLICIT", isoDate: "2026-09-08" },
          capturedAtMs: 1_788_800_000_001, capturedMonotonicMs: 10_001, captureOrdinal: 1 },
        { ownerMatchId: "today-1", captureKind: "ALTERNATE_ROWS_ADDED",
          kickoffDate: { kind: "EXPLICIT", isoDate: "2026-09-08" },
          capturedAtMs: 1_788_800_000_002, capturedMonotonicMs: 10_002, captureOrdinal: 2 },
        { ownerMatchId: "early-1", captureKind: "ROSTER", kickoffDate: { kind: "UNKNOWN" },
          capturedAtMs: 1_788_800_000_003, capturedMonotonicMs: 10_003, captureOrdinal: 3 }
      ]);
    expect(result?.periods.map(({ period: value, rosterMatchIds }) =>
      [value, rosterMatchIds])).toEqual([["TODAY", ["today-1"]], ["EARLY", ["early-1"]]]);
    expect(ingest(assembler, chunk(id, 0, 2, items.slice(0, 4)), 100_003)).toBeNull();
  });

  it("emits nothing for incomplete chunks or a generation without a terminal", () => {
    const assembler = activeAssembler();
    expect(ingest(assembler, chunk("saba:collector:partial-0001", 0, 2, completeItems().slice(0, 2))))
      .toBeNull();
    expect(ingest(activeAssembler(), chunk("saba:collector:no-terminal-01", 0, 1,
      completeItems().slice(0, -1)))).toBeNull();
  });

  it("rejects unbound chunks and atomically poisons mixed document ownership", () => {
    const unbound = { schemaVersion: 2 as const, snapshotId: "saba:collector:unbound-0001",
      chunkIndex: 0, chunkCount: 1, records: completeItems() };
    expect(ingest(activeAssembler(), unbound)).toBeNull();

    const assembler = activeAssembler();
    const items = completeItems();
    const id = "saba:collector:mixed-doc-0001";
    expect(ingest(assembler, chunk(id, 0, 2, items.slice(0, 4)), 100_001)).toBeNull();
    expect(ingest(assembler, chunk(id, 1, 2, items.slice(4), {
      sweepDocumentKey: "worker-b:13:sports-frame:document-2"
    }), 100_002)).toBeNull();
    expect(ingest(assembler, chunk(id, 1, 2, items.slice(4)), 100_003)).toBeNull();
  });

  it.each([
    ["missing TODAY period", (items: SabaCollectorDomItem[]) =>
      items.filter((item) => !(item.kind === "PERIOD_COMPLETE" && item.period === "TODAY"))],
    ["missing roster owner completion", (items: SabaCollectorDomItem[]) =>
      items.filter((item) => !(item.kind === "OWNER_COMPLETE" && item.ownerMatchId === "early-1"))],
    ["unlisted capture owner", (items: SabaCollectorDomItem[]) =>
      [capture("TODAY", "intruder", 0), ...items]],
    ["record owned by another match", (items: SabaCollectorDomItem[]) => items.map((item) =>
      item.kind === "CAPTURE" && item.ownerMatchId === "early-1" ?
        { ...item, record: record("wrong-owner") } : item)],
    ["invalid explicit calendar date", (items: SabaCollectorDomItem[]) => items.map((item) =>
      item.kind === "CAPTURE" && item.captureOrdinal === 1 ?
        { ...item, kickoffDate: { kind: "EXPLICIT", isoDate: "2026-02-30" } } : item)]
  ])("rejects a complete-looking generation with %s", (_name, mutate) => {
    const items = mutate(completeItems());
    expect(ingest(activeAssembler(),
      chunk(`saba:collector:invalid-${String(_name).replace(/\s+/gu, "-")}`, 0, 1, items))).toBeNull();
  });

  it("rejects conflicting owner duplicates and failed owner or Today restoration", () => {
    const conflicting = [...completeItems(), owner("TODAY", "today-1", "NO_STRUCTURAL_CHANGE")];
    expect(ingest(activeAssembler(),
      chunk("saba:collector:owner-conflict-01", 0, 1, conflicting))).toBeNull();

    const failedOwner = completeItems().map((item) => item.kind === "OWNER_COMPLETE" &&
      item.ownerMatchId === "today-1" ? { ...item, restored: false } : item);
    expect(ingest(activeAssembler(),
      chunk("saba:collector:owner-restore-001", 0, 1, failedOwner))).toBeNull();

    const failedToday = completeItems().map((item) => item.kind === "TERMINAL" ?
      { ...item, todayRestoration: { ...item.todayRestoration, selected: false } } : item);
    expect(ingest(activeAssembler(),
      chunk("saba:collector:today-restore-001", 0, 1, failedToday))).toBeNull();
  });

  it("reset and a newer source epoch prevent an old partial generation from completing", () => {
    const items = completeItems();
    const id = "saba:collector:retired-0001";
    const assembler = activeAssembler();
    expect(ingest(assembler, chunk(id, 0, 2, items.slice(0, 4)), 100_001)).toBeNull();
    assembler.resetSource(SOURCE);
    expect(ingest(assembler, chunk(id, 1, 2, items.slice(4)), 100_002)).toBeNull();

    const epochs = activeAssembler("worker-a:13");
    expect(ingest(epochs, chunk(id, 0, 2, items.slice(0, 4)), 100_001, "worker-a:13")).toBeNull();
    expect(ingest(epochs, chunk("saba:collector:new-epoch-0001", 0, 2, items.slice(0, 4)),
      100_002, "worker-b:14")).toBeNull();
    expect(epochs.activateSourceEpoch(SOURCE, "worker-b:14")).toBe(true);
    expect(ingest(epochs, chunk(id, 1, 2, items.slice(4)), 100_003, "worker-a:13")).toBeNull();
  });

  it("does not let a malformed chunk from another epoch retire a valid pending candidate", () => {
    const items = completeItems();
    const id = "saba:collector:malformed-epoch-01";
    const assembler = activeAssembler("worker-a:13");
    expect(ingest(assembler, chunk(id, 0, 2, items.slice(0, 4)), 100_001, "worker-a:13")).toBeNull();
    expect(ingest(assembler, { schemaVersion: 2, snapshotId: "malformed" },
      100_002, "worker-b:14")).toBeNull();
    expect(ingest(assembler, chunk(id, 1, 2, items.slice(4)), 100_003, "worker-a:13"))
      .toMatchObject({ sourceEpoch: "worker-a:13", collectorGeneration: GENERATION });
  });

  it.each([
    [Number.NaN, 1_788_800_100_000],
    [Number.POSITIVE_INFINITY, 1_788_800_100_000],
    [-1, 1_788_800_100_000],
    [Number.MAX_SAFE_INTEGER + 1, 1_788_800_100_000],
    [100_000, Number.NaN],
    [100_000, Number.POSITIVE_INFINITY],
    [100_000, -1],
    [100_000, Number.MAX_SAFE_INTEGER + 1]
  ])("rejects invalid transport clocks before mutating pending state (%s, %s)",
    (receivedMonotonicMs, generationObservedAtMs) => {
      const items = completeItems();
      const id = "saba:collector:clock-poison-001";
      const assembler = activeAssembler();
      expect(ingest(assembler, chunk(id, 0, 2, items.slice(0, 4)))).toBeNull();
      expect(ingest(assembler, chunk("saba:collector:clock-poison-002", 0, 1, items),
        receivedMonotonicMs, EPOCH, generationObservedAtMs)).toBeNull();
      expect(ingest(assembler, chunk(id, 1, 2, items.slice(4))))
        .toMatchObject({ sourceEpoch: EPOCH, collectorGeneration: GENERATION });
    });

  it("requires trusted epoch activation and rejects late chunks from the replaced epoch", () => {
    const items = completeItems();
    const assembler = activeAssembler("worker-a:13");
    const oldId = "saba:collector:trusted-old-01";
    const nextId = "saba:collector:trusted-new-01";
    expect(ingest(assembler, chunk(oldId, 0, 2, items.slice(0, 4)),
      100_000, "worker-a:13")).toBeNull();
    expect(ingest(assembler, chunk(nextId, 0, 2, items.slice(0, 4)),
      100_001, "worker-b:14")).toBeNull();

    expect(assembler.activateSourceEpoch(SOURCE, "worker-b:14")).toBe(true);
    expect(ingest(assembler, chunk(oldId, 1, 2, items.slice(4)),
      100_002, "worker-a:13")).toBeNull();
    expect(ingest(assembler, chunk(nextId, 0, 2, items.slice(0, 4)),
      100_003, "worker-b:14")).toBeNull();
    expect(ingest(assembler, chunk(nextId, 1, 2, items.slice(4)),
      100_004, "worker-b:14")).toMatchObject({ sourceEpoch: "worker-b:14" });
    expect(ingest(assembler, chunk(oldId, 0, 1, items),
      100_005, "worker-a:13")).toBeNull();
  });

  it("rejects decreasing capture monotonic clocks and future capture clocks without restamping", () => {
    const decreasing = completeItems().map((item) => item.kind === "CAPTURE" &&
      item.captureOrdinal === 2 ? { ...item, capturedMonotonicMs: 9_000 } : item);
    expect(ingest(activeAssembler(),
      chunk("saba:collector:decreasing-clock", 0, 1, decreasing))).toBeNull();

    const futureWall = completeItems().map((item) => item.kind === "CAPTURE" &&
      item.captureOrdinal === 1 ? { ...item, capturedAtMs: Number.MAX_SAFE_INTEGER } : item);
    expect(ingest(activeAssembler(), chunk("saba:collector:future-wall-001", 0, 1, futureWall),
      100_000, EPOCH, 1_788_800_100_000)).toBeNull();

    const futureMonotonic = completeItems().map((item) => item.kind === "CAPTURE" &&
      item.captureOrdinal === 3 ? { ...item, capturedMonotonicMs: 100_001 } : item);
    expect(ingest(activeAssembler(),
      chunk("saba:collector:future-mono-001", 0, 1, futureMonotonic), 100_000)).toBeNull();
  });

  it("accepts fractional capture and receipt monotonic milliseconds in their shared clock domain", () => {
    const monotonic = [123.5, 124.125, 124.5];
    let captureIndex = 0;
    const items = completeItems().map((item) => item.kind === "CAPTURE" ?
      { ...item, capturedMonotonicMs: monotonic[captureIndex++] } : item);

    const result = ingest(activeAssembler(),
      chunk("saba:collector:fractional-mono", 0, 1, items), 124.75);
    expect(result?.captures.map((item) => item.capturedMonotonicMs))
      .toEqual([123.5, 124.125, 124.5]);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -0.5, Number.MAX_SAFE_INTEGER + 0.5])(
    "rejects an invalid captured monotonic clock (%s)", (capturedMonotonicMs) => {
      const items = completeItems().map((item) => item.kind === "CAPTURE" &&
        item.captureOrdinal === 2 ? { ...item, capturedMonotonicMs } : item);
      expect(ingest(activeAssembler(),
        chunk("saba:collector:invalid-capture-clock", 0, 1, items))).toBeNull();
    });

  it("does not impose a 160-owner or 60-second collector-wide completion cap", () => {
    const today = Array.from({ length: 81 }, (_, index) => `today-${index}`);
    const early = Array.from({ length: 81 }, (_, index) => `early-${index}`);
    let ordinal = 1;
    const items: SabaCollectorDomItem[] = [
      ...today.flatMap((matchId) => [capture("TODAY", matchId, ordinal++), owner("TODAY", matchId)]),
      ...early.flatMap((matchId) => [capture("EARLY", matchId, ordinal++), owner("EARLY", matchId)]),
      period("TODAY", today), period("EARLY", early), terminal(today, early)
    ];
    const firstCapture = items[0];
    const lastCapture = items.findLast((item) => item.kind === "CAPTURE");
    if (firstCapture?.kind === "CAPTURE" && lastCapture?.kind === "CAPTURE") {
      items[items.indexOf(lastCapture)] = { ...lastCapture,
        capturedAtMs: firstCapture.capturedAtMs + 61_000,
        capturedMonotonicMs: firstCapture.capturedMonotonicMs + 61_000 };
    }

    const result = ingest(activeAssembler(),
      chunk("saba:collector:large-resume-01", 0, 1, items));
    expect(result?.owners).toHaveLength(162);
    expect(result?.captures.at(-1)).toMatchObject({ captureOrdinal: 162,
      capturedMonotonicMs: 71_001 });
  });
});
