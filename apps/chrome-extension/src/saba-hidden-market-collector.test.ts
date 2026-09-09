import { describe, expect, it, vi } from "vitest";
import { SabaHiddenMarketCollector, type SabaCollectorBinding,
  type SabaCollectorPageAdapter, type SabaCollectorPeriod,
  type SabaCollectorRecord, type SabaCollectorRosterOwner } from "./saba-hidden-market-collector.js";

const GENERATION = "saba:collector:generation-1";
const BINDING: SabaCollectorBinding = {
  sourceEpoch: "worker-a:13", frameKey: "sports-frame", documentKey: "document-1"
};

const record = (matchId: string, market = `${matchId}-odd`): SabaCollectorRecord => ({
  sportId: "1", leagueId: "league-1", leagueName: "League", matchId, timeText: "08:00PM",
  teamNames: [`${matchId} home`, `${matchId} away`], groups: [{ betTypeIds: ["15"],
    labels: ["Odd", "Even"], odds: [
      { marketOddsId: market, priceText: "0.91", status: null, greyedOut: null },
      { marketOddsId: `${market}-2`, priceText: "-0.93", status: null, greyedOut: null }
    ] }]
});

const owner = (matchId: string, control: SabaCollectorRosterOwner["control"], clock: number):
SabaCollectorRosterOwner => ({ ownerMatchId: matchId, record: record(matchId), control,
  kickoffDate: { kind: "UNKNOWN" }, capturedAtMs: 1_788_800_000_000 + clock,
  capturedMonotonicMs: clock });

function adapter(today: readonly SabaCollectorRosterOwner[], early: readonly SabaCollectorRosterOwner[],
  overrides: Partial<SabaCollectorPageAdapter> = {}): SabaCollectorPageAdapter {
  const reads = new Map<SabaCollectorPeriod, number>();
  const maxClock = Math.max(0, ...today.map(({ capturedMonotonicMs }) => capturedMonotonicMs),
    ...early.map(({ capturedMonotonicMs }) => capturedMonotonicMs));
  return {
    readRoster: async (period) => {
      const read = reads.get(period) ?? 0;
      reads.set(period, read + 1);
      const values = period === "TODAY" ? today : early;
      const owners = read === 0 ? values : values.map((value) =>
        refreshed(value, maxClock + read));
      return { binding: BINDING, period, selectedPrematch: true, owners };
    },
    captureOwner: async (period, rosterOwner) => ({ binding: BINDING, period,
      ownerMatchId: rosterOwner.ownerMatchId, controlOpened: true,
      terminalControlState: "RESTORED_CLOSED", restored: true,
      safeControlOutcome: "NO_STRUCTURAL_CHANGE" }),
    restoreToday: async () => ({ binding: BINDING, selectedPrematch: true,
      rosterMatchIds: today.map(({ ownerMatchId }) => ownerMatchId) }),
    ...overrides
  };
}

const terminals = (items: readonly { kind: string }[]) => items.filter(({ kind }) => kind === "TERMINAL");

function refreshed(value: SabaCollectorRosterOwner, clock: number,
  changes: Partial<SabaCollectorRosterOwner> = {}): SabaCollectorRosterOwner {
  return { ...value, capturedAtMs: 1_788_800_000_000 + clock,
    capturedMonotonicMs: clock, ...changes };
}

