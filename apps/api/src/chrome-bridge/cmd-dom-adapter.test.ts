import { describe, expect, it } from "vitest";
import type { ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import { CmdDomCatalogAdapter } from "./cmd-dom-adapter.js";

function envelope(body: string, overrides: Partial<Pick<ChromeBridgeEnvelope,
  "sequence" | "observedAtMs" | "receivedMonotonicMs">> = {}): ChromeBridgeEnvelope {
  return {
    version: 1, kind: "NETWORK", lobby: "CMD", sourceId: "chrome:CMD:9", tabId: 9,
    sequence: overrides.sequence ?? 12,
    observedAtMs: overrides.observedAtMs ?? Date.UTC(2026, 7, 15, 5),
    receivedMonotonicMs: overrides.receivedMonotonicMs ?? 50,
    transport: "DOM_SNAPSHOT",
    request: { hostname: "cgnew.fts368.com", pathnameClass: "/__fieldline_dom_snapshot__", resourceType: "DOM" },
    payload: { encoding: "UTF8", body }
  };
}

function snapshotBody(records: readonly unknown[], overrides: Partial<{
  snapshotId: string; chunkIndex: number; chunkCount: number; sweepId: string; sweepComplete: boolean;
  sweepFrameKey: string;
}> = {}): string {
  return JSON.stringify({
    schemaVersion: 2,
    snapshotId: overrides.snapshotId ?? "cmd:9:snapshot-0001",
    chunkIndex: overrides.chunkIndex ?? 0,
    chunkCount: overrides.chunkCount ?? 1,
    ...(overrides.sweepId === undefined ? {} : { sweepId: overrides.sweepId }),
    ...(overrides.sweepComplete === undefined ? {} : { sweepComplete: overrides.sweepComplete }),
    ...(overrides.sweepFrameKey === undefined ? {} : { sweepFrameKey: overrides.sweepFrameKey }),
    records
  });
}

const record = {
  sportId: "1", leagueId: "league-1", leagueName: "Premier Test", matchId: "event-1",
  timeText: "08/17 02:30AM", teamNames: ["Alpha FC", "Beta FC"], groups: [{
    betTypeIds: ["1"], labels: ["0.5"], odds: [
      { marketOddsId: "ah-1", priceText: "0.90", status: null, greyedOut: "false", lineText: "0.5" },
      { marketOddsId: "ah-1", priceText: "-0.92", status: null, greyedOut: "false", lineText: null }
    ]
  }]
};

describe("CmdDomCatalogAdapter", () => {
  it("decodes an exact public CMD DOM snapshot into a live football catalog", () => {
    const adapter = new CmdDomCatalogAdapter();
    const input = envelope(snapshotBody([record]));
    expect(adapter.fingerprint(input)).toBe(true);
    const updates = adapter.decode(input);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ sourceId: "chrome:CMD:9", sequence: 12 });
    expect(updates[0]).toMatchObject({ evidenceMode: "DELTA", provenance: "DOM_FALLBACK",
      generation: "cmd:9:snapshot-0001" });
    expect(updates[0]!.value).toMatchObject({
      accountId: "catalog-source:CMD:FOOTBALL", provider: "CMD", category: "FOOTBALL",
      events: [{ providerEventId: "event-1", participantA: "Alpha FC", participantB: "Beta FC",
        startAtUtcMs: Date.UTC(2026, 7, 16, 18, 30) }],
      markets: [{ marketType: "FT_AH", line: "-0.5" }]
    });
  });

  it("fails closed on malformed or credential-shaped DOM payloads", () => {
    const adapter = new CmdDomCatalogAdapter();
    expect(adapter.decode(envelope("not-json"))).toEqual([]);
    expect(adapter.decode(envelope(snapshotBody([{ ...record, token: "must-not-pass" }])))).toEqual([]);
  });

  it("quarantines malformed rows without discarding the remaining public catalog", () => {
    const adapter = new CmdDomCatalogAdapter();
    const updates = adapter.decode(envelope(snapshotBody([{ ...record, token: "must-not-pass" }, record])));
    expect(updates).toHaveLength(1);
    expect((updates[0]!.value as { events: readonly unknown[] }).events).toHaveLength(1);
    expect(JSON.stringify(updates)).not.toContain("must-not-pass");
  });

  it("assembles every record from a multi-chunk snapshot before publishing", () => {
    const adapter = new CmdDomCatalogAdapter();
    const records = Array.from({ length: 783 }, (_, index) => ({
      ...record,
      matchId: `event-${index}`,
      groups: [{
        ...record.groups[0],
        odds: record.groups[0]!.odds.map((odd) => ({ ...odd, marketOddsId: `ah-${index}` }))
      }]
    }));
    const id = "cmd:9:snapshot-large-0001";
    expect(adapter.decode(envelope(snapshotBody(records.slice(400), { snapshotId: id, chunkIndex: 1, chunkCount: 2 })))).toEqual([]);
    const updates = adapter.decode(envelope(snapshotBody(records.slice(0, 400), { snapshotId: id, chunkIndex: 0, chunkCount: 2 })));
    expect(updates).toHaveLength(1);
    expect((updates[0]!.value as { events: readonly unknown[] }).events).toHaveLength(783);
  });

  it("does not let an old snapshot complete after and overwrite a newer CMD generation", () => {
    const adapter = new CmdDomCatalogAdapter();
    const oldRecord = { ...structuredClone(record), groups: [{ ...record.groups[0]!, odds:
      record.groups[0]!.odds.map((odd) => ({ ...odd, priceText: "0.61" })) }] };
    const newRecord = { ...structuredClone(record), groups: [{ ...record.groups[0]!, odds:
      record.groups[0]!.odds.map((odd) => ({ ...odd, priceText: "0.91" })) }] };

    expect(adapter.decode(envelope(snapshotBody([oldRecord], {
      snapshotId: "cmd:9:old-generation", chunkIndex: 0, chunkCount: 2
    }), { sequence: 20, observedAtMs: 100, receivedMonotonicMs: 10 }))).toEqual([]);
    const newest = adapter.decode(envelope(snapshotBody([newRecord], {
      snapshotId: "cmd:9:new-generation"
    }), { sequence: 21, observedAtMs: 200, receivedMonotonicMs: 20 }));
    expect((newest[0]!.value as { quotes: readonly { rawOdds: string }[] }).quotes
      .map((quote) => quote.rawOdds)).toEqual(["0.91", "0.91"]);

    expect(adapter.decode(envelope(snapshotBody([oldRecord], {
      snapshotId: "cmd:9:old-generation", chunkIndex: 1, chunkCount: 2
    }), { sequence: 22, observedAtMs: 100, receivedMonotonicMs: 30 }))).toEqual([]);
  });

  it("retains previously observed CMD rows while a virtualized table scans the next viewport", () => {
    const adapter = new CmdDomCatalogAdapter();
    const nextRecord = {
      ...record,
      matchId: "event-2",
      teamNames: ["Gamma FC", "Delta FC"],
      groups: [{
        ...record.groups[0],
        odds: record.groups[0]!.odds.map((odd) => ({ ...odd, marketOddsId: "ah-2" }))
      }]
    };

    adapter.decode(envelope(snapshotBody([record]), { sequence: 12, receivedMonotonicMs: 50 }));
    const updates = adapter.decode(envelope(
      snapshotBody([nextRecord], { snapshotId: "cmd:9:snapshot-0002" }),
      { sequence: 13, observedAtMs: Date.UTC(2026, 7, 15, 5, 0, 2), receivedMonotonicMs: 80 }
    ));

    const catalog = updates[0]!.value as { events: readonly { providerEventId: string }[];
      quotes: readonly { providerEventId: string; receivedMonotonicMs: number; sequence: number | null }[] };
    expect(catalog.events
      .map((event) => event.providerEventId).sort()).toEqual(["event-1", "event-2"]);
    expect(catalog.quotes.filter((quote) => quote.providerEventId === "event-1"))
      .toEqual(expect.arrayContaining([expect.objectContaining({ receivedMonotonicMs: 50, sequence: 12 })]));
    expect(catalog.quotes.filter((quote) => quote.providerEventId === "event-2"))
      .toEqual(expect.arrayContaining([expect.objectContaining({ receivedMonotonicMs: 80, sequence: 13 })]));
  });

  it("does not let an elapsed timer turn a partial viewport into a false complete sweep", () => {
    const adapter = new CmdDomCatalogAdapter();
    const nextRecord = { ...record, matchId: "event-2", teamNames: ["Gamma FC", "Delta FC"] };
    const startedAtMs = Date.UTC(2026, 7, 15, 5);
    adapter.decode(envelope(snapshotBody([record]), { observedAtMs: startedAtMs }));
    const update = adapter.decode(envelope(snapshotBody([nextRecord], { snapshotId: "cmd:9:snapshot-expiry" }),
      { sequence: 13, observedAtMs: startedAtMs + 15_001, receivedMonotonicMs: 80 }))[0]!;
    expect((update.value as { events: readonly { providerEventId: string }[] }).events)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ providerEventId: "event-1" }),
        expect.objectContaining({ providerEventId: "event-2" })
      ]));
  });

  it("does not turn an identical visible DOM row into fresh quote evidence", () => {
    const adapter = new CmdDomCatalogAdapter();
    adapter.decode(envelope(snapshotBody([record]), { sequence: 1, observedAtMs: 1_000,
      receivedMonotonicMs: 10 }));
    expect(adapter.decode(envelope(snapshotBody([record], { snapshotId: "cmd:9:snapshot-identical-0002" }),
      { sequence: 2, observedAtMs: 5_000, receivedMonotonicMs: 20 }))).toEqual([]);
  });

  it("removes omitted rows only when an explicit complete sweep closes", () => {
    const adapter = new CmdDomCatalogAdapter();
    const obsoleteRecord = { ...record, matchId: "event-obsolete", teamNames: ["Gone FC", "Old FC"] };
    const nextRecord = { ...record, matchId: "event-2", teamNames: ["Gamma FC", "Delta FC"],
      groups: [{ ...record.groups[0]!, odds: record.groups[0]!.odds.map((odd) => ({ ...odd,
        marketOddsId: "ah-2" })) }] };
    adapter.decode(envelope(snapshotBody([obsoleteRecord], { snapshotId: "cmd:9:before-sweep-0001" }),
      { sequence: 0 }));
    adapter.decode(envelope(snapshotBody([record], { snapshotId: "cmd:9:sweep-part-0001",
      sweepId: "cmd:9:sweep-1", sweepComplete: false }), { sequence: 1 }));
    const partial = adapter.decode(envelope(snapshotBody([nextRecord], {
      snapshotId: "cmd:9:sweep-part-0002", sweepId: "cmd:9:sweep-1", sweepComplete: false
    }), { sequence: 2 }))[0]!.value as { events: Array<{ providerEventId: string }> };
    expect(partial.events.map((event) => event.providerEventId).sort())
      .toEqual(["event-1", "event-2", "event-obsolete"]);

    const complete = adapter.decode(envelope(snapshotBody([nextRecord], {
      snapshotId: "cmd:9:sweep-part-0003", sweepId: "cmd:9:sweep-1", sweepComplete: true
    }), { sequence: 3 }))[0]!.value as { events: Array<{ providerEventId: string }> };
    expect(complete.events.map((event) => event.providerEventId).sort()).toEqual(["event-1", "event-2"]);
  });

  it("does not let one completed frame sweep tombstone records owned by another frame", () => {
    const adapter = new CmdDomCatalogAdapter();
    const other = { ...record, matchId: "event-2", teamNames: ["Gamma FC", "Delta FC"], groups: [{
      ...record.groups[0]!, odds: record.groups[0]!.odds.map((odd) => ({ ...odd, marketOddsId: "ah-2" }))
    }] };
    adapter.decode(envelope(snapshotBody([record], { snapshotId: "cmd:9:frame-a-0001",
      sweepId: "cmd:9:sweep-a", sweepComplete: false, sweepFrameKey: "odds-frame-a" }), { sequence: 1 }));
    const completedOther = adapter.decode(envelope(snapshotBody([other], { snapshotId: "cmd:9:frame-b-0002",
      sweepId: "cmd:9:sweep-b", sweepComplete: true, sweepFrameKey: "odds-frame-b" }), { sequence: 2 }));
    expect((completedOther[0]!.value as { events: Array<{ providerEventId: string }> }).events
      .map((event) => event.providerEventId).sort()).toEqual(["event-1", "event-2"]);
  });
});