describe("SabaHiddenMarketCollector", () => {
  it("publishes both reconciled main rosters before any More action and keeps that proof after More fails", async () => {
    const today = [{ ...owner("today-main", "ELIGIBLE_MORE", 1),
      record: { ...record("today-main"), providerTimezoneOffsetMinutes: 420 } }];
    const early = [{ ...owner("early-main", "ELIGIBLE_MORE", 10),
      record: { ...record("early-main"), providerTimezoneOffsetMinutes: 420 } }];
    const page = adapter(today, early);
    const captureOwner = vi.spyOn(page, "captureOwner").mockRejectedValue(new Error("SABA_COLLECTOR_MORE_OPEN_NOT_STABLE"));
    const readRoster = vi.spyOn(page, "readRoster");
    const restoreToday = vi.spyOn(page, "restoreToday");
    const collector = new SabaHiddenMarketCollector({ collectorGeneration: GENERATION,
      binding: BINDING, adapter: page, publishMainRosterFirst: true });
    const main = await collector.advance(4, () => true);
    expect(captureOwner).not.toHaveBeenCalled();
    expect(readRoster.mock.calls.map(([period]) => period)).toEqual(["TODAY", "TODAY", "EARLY", "EARLY"]);
    expect(restoreToday).toHaveBeenCalledOnce();
    expect(main.mainRosterItems?.map(({ kind }) => kind)).toEqual(["CAPTURE", "CAPTURE", "MAIN_ROSTER_TERMINAL"]);
    expect(main.mainRosterItems?.filter((item) => item.kind === "CAPTURE")
      .map(({ capturedMonotonicMs }) => capturedMonotonicMs)).toEqual([1, 10]);
    expect(main.mainRosterItems?.at(-1)).toMatchObject({ collectorGeneration: `${GENERATION}:main`,
      hiddenMarketsComplete: false, owners: [{ period: "TODAY", ownerMatchId: "today-main" },
        { period: "EARLY", ownerMatchId: "early-main" }] });
    const failed = await collector.advance(4, () => true);
    expect(failed.status).toBe("SAFE_ERROR");
    expect(failed.mainRosterItems).toEqual(main.mainRosterItems);
    expect(terminals(failed.candidateItems)).toEqual([]);
  });

  it("emits an explicit complete empty main roster and refuses an unknown timezone", async () => {
    const empty = await new SabaHiddenMarketCollector({ collectorGeneration: GENERATION,
      binding: BINDING, adapter: adapter([], []), publishMainRosterFirst: true }).advance(4, () => true);
    expect(empty.mainRosterItems).toEqual([expect.objectContaining({ kind: "MAIN_ROSTER_TERMINAL",
      periods: [{ period: "TODAY", rosterMatchIds: [], rosterCount: 0 },
        { period: "EARLY", rosterMatchIds: [], rosterCount: 0 }] })]);
    const unproven = { ...owner("unproven", "NO_ELIGIBLE_CONTROL", 1),
      record: { ...record("unproven"), providerTimezoneOffsetMinutes: null } };
    const rejected = await new SabaHiddenMarketCollector({ collectorGeneration: GENERATION,
      binding: BINDING, adapter: adapter([unproven], []), publishMainRosterFirst: true }).advance(4, () => true);
    expect(rejected.status).toBe("SAFE_ERROR");
    expect(rejected.mainRosterItems).toBeUndefined();
  });

  it("keeps main and hidden terminals separate while reusing original roster clocks", async () => {
    const today = [{ ...owner("today", "NO_ELIGIBLE_CONTROL", 1),
      record: { ...record("today"), providerTimezoneOffsetMinutes: 480 } }];
    const early = [{ ...owner("early", "NO_ELIGIBLE_CONTROL", 10),
      record: { ...record("early"), providerTimezoneOffsetMinutes: 480 } }];
    const collector = new SabaHiddenMarketCollector({ collectorGeneration: GENERATION,
      binding: BINDING, adapter: adapter(today, early), publishMainRosterFirst: true });
    const main = await collector.advance(4, () => true);
    expect(collector.mainRosterComplete).toBe(true);
    expect(collector.hiddenMarketsComplete).toBe(false);
    const hidden = await collector.advance(4, () => true);
    expect(hidden.status).toBe("COMPLETE");
    expect(collector.hiddenMarketsComplete).toBe(true);
    expect(hidden.candidateItems.every((item) => item.collectorGeneration === GENERATION)).toBe(true);
    expect(hidden.candidateItems.map(({ kind }) => kind)).not.toContain("MAIN_ROSTER_TERMINAL");
    expect(hidden.candidateItems.filter((item) => item.kind === "CAPTURE")).toEqual(
      main.mainRosterItems!.filter((item) => item.kind === "CAPTURE")
        .map((item) => ({ ...item, collectorGeneration: GENERATION })));
  });

  it.each(["binding", "membership"] as const)("refuses main authority on changed %s during Today restoration", async (change) => {
    const today = [{ ...owner("today", "ELIGIBLE_MORE", 1),
      record: { ...record("today"), providerTimezoneOffsetMinutes: 420 } }];
    const page = adapter(today, [], { restoreToday: async () => ({
      binding: change === "binding" ? { ...BINDING, documentKey: "replacement" } : BINDING,
      selectedPrematch: true, rosterMatchIds: change === "membership" ? [] : ["today"] }) });
    const captureOwner = vi.spyOn(page, "captureOwner");
    const result = await new SabaHiddenMarketCollector({ collectorGeneration: GENERATION,
      binding: BINDING, adapter: page, publishMainRosterFirst: true }).advance(4, () => true);
    expect(result.status).toBe(change === "binding" ? "STALE_BINDING" : "SAFE_ERROR");
    expect(result.mainRosterItems).toBeUndefined();
    expect(captureOwner).not.toHaveBeenCalled();
  });
  it("completes 650 proven passive owners in two bounded slices with unchanged terminal membership and clocks", async () => {
    const early = Array.from({ length: 650 }, (_, index) => owner(`early-${index}`, "NO_ELIGIBLE_CONTROL", index + 1));
    const page = adapter([], early);
    const readRoster = vi.spyOn(page, "readRoster");
    const captureOwner = vi.spyOn(page, "captureOwner");
    const collector = new SabaHiddenMarketCollector({ collectorGeneration: GENERATION, binding: BINDING, adapter: page });
    const first = await collector.advance(4, () => true, { maxPassiveOwnersPerSlice: 512 });
    expect(first.status).toBe("INCOMPLETE");
    expect(first.items.filter(({ kind }) => kind === "OWNER_COMPLETE")).toHaveLength(512);
    const final = await collector.advance(4, () => true, { maxPassiveOwnersPerSlice: 512 });
    expect(final.status).toBe("COMPLETE");
    expect(readRoster).toHaveBeenCalledTimes(4);
    expect(captureOwner).not.toHaveBeenCalled();
    const reference = await new SabaHiddenMarketCollector({ collectorGeneration: GENERATION,
      binding: BINDING, adapter: adapter([], early) }).advance(1000);
    expect(final.candidateItems).toEqual(reference.candidateItems);
  });

  it("keeps the four actual More actions cap while bulk-completing mixed passive owners", async () => {
    const early = Array.from({ length: 100 }, (_, index) => owner(`early-${index}`,
      [1, 20, 40, 60, 80].includes(index) ? "ELIGIBLE_MORE" : "NO_ELIGIBLE_CONTROL", index + 1));
    const page = adapter([], early);
    const captureOwner = vi.spyOn(page, "captureOwner");
    const collector = new SabaHiddenMarketCollector({ collectorGeneration: GENERATION, binding: BINDING, adapter: page });
    const first = await collector.advance(4, () => true, { maxPassiveOwnersPerSlice: 512 });
    expect(first.status).toBe("INCOMPLETE");
    expect(captureOwner).toHaveBeenCalledTimes(4);
    expect(first.items.filter((item) => item.kind === "OWNER_COMPLETE" &&
      item.safeControlOutcome === "NO_ELIGIBLE_CONTROL")).toHaveLength(76);
    expect((await collector.advance(4, () => true, { maxPassiveOwnersPerSlice: 512 })).status).toBe("COMPLETE");
    expect(captureOwner).toHaveBeenCalledTimes(5);
  });
  it("reconciles the actual 20-to-253 Early growth before completing the period", async () => {
    const initial = Array.from({ length: 20 }, (_, index) =>
      owner(`early-${index}`, "NO_ELIGIBLE_CONTROL", 100));
    const expanded = Array.from({ length: 253 }, (_, index) =>
      owner(`early-${index}`, "NO_ELIGIBLE_CONTROL", index < 20 ? 200 : 300));
    let earlyReads = 0;
    const page = adapter([], initial, { readRoster: async (period) => {
      const owners = period === "TODAY" ? [] : earlyReads++ === 0 ? initial : earlyReads === 2 ?
        expanded : expanded.map((value) => refreshed(value, 400));
      return { binding: BINDING, period, selectedPrematch: true, owners };
    } });
    const collector = new SabaHiddenMarketCollector({ collectorGeneration: GENERATION,
      binding: BINDING, adapter: page });

    const result = await collector.advance(300);
    const captures = result.candidateItems.filter((item) => item.kind === "CAPTURE");
    const completed = result.candidateItems.filter((item) => item.kind === "OWNER_COMPLETE");

    expect(result.status).toBe("COMPLETE");
    expect(captures).toHaveLength(253);
    expect(captures.map(({ ownerMatchId }) => ownerMatchId)).toEqual(
      Array.from({ length: 253 }, (_, index) => `early-${index}`));
    expect(captures.map(({ captureOrdinal }) => captureOrdinal)).toEqual(
      Array.from({ length: 253 }, (_, index) => index));
    expect(completed).toHaveLength(253);
    expect(new Set(completed.map(({ ownerMatchId }) => ownerMatchId)).size).toBe(253);
    expect(terminals(result.candidateItems)).toHaveLength(1);
    expect(earlyReads).toBe(3);
  });

  it("appends reordered and interleaved growth twice without replaying completed owners", async () => {
    const a = owner("early-a", "ELIGIBLE_MORE", 1);
    const b = owner("early-b", "ELIGIBLE_MORE", 1);
    const c = owner("early-c", "ELIGIBLE_MORE", 10);
    const d = owner("early-d", "ELIGIBLE_MORE", 20);
    const earlyRosters = [
      [a, b],
      [refreshed(b, 10, { record: record("early-b", "changed-price-group") }), c, refreshed(a, 10)],
      [d, refreshed(b, 20), refreshed(a, 20), refreshed(c, 20)],
      [refreshed(c, 30), refreshed(d, 30), refreshed(a, 30), refreshed(b, 30)]
    ];
    let earlyRead = 0;
    const captureOwner = vi.fn<SabaCollectorPageAdapter["captureOwner"]>(async (period, item) => ({
      binding: BINDING, period, ownerMatchId: item.ownerMatchId, controlOpened: true,
      terminalControlState: "RESTORED_CLOSED", restored: true,
      safeControlOutcome: "NO_STRUCTURAL_CHANGE"
    }));
    const page = adapter([], earlyRosters[0]!, { readRoster: async (period) => ({ binding: BINDING,
      period, selectedPrematch: true,
      owners: period === "TODAY" ? [] : earlyRosters[Math.min(earlyRead++, earlyRosters.length - 1)]!
    }), captureOwner });

    const result = await new SabaHiddenMarketCollector({ collectorGeneration: GENERATION,
      binding: BINDING, adapter: page }).advance(10);
    const captures = result.candidateItems.filter((item) => item.kind === "CAPTURE");

    expect(result.status).toBe("COMPLETE");
    expect(captures.map(({ ownerMatchId, capturedMonotonicMs }) =>
      [ownerMatchId, capturedMonotonicMs])).toEqual([
      ["early-a", 1], ["early-b", 1], ["early-c", 10], ["early-d", 20]
    ]);
    expect(captureOwner.mock.calls.map(([, item]) => item.ownerMatchId))
      .toEqual(["early-a", "early-b", "early-c", "early-d"]);
    expect(terminals(result.candidateItems)).toHaveLength(1);
  });

  it("accepts exact Today membership restoration when progressive owners reorder", async () => {
    const a = owner("today-a", "NO_ELIGIBLE_CONTROL", 1);
    const b = owner("today-b", "NO_ELIGIBLE_CONTROL", 1);
    const c = owner("today-c", "NO_ELIGIBLE_CONTROL", 10);
    let reads = 0;
    const page = adapter([a, b], [], { readRoster: async (period) => ({ binding: BINDING, period,
      selectedPrematch: true, owners: period === "EARLY" ? [] : reads++ === 0 ? [a, b] :
        [refreshed(b, 10), refreshed(c, 10), refreshed(a, 10)]
    }), restoreToday: async () => ({ binding: BINDING, selectedPrematch: true,
      rosterMatchIds: ["today-b", "today-c", "today-a"] }) });

    const result = await new SabaHiddenMarketCollector({ collectorGeneration: GENERATION,
      binding: BINDING, adapter: page }).advance(10);

    expect(result.status).toBe("COMPLETE");
    expect(terminals(result.candidateItems)).toHaveLength(1);
  });

  it("checks the optional continuation budget after reads and only between atomic owners", async () => {
    const today = [owner("today-a", "ELIGIBLE_MORE", 1), owner("today-b", "ELIGIBLE_MORE", 1)];
    const calls: string[] = [];
    let withinBudget = true;
    let rosterReads = 0;
    const page = adapter(today, [], { readRoster: async (period) => {
      rosterReads += 1;
      return { binding: BINDING, period, selectedPrematch: true,
        owners: period === "TODAY" ? today : [] };
    }, captureOwner: async (period, item) => {
      calls.push(item.ownerMatchId);
      withinBudget = false;
      return { binding: BINDING, period, ownerMatchId: item.ownerMatchId, controlOpened: true,
        terminalControlState: "RESTORED_CLOSED", restored: true,
        safeControlOutcome: "NO_STRUCTURAL_CHANGE" };
    } });
    const collector = new SabaHiddenMarketCollector({ collectorGeneration: GENERATION,
      binding: BINDING, adapter: page });

    const first = await collector.advance(4, () => withinBudget);

    expect(collector.currentPeriod).toBe("TODAY");
    expect(first.status).toBe("INCOMPLETE");
    expect(calls).toEqual(["today-a"]);
    expect(rosterReads).toBe(1);
    expect(first.candidateItems.filter((item) => item.kind === "PERIOD_COMPLETE")).toEqual([]);
    const second = await collector.advance(4);
    expect(second.status).toBe("COMPLETE");
    expect(calls).toEqual(["today-a", "today-b"]);
    expect(collector.currentPeriod).toBeNull();
  });

  it("does not complete a reconciled period when the budget expires during its roster read", async () => {
    let reads = 0;
    let withinBudget = true;
    const collector = new SabaHiddenMarketCollector({ collectorGeneration: GENERATION,
      binding: BINDING, adapter: adapter([], [], { readRoster: async (period) => {
        reads += 1;
        if (reads === 2) withinBudget = false;
        return { binding: BINDING, period, selectedPrematch: true, owners: [] };
      } }) });

    const first = await collector.advance(1, () => withinBudget);

    expect(first.status).toBe("INCOMPLETE");
    expect(first.candidateItems.some((item) => item.kind === "PERIOD_COMPLETE")).toBe(false);
    expect(first.candidateItems.some((item) => item.kind === "TERMINAL")).toBe(false);
    expect(collector.currentPeriod).toBe("TODAY");
    expect((await collector.advance(1)).status).toBe("COMPLETE");
  });

  it("finalizes validated no-growth reconciliation on a later fresh budget", async () => {
    const today = [owner("today-a", "NO_ELIGIBLE_CONTROL", 1)];
    const early = [owner("early-a", "NO_ELIGIBLE_CONTROL", 2)];
    const reads = new Map<SabaCollectorPeriod, number>();
    let withinBudget = true;
    const page = adapter(today, early, { readRoster: async (period) => {
      const read = reads.get(period) ?? 0;
      reads.set(period, read + 1);
      if (read > 0) withinBudget = false;
      const values = period === "TODAY" ? today : early;
      return { binding: BINDING, period, selectedPrematch: true,
        owners: values.map((value) => refreshed(value, 10 + read)) };
    } });
    const collector = new SabaHiddenMarketCollector({ collectorGeneration: GENERATION,
      binding: BINDING, adapter: page });

    const runSlice = async () => {
      withinBudget = true;
      return collector.advance(10, () => withinBudget);
    };
    const first = await runSlice();
    const second = await runSlice();
    const third = await runSlice();

    expect(first.status).toBe("INCOMPLETE");
    expect(second.status).toBe("INCOMPLETE");
    expect(third.status).toBe("COMPLETE");
    expect(reads).toEqual(new Map<SabaCollectorPeriod, number>([["TODAY", 2], ["EARLY", 2]]));
    expect(terminals(third.candidateItems)).toHaveLength(1);
  });

  it("does not finalize pending no-growth reconciliation after source retirement", async () => {
    const today = [owner("today-a", "NO_ELIGIBLE_CONTROL", 1)];
    let withinBudget = true;
    let reads = 0;
    const page = adapter(today, [], { readRoster: async (period) => {
      reads += 1;
      if (reads === 2) withinBudget = false;
      return { binding: BINDING, period, selectedPrematch: true,
        owners: period === "TODAY" ? today.map((value) => refreshed(value, reads + 1)) : [] };
    } });
    const collector = new SabaHiddenMarketCollector({ collectorGeneration: GENERATION,
      binding: BINDING, adapter: page });

    expect((await collector.advance(10, () => withinBudget)).status).toBe("INCOMPLETE");
    const readsBeforeRetirement = reads;
    const retired = await collector.advance(10, () => false);

    expect(retired.status).toBe("INCOMPLETE");
    expect(retired.candidateItems.some((item) => item.kind === "PERIOD_COMPLETE")).toBe(false);
    expect(terminals(retired.candidateItems)).toEqual([]);
    expect(reads).toBe(readsBeforeRetirement);
  });

  it("fails closed when progressive reconciliation removes, duplicates or changes an owner", async () => {
    const a = owner("today-a", "ELIGIBLE_MORE", 1);
    const b = owner("today-b", "ELIGIBLE_MORE", 10);
    const cases: readonly [string, readonly SabaCollectorRosterOwner[]][] = [
      ["removed", []],
      ["duplicate", [refreshed(a, 10), refreshed(a, 10)]],
      ["identity", [refreshed(a, 10, { record: { ...a.record, leagueName: "Other League" } })]],
      ["control", [refreshed(a, 10, { control: "NO_ELIGIBLE_CONTROL" })]],
      ["date", [refreshed(a, 10, {
        kickoffDate: { kind: "EXPLICIT", isoDate: "2026-09-09" }
      })]],
      ["clock", [refreshed(a, 10), refreshed(b, Number.NaN)]],
      ["unsafe control", [refreshed(a, 10),
        refreshed(b, 10, { control: "OPEN_MORE" as never })]]
    ];

    for (const [name, reconciled] of cases) {
      let reads = 0;
      const page = adapter([a], [], { readRoster: async (period) => ({ binding: BINDING, period,
        selectedPrematch: true,
        owners: period === "EARLY" ? [] : reads++ === 0 ? [a] : reconciled
      }) });
      const collector = new SabaHiddenMarketCollector({ collectorGeneration: `${GENERATION}:${name}`,
        binding: BINDING, adapter: page });

      const result = await collector.advance(10);

      expect(result, name).toMatchObject({ status: "SAFE_ERROR", error: "ROSTER_UNCONFIRMED" });
      expect(result.candidateItems.filter((item) => item.kind === "OWNER_COMPLETE"), name).toHaveLength(1);
      expect(result.candidateItems.some((item) => item.kind === "PERIOD_COMPLETE"), name).toBe(false);
      expect(terminals(result.candidateItems), name).toEqual([]);
    }
  });

  it("freezes a stale binding returned by progressive reconciliation", async () => {
    const a = owner("today-a", "NO_ELIGIBLE_CONTROL", 1);
    let reads = 0;
    const page = adapter([a], [], { readRoster: async (period) => ({
      binding: reads++ === 0 ? BINDING : { ...BINDING, documentKey: "replacement-document" },
      period, selectedPrematch: true, owners: [refreshed(a, 10)]
    }) });
    const collector = new SabaHiddenMarketCollector({ collectorGeneration: GENERATION,
      binding: BINDING, adapter: page });

    const result = await collector.advance(10);

    expect(result).toMatchObject({ status: "STALE_BINDING", error: "BINDING_CHANGED" });
    expect(result.candidateItems.filter((item) => item.kind === "OWNER_COMPLETE")).toHaveLength(1);
    expect(result.candidateItems.some((item) => item.kind === "PERIOD_COMPLETE")).toBe(false);
    expect(terminals(result.candidateItems)).toEqual([]);
  });

  it("resumes 289 owners over bounded slices and more than 60 seconds without an owner ceiling", async () => {
    const today = Array.from({ length: 37 }, (_, index) =>
      owner(`today-${index}`, index < 35 ? "ELIGIBLE_MORE" : "NO_ELIGIBLE_CONTROL", index * 1_000));
    const early = Array.from({ length: 252 }, (_, index) =>
      owner(`early-${index}`, index < 188 ? "ELIGIBLE_MORE" : "NO_ELIGIBLE_CONTROL",
        (index + today.length) * 1_000));
    const page = adapter(today, early);
    const collector = new SabaHiddenMarketCollector({ collectorGeneration: GENERATION,
      binding: BINDING, adapter: page });
    const emitted: Array<{ kind: string; captureOrdinal?: number; capturedMonotonicMs?: number }> = [];
    let result = await collector.advance(17);
    emitted.push(...result.items);
    while (result.status === "INCOMPLETE") {
      result = await collector.advance(17);
      emitted.push(...result.items);
    }

    expect(result.status).toBe("COMPLETE");
    expect(terminals(emitted)).toHaveLength(1);
    const captures = emitted.filter((item) => item.kind === "CAPTURE");
    expect(captures).toHaveLength(289);
    expect(captures.map(({ captureOrdinal }) => captureOrdinal))
      .toEqual(Array.from({ length: 289 }, (_, index) => index));
    expect(captures.at(-1)?.capturedMonotonicMs).toBe(288_000);
    expect(await collector.advance(17)).toMatchObject({ status: "COMPLETE", items: [] });
  });

  it("completes roster-only owners with NO_ELIGIBLE_CONTROL without calling captureOwner", async () => {
    const captureOwner = vi.fn<SabaCollectorPageAdapter["captureOwner"]>();
    const today = [owner("today-roster", "NO_ELIGIBLE_CONTROL", 10)];
    const early = [owner("early-roster", "NO_ELIGIBLE_CONTROL", 20)];
    const collector = new SabaHiddenMarketCollector({ collectorGeneration: GENERATION,
      binding: BINDING, adapter: adapter(today, early, { captureOwner }) });

    const result = await collector.advance(2);

    expect(captureOwner).not.toHaveBeenCalled();
    expect(result.status).toBe("COMPLETE");
    expect(result.candidateItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "OWNER_COMPLETE", period: "TODAY",
        ownerMatchId: "today-roster", safeControlOutcome: "NO_ELIGIBLE_CONTROL", restored: true }),
      expect.objectContaining({ kind: "OWNER_COMPLETE", period: "EARLY",
        ownerMatchId: "early-roster", safeControlOutcome: "NO_ELIGIBLE_CONTROL", restored: true })
    ]));
  });

  it("does not emit a terminal until both period rosters and every owner are complete", async () => {
    const today = [owner("today-1", "NO_ELIGIBLE_CONTROL", 1),
      owner("today-2", "NO_ELIGIBLE_CONTROL", 2)];
    const early = [owner("early-1", "NO_ELIGIBLE_CONTROL", 3)];
    const collector = new SabaHiddenMarketCollector({ collectorGeneration: GENERATION,
      binding: BINDING, adapter: adapter(today, early) });

    const first = await collector.advance(1);
    const second = await collector.advance(1);
    const third = await collector.advance(1);

    expect(first.status).toBe("INCOMPLETE");
    expect(second.status).toBe("INCOMPLETE");
    expect(terminals([...first.items, ...second.items])).toEqual([]);
    expect(third.status).toBe("COMPLETE");
    expect(terminals(third.items)).toHaveLength(1);
  });

  it("freezes a stale binding without a terminal and preserves the safe candidate", async () => {
    const today = [owner("today-1", "NO_ELIGIBLE_CONTROL", 1)];
    const early = [owner("early-1", "ELIGIBLE_MORE", 2)];
    const page = adapter(today, early, { captureOwner: async (period, rosterOwner) => ({
      binding: { ...BINDING, documentKey: "late-document" }, period,
      ownerMatchId: rosterOwner.ownerMatchId, controlOpened: true,
      terminalControlState: "RESTORED_CLOSED", restored: true,
      safeControlOutcome: "NO_STRUCTURAL_CHANGE"
    }) });
    const collector = new SabaHiddenMarketCollector({ collectorGeneration: GENERATION,
      binding: BINDING, adapter: page });

    const result = await collector.advance(2);

    expect(result).toMatchObject({ status: "STALE_BINDING", error: "BINDING_CHANGED" });
    expect(terminals(result.candidateItems)).toEqual([]);
    expect(result.candidateItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "PERIOD_COMPLETE", period: "TODAY" }),
      expect.objectContaining({ kind: "CAPTURE", ownerMatchId: "early-1" })
    ]));
    expect(await collector.advance(2)).toMatchObject({ status: "STALE_BINDING", items: [] });
  });

  it("never emits a terminal after failed owner or Today restoration proof", async () => {
    const today = [owner("today-1", "ELIGIBLE_MORE", 1)];
    const early = [owner("early-1", "NO_ELIGIBLE_CONTROL", 2)];
    const failedOwner = new SabaHiddenMarketCollector({ collectorGeneration: GENERATION,
      binding: BINDING, adapter: adapter(today, early, { captureOwner: async (period, item) => ({
        binding: BINDING, period, ownerMatchId: item.ownerMatchId, controlOpened: true,
        terminalControlState: "RESTORED_CLOSED", restored: false,
        safeControlOutcome: "NO_STRUCTURAL_CHANGE"
      } as never) }) });
    const ownerResult = await failedOwner.advance(2);
    expect(ownerResult).toMatchObject({ status: "SAFE_ERROR", error: "OWNER_CAPTURE_UNSAFE" });
    expect(terminals(ownerResult.candidateItems)).toEqual([]);

    const failedRestore = new SabaHiddenMarketCollector({ collectorGeneration: GENERATION,
      binding: BINDING, adapter: adapter(today, early, {
        restoreToday: async () => ({ binding: BINDING, selectedPrematch: false,
          rosterMatchIds: ["today-1"] } as never)
      }) });
    const restoreResult = await failedRestore.advance(2);
    expect(restoreResult).toMatchObject({ status: "SAFE_ERROR", error: "TODAY_RESTORE_UNCONFIRMED" });
    expect(terminals(restoreResult.candidateItems)).toEqual([]);
  });

  it("copies acquisition clocks unchanged and emits structural capture immediately after its roster source", async () => {
    const today = [{ ...owner("today-1", "ELIGIBLE_MORE", 111), capturedMonotonicMs: 123.5 }];
    const early: SabaCollectorRosterOwner[] = [];
    const page = adapter(today, early, { captureOwner: async (period, rosterOwner) => ({
      binding: BINDING, period, ownerMatchId: rosterOwner.ownerMatchId, controlOpened: true,
      terminalControlState: "RESTORED_CLOSED", restored: true,
      safeControlOutcome: "OWNER_GROUPS_EXPANDED", capture: {
        record: record(rosterOwner.ownerMatchId, "expanded"), kickoffDate: { kind: "UNKNOWN" },
        capturedAtMs: 1_788_899_999_999, capturedMonotonicMs: 99_999
      }
    }) });
    const result = await new SabaHiddenMarketCollector({ collectorGeneration: GENERATION,
      binding: BINDING, adapter: page }).advance(1);
    const captures = result.candidateItems.filter((item) => item.kind === "CAPTURE");

    expect(captures).toMatchObject([
      { captureKind: "ROSTER", captureOrdinal: 0, capturedAtMs: 1_788_800_000_111,
        capturedMonotonicMs: 123.5 },
      { captureKind: "OWNER_GROUPS_EXPANDED", captureOrdinal: 1,
        capturedAtMs: 1_788_899_999_999, capturedMonotonicMs: 99_999 }
    ]);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -0.5])(
    "freezes an invalid monotonic read clock %s without a terminal", async (capturedMonotonicMs) => {
      const today = [{ ...owner("today-invalid", "NO_ELIGIBLE_CONTROL", 1), capturedMonotonicMs }];
      const collector = new SabaHiddenMarketCollector({ collectorGeneration: GENERATION,
        binding: BINDING, adapter: adapter(today, []) });

      const result = await collector.advance(1);

      expect(result).toMatchObject({ status: "SAFE_ERROR", error: "ROSTER_UNCONFIRMED" });
      expect(terminals(result.candidateItems)).toEqual([]);
    });

  it("freezes backward monotonic clocks before an invalid ordinal can be emitted", async () => {
    const today = [{ ...owner("today-1", "NO_ELIGIBLE_CONTROL", 1), capturedMonotonicMs: 20 },
      { ...owner("today-2", "NO_ELIGIBLE_CONTROL", 2), capturedMonotonicMs: 10 }];
    const collector = new SabaHiddenMarketCollector({ collectorGeneration: GENERATION,
      binding: BINDING, adapter: adapter(today, []) });

    const result = await collector.advance(2);

    expect(result).toMatchObject({ status: "SAFE_ERROR", error: "ROSTER_UNCONFIRMED" });
    expect(result.candidateItems.filter((item) => item.kind === "CAPTURE")).toEqual([]);
    expect(terminals(result.candidateItems)).toEqual([]);
  });

  it("serializes reentrant advance calls so page adapter operations never overlap", async () => {
    const today = [owner("today-1", "ELIGIBLE_MORE", 1), owner("today-2", "ELIGIBLE_MORE", 2)];
    const early: SabaCollectorRosterOwner[] = [];
    let active = 0;
    let maxActive = 0;
    const page = adapter(today, early, { captureOwner: async (period, rosterOwner) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active -= 1;
      return { binding: BINDING, period, ownerMatchId: rosterOwner.ownerMatchId,
        controlOpened: true, terminalControlState: "RESTORED_CLOSED", restored: true,
        safeControlOutcome: "NO_STRUCTURAL_CHANGE" };
    } });
    const collector = new SabaHiddenMarketCollector({ collectorGeneration: GENERATION,
      binding: BINDING, adapter: page });

    const [first, second] = await Promise.all([collector.advance(1), collector.advance(1)]);
    const third = await collector.advance(1);

    expect(maxActive).toBe(1);
    expect(first.status).toBe("INCOMPLETE");
    expect(second.status).toBe("INCOMPLETE");
    expect(third.status).toBe("COMPLETE");
  });

  it("resumes the same timed-out owner after verified Today restoration without duplicate captures", async () => {
    const today = [owner("today-timeout", "ELIGIBLE_MORE", 1)];
    let attempts = 0;
    const captureOwner = vi.fn<SabaCollectorPageAdapter["captureOwner"]>(async (period, rosterOwner) => {
      attempts += 1;
      if (attempts === 1) throw new Error("SABA_COLLECTOR_FRAME_COMMAND_TIMEOUT");
      return { binding: BINDING, period, ownerMatchId: rosterOwner.ownerMatchId,
        controlOpened: true, terminalControlState: "RESTORED_CLOSED", restored: true,
        safeControlOutcome: "OWNER_GROUPS_EXPANDED", capture: {
          record: record(rosterOwner.ownerMatchId, "retried-market"), kickoffDate: { kind: "UNKNOWN" },
          capturedAtMs: 1_788_800_000_010, capturedMonotonicMs: 10
        } };
    });
    const collector = new SabaHiddenMarketCollector({ collectorGeneration: GENERATION,
      binding: BINDING, adapter: adapter(today, [], { captureOwner }) });

    const failed = await collector.advance(1);
    expect(failed).toMatchObject({ status: "SAFE_ERROR", error: "ADAPTER_ERROR" });
    expect(collector.resumeAfterVerifiedTodayRestore({ binding: BINDING, selectedPrematch: true,
      rosterMatchIds: ["today-timeout"] })).toBe(true);
    const retried = await collector.advance(1);

    expect(captureOwner).toHaveBeenCalledTimes(2);
    expect(captureOwner.mock.calls.map(([, item]) => item.ownerMatchId))
      .toEqual(["today-timeout", "today-timeout"]);
    expect(retried.candidateItems.filter((item) => item.kind === "CAPTURE")).toMatchObject([
      { ownerMatchId: "today-timeout", captureKind: "ROSTER", captureOrdinal: 0 },
      { ownerMatchId: "today-timeout", captureKind: "OWNER_GROUPS_EXPANDED", captureOrdinal: 1 }
    ]);
    expect(retried.candidateItems.filter((item) => item.kind === "OWNER_COMPLETE"))
      .toHaveLength(1);
  });

  it("resumes owner preparation timeout on the same owner without replaying completed owners", async () => {
    const today = [owner("today-complete", "NO_ELIGIBLE_CONTROL", 1),
      owner("today-preparing", "ELIGIBLE_MORE", 2)];
    let attempts = 0;
    const captureOwner = vi.fn<SabaCollectorPageAdapter["captureOwner"]>(async (period, item) => {
      attempts += 1;
      if (attempts === 1) throw new Error("SABA_COLLECTOR_OWNER_PREPARATION_TIMEOUT");
      return { binding: BINDING, period, ownerMatchId: item.ownerMatchId, controlOpened: true,
        terminalControlState: "RESTORED_CLOSED", restored: true,
        safeControlOutcome: "NO_STRUCTURAL_CHANGE" };
    });
    const collector = new SabaHiddenMarketCollector({ collectorGeneration: GENERATION,
      binding: BINDING, adapter: adapter(today, [], { captureOwner }) });

    const failed = await collector.advance(10);

    expect(failed.candidateItems.filter((item) => item.kind === "OWNER_COMPLETE")
      .map((item) => item.ownerMatchId)).toEqual(["today-complete"]);
    expect(collector.resumeAfterVerifiedTodayRestore({
      binding: { ...BINDING, documentKey: "replacement-document" }, selectedPrematch: true,
      rosterMatchIds: ["today-complete", "today-preparing"] })).toBe(false);
    expect(collector.resumeAfterVerifiedTodayRestore({ binding: BINDING, selectedPrematch: true,
      rosterMatchIds: ["today-complete"] })).toBe(false);
    expect(collector.resumeAfterVerifiedTodayRestore({ binding: BINDING, selectedPrematch: true,
      rosterMatchIds: ["today-complete", "today-preparing"] })).toBe(true);

    const retried = await collector.advance(10);

    expect(retried.status).toBe("COMPLETE");
    expect(captureOwner).toHaveBeenCalledTimes(2);
    expect(captureOwner.mock.calls.every(([, item]) => item.ownerMatchId === "today-preparing"))
      .toBe(true);
    expect(retried.candidateItems.filter((item) => item.kind === "OWNER_COMPLETE")
      .map((item) => item.ownerMatchId)).toEqual(["today-complete", "today-preparing"]);
    expect(retried.candidateItems.filter((item) => item.kind === "CAPTURE")).toHaveLength(2);
  });

  it.each(["SABA_COLLECTOR_FRAME_COMMAND_TIMEOUT", "SABA_COLLECTOR_OPERATION_DEADLINE"])(
    "resumes an Early initial roster read after %s without replaying retained Today owners",
    async (message) => {
      const today = Array.from({ length: 8 }, (_, index) =>
        owner(`today-${index}`, "NO_ELIGIBLE_CONTROL", index + 1));
      const early = [owner("early-a", "NO_ELIGIBLE_CONTROL", 20)];
      const reads = new Map<SabaCollectorPeriod, number>();
      let earlyAttempts = 0;
      const page = adapter(today, early, { readRoster: async (period) => {
        reads.set(period, (reads.get(period) ?? 0) + 1);
        if (period === "EARLY" && earlyAttempts++ === 0) throw new Error(message);
        const values = period === "TODAY" ? today : early;
        return { binding: BINDING, period, selectedPrematch: true,
          owners: values.map((value) => refreshed(value, period === "TODAY" ? 10 : 20)) };
      } });
      const collector = new SabaHiddenMarketCollector({ collectorGeneration: `${GENERATION}:${message}`,
        binding: BINDING, adapter: page });

      const failed = await collector.advance(20);

      expect(failed).toMatchObject({ status: "SAFE_ERROR", error: "ADAPTER_ERROR" });
      expect(failed.candidateItems.filter((item) => item.kind === "CAPTURE")).toHaveLength(8);
      expect(failed.candidateItems.filter((item) => item.kind === "OWNER_COMPLETE")).toHaveLength(8);
      expect(terminals(failed.candidateItems)).toEqual([]);
      expect(collector.resumeAfterVerifiedTodayRestore({ binding: BINDING, selectedPrematch: true,
        rosterMatchIds: today.map(({ ownerMatchId }) => ownerMatchId) })).toBe(true);
      expect(terminals(failed.candidateItems)).toEqual([]);

      const retried = await collector.advance(20);

      expect(retried.status).toBe("COMPLETE");
      expect(reads.get("TODAY")).toBe(2);
      expect(retried.candidateItems.filter((item) => item.kind === "CAPTURE")).toHaveLength(9);
      expect(new Set(retried.candidateItems.filter((item) => item.kind === "CAPTURE")
        .map((item) => item.ownerMatchId)).size).toBe(9);
      expect(terminals(retried.candidateItems)).toHaveLength(1);
    });

  it("rejects stale restoration and changed Today membership for an Early roster timeout", async () => {
    const today = [owner("today-a", "NO_ELIGIBLE_CONTROL", 1),
      owner("today-b", "NO_ELIGIBLE_CONTROL", 2)];
    const collector = new SabaHiddenMarketCollector({ collectorGeneration: GENERATION,
      binding: BINDING, adapter: adapter(today, [], { readRoster: async (period) => {
        if (period === "EARLY") throw new Error("SABA_COLLECTOR_OPERATION_DEADLINE");
        return { binding: BINDING, period, selectedPrematch: true,
          owners: today.map((value) => refreshed(value, 10)) };
      } }) });
    await collector.advance(10);

    expect(collector.resumeAfterVerifiedTodayRestore({
      binding: { ...BINDING, documentKey: "replacement-document" }, selectedPrematch: true,
      rosterMatchIds: ["today-a", "today-b"] })).toBe(false);
    expect(collector.resumeAfterVerifiedTodayRestore({ binding: BINDING, selectedPrematch: true,
      rosterMatchIds: ["today-a"] })).toBe(false);
    expect(collector.resumeAfterVerifiedTodayRestore({ binding: BINDING, selectedPrematch: true,
      rosterMatchIds: ["today-a", "today-a"] })).toBe(false);
    expect(collector.resumeAfterVerifiedTodayRestore({ binding: BINDING, selectedPrematch: true,
      rosterMatchIds: ["today-b", "today-a"] })).toBe(true);
  });

  it("resumes a reconciliation timeout without completing the period before a fresh read", async () => {
    const today = [owner("today-a", "NO_ELIGIBLE_CONTROL", 1)];
    let todayReads = 0;
    const collector = new SabaHiddenMarketCollector({ collectorGeneration: GENERATION,
      binding: BINDING, adapter: adapter(today, [], { readRoster: async (period) => {
        if (period === "EARLY") {
          return { binding: BINDING, period, selectedPrematch: true, owners: [] };
        }
        todayReads += 1;
        if (todayReads === 2) throw new Error("SABA_COLLECTOR_FRAME_COMMAND_TIMEOUT");
        return { binding: BINDING, period, selectedPrematch: true,
          owners: today.map((value) => refreshed(value, todayReads + 1)) };
      } }) });

    const failed = await collector.advance(10);

    expect(failed.candidateItems.filter((item) => item.kind === "OWNER_COMPLETE")).toHaveLength(1);
    expect(failed.candidateItems.some((item) => item.kind === "PERIOD_COMPLETE")).toBe(false);
    expect(collector.resumeAfterVerifiedTodayRestore({ binding: BINDING, selectedPrematch: true,
      rosterMatchIds: ["today-a"] })).toBe(true);
    expect(failed.candidateItems.some((item) => item.kind === "PERIOD_COMPLETE")).toBe(false);

    const retried = await collector.advance(10);

    expect(retried.status).toBe("COMPLETE");
    expect(todayReads).toBe(3);
    expect(retried.candidateItems.filter((item) => item.kind === "CAPTURE")).toHaveLength(1);
  });

  it("limits roster-read timeout resumes to two attempts per period and stage", async () => {
    const today = [owner("today-a", "NO_ELIGIBLE_CONTROL", 1)];
    const collector = new SabaHiddenMarketCollector({ collectorGeneration: GENERATION,
      binding: BINDING, adapter: adapter(today, [], { readRoster: async (period) => {
        if (period === "EARLY") throw new Error("SABA_COLLECTOR_OPERATION_DEADLINE");
        return { binding: BINDING, period, selectedPrematch: true,
          owners: today.map((value) => refreshed(value, 10)) };
      } }) });
    const restoration = { binding: BINDING, selectedPrematch: true as const,
      rosterMatchIds: ["today-a"] };

    await collector.advance(10);
    expect(collector.resumeAfterVerifiedTodayRestore(restoration)).toBe(true);
    await collector.advance(10);
    expect(collector.resumeAfterVerifiedTodayRestore(restoration)).toBe(true);
    await collector.advance(10);
    expect(collector.resumeAfterVerifiedTodayRestore(restoration)).toBe(false);
    expect(terminals((await collector.advance(10)).candidateItems)).toEqual([]);
  });

  it("explicitly resumes an initial Today roster timeout only before any captures", async () => {
    let attempts = 0;
    const collector = new SabaHiddenMarketCollector({ collectorGeneration: GENERATION,
      binding: BINDING, adapter: adapter([], [], { readRoster: async (period) => {
        if (attempts++ === 0) throw new Error("SABA_COLLECTOR_FRAME_COMMAND_TIMEOUT");
        return { binding: BINDING, period, selectedPrematch: true, owners: [] };
      } }) });

    const failed = await collector.advance(10);
    expect(failed.candidateItems).toEqual([]);
    expect(collector.resumeAfterVerifiedTodayRestore({ binding: BINDING, selectedPrematch: true,
      rosterMatchIds: [] })).toBe(true);
    expect((await collector.advance(10)).status).toBe("COMPLETE");
  });

  it("does not resume an owner OPERATION_DEADLINE as a safe roster-read retry", async () => {
    const today = [owner("today-timeout", "ELIGIBLE_MORE", 1)];
    const collector = new SabaHiddenMarketCollector({ collectorGeneration: GENERATION,
      binding: BINDING, adapter: adapter(today, [], { captureOwner: async () => {
        throw new Error("SABA_COLLECTOR_OPERATION_DEADLINE");
      } }) });

    await collector.advance(1);

    expect(collector.resumeAfterVerifiedTodayRestore({ binding: BINDING, selectedPrematch: true,
      rosterMatchIds: ["today-timeout"] })).toBe(false);
  });

  it.each(["SABA_COLLECTOR_FRAME_COMMAND_TIMEOUT",
    "SABA_COLLECTOR_OWNER_PREPARATION_TIMEOUT"])(
    "limits verified %s resumes to two attempts for the same owner", async (message) => {
    const today = [owner("today-timeout", "ELIGIBLE_MORE", 1)];
    const captureOwner = vi.fn<SabaCollectorPageAdapter["captureOwner"]>(async () => {
      throw new Error(message);
    });
    const collector = new SabaHiddenMarketCollector({ collectorGeneration: GENERATION,
      binding: BINDING, adapter: adapter(today, [], { captureOwner }) });
    const restoration = { binding: BINDING, selectedPrematch: true as const,
      rosterMatchIds: ["today-timeout"] };

    await collector.advance(1);
    expect(collector.resumeAfterVerifiedTodayRestore(restoration)).toBe(true);
    await collector.advance(1);
    expect(collector.resumeAfterVerifiedTodayRestore(restoration)).toBe(true);
    await collector.advance(1);
    expect(collector.resumeAfterVerifiedTodayRestore(restoration)).toBe(false);
    await collector.advance(1);

    expect(captureOwner).toHaveBeenCalledTimes(3);
  });

  it("requires exact unique stored Today authority before admitting a timeout resume", async () => {
    const today = [owner("today-a", "ELIGIBLE_MORE", 1), owner("today-b", "ELIGIBLE_MORE", 2)];
    const captureOwner = vi.fn<SabaCollectorPageAdapter["captureOwner"]>(async () => {
      throw new Error("SABA_COLLECTOR_FRAME_COMMAND_TIMEOUT");
    });
    const collector = new SabaHiddenMarketCollector({ collectorGeneration: GENERATION,
      binding: BINDING, adapter: adapter(today, [], { captureOwner }) });
    await collector.advance(1);

    expect(collector.resumeAfterVerifiedTodayRestore({ binding: { ...BINDING, documentKey: "other" },
      selectedPrematch: true, rosterMatchIds: ["today-a", "today-b"] })).toBe(false);
    expect(collector.resumeAfterVerifiedTodayRestore({ binding: BINDING, selectedPrematch: false,
      rosterMatchIds: ["today-a", "today-b"] } as never)).toBe(false);
    expect(collector.resumeAfterVerifiedTodayRestore({ binding: BINDING, selectedPrematch: true,
      rosterMatchIds: ["today-a", "today-a"] })).toBe(false);
    expect(collector.resumeAfterVerifiedTodayRestore({ binding: BINDING, selectedPrematch: true,
      rosterMatchIds: ["today-b", "today-a"] })).toBe(false);
    expect(collector.resumeAfterVerifiedTodayRestore({ binding: BINDING, selectedPrematch: true,
      rosterMatchIds: ["today-a", "today-b"] })).toBe(true);
  });

  it.each(["SABA_COLLECTOR_SOURCE_STALE", "SABA_COLLECTOR_DOCUMENT_CHANGED",
    "SABA_COLLECTOR_SUPPLEMENTAL_UNSAFE_PAYLOAD_LIMIT", "SABA_COLLECTOR_MORE_CONTROL_CHANGED",
    "SABA_COLLECTOR_MORE_PREP_CONTROL_NOT_ELIGIBLE", "SABA_COLLECTOR_OPERATION_DEADLINE",
    "SABA_COLLECTOR_PAGE_OPERATION_FAILED"])(
    "does not resume a scope-hard owner adapter error %s", async (message) => {
      const today = [owner("today-error", "ELIGIBLE_MORE", 1)];
      const captureOwner = vi.fn<SabaCollectorPageAdapter["captureOwner"]>(async () => {
        throw new Error(message);
      });
      const collector = new SabaHiddenMarketCollector({ collectorGeneration: GENERATION,
        binding: BINDING, adapter: adapter(today, [], { captureOwner }) });

      const failed = await collector.advance(1);
      const capturesBeforeRejectedResume =
        failed.candidateItems.filter((item) => item.kind === "CAPTURE").length;

      expect(collector.resumeAfterVerifiedTodayRestore({ binding: BINDING, selectedPrematch: true,
        rosterMatchIds: ["today-error"] })).toBe(false);
      const stillFrozen = await collector.advance(1);
      expect(captureOwner).toHaveBeenCalledTimes(1);
      expect(stillFrozen.candidateItems.filter((item) => item.kind === "CAPTURE"))
        .toHaveLength(capturesBeforeRejectedResume);
    });

  it("does not resume a non-resumable initial roster error or after terminal", async () => {
    const missingRoster = new SabaHiddenMarketCollector({ collectorGeneration: GENERATION,
      binding: BINDING, adapter: adapter([], [], { readRoster: async () => {
        throw new Error("SABA_COLLECTOR_SOURCE_STALE");
      } }) });
    await missingRoster.advance(1);
    expect(missingRoster.resumeAfterVerifiedTodayRestore({ binding: BINDING, selectedPrematch: true,
      rosterMatchIds: [] })).toBe(false);

    const complete = new SabaHiddenMarketCollector({ collectorGeneration: GENERATION,
      binding: BINDING, adapter: adapter([], []) });
    await complete.advance(1);
    expect(complete.resumeAfterVerifiedTodayRestore({ binding: BINDING, selectedPrematch: true,
      rosterMatchIds: [] })).toBe(false);
  });
});
