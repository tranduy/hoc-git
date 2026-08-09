import type { ProviderConnectionStatus, ProviderEvent, ProviderMarket } from "@tool-chenh/contracts";
import { describe, expect, it, vi } from "vitest";
import type { AdapterSchemaError, ProviderQuoteUpdate, ProviderSink } from "../provider-adapter.js";
import { CmdAdapter, type CmdCatalogSnapshot } from "./cmd-adapter.js";

const match = {
  sportId: "1" as const, leagueId: "l1", leagueName: "Premier Test", matchId: "m1",
  timeText: "08/17 02:30AM", teamNames: ["Alpha", "Beta"],
  groups: [{
    betTypeIds: ["3"], labels: ["2.5", "u"],
    odds: [
      { marketOddsId: "total-1", priceText: "0.84", status: null, greyedOut: "false" },
      { marketOddsId: "total-1", priceText: "-0.92", status: null, greyedOut: "false" }
    ]
  }]
};

function snapshot(sequence: number, records = [match]): CmdCatalogSnapshot {
  return {
    records, observedAtMs: Date.UTC(2026, 7, 9), receivedMonotonicMs: sequence * 100,
    timezoneOffsetMinutes: 420, sequence
  };
}

function sink() {
  const events: ProviderEvent[] = [];
  const markets: ProviderMarket[] = [];
  const updates: ProviderQuoteUpdate[] = [];
  const statuses: ProviderConnectionStatus[] = [];
  const errors: AdapterSchemaError[] = [];
  const value: ProviderSink = {
    onEvent: (event) => events.push(event), onMarket: (market) => markets.push(market),
    onQuoteUpdate: (update) => updates.push(update), onStatus: (status) => statuses.push(status),
    onSchemaError: (error) => errors.push(error)
  };
  return { value, events, markets, updates, statuses, errors };
}

describe("CmdAdapter", () => {
  it("publishes sequenced polling full snapshots from the real catalog boundary", async () => {
    const source = { snapshots: vi.fn(async function* () { yield snapshot(1); yield snapshot(2); }) };
    const adapter = new CmdAdapter({ source });
    const output = sink();
    await adapter.start(output.value, new AbortController().signal);
    expect(adapter.id).toBe("cmd-football");
    expect(adapter.categories).toEqual(["FOOTBALL"]);
    expect(output.events).toHaveLength(2);
    expect(output.markets).toHaveLength(2);
    expect(output.updates).toHaveLength(2);
    expect(output.updates[0]).toEqual(expect.objectContaining({
      source: { provider: "CMD", category: "FOOTBALL" }, kind: "FULL_SNAPSHOT",
      transport: "POLLING", sequence: 1
    }));
    expect(output.statuses.map((status) => status.status)).toEqual(["CONNECTING", "LIVE", "LIVE", "DISCONNECTED"]);
    expect(output.errors).toEqual([]);
  });

  it("quarantines a malformed snapshot without publishing partial data", async () => {
    const malformed = { ...match, groups: [{ ...match.groups[0]!, odds: [
      match.groups[0]!.odds[0]!, { ...match.groups[0]!.odds[1]!, marketOddsId: "wrong" }
    ] }] };
    const source = { snapshots: async function* () { yield snapshot(1, [malformed]); } };
    const output = sink();
    await new CmdAdapter({ source }).start(output.value, new AbortController().signal);
    expect(output.events).toEqual([]);
    expect(output.markets).toEqual([]);
    expect(output.updates).toEqual([]);
    expect(output.errors).toEqual([expect.objectContaining({ code: "SCHEMA_ERROR", provider: "CMD", category: "FOOTBALL" })]);
    expect(JSON.stringify(output.errors)).not.toContain("wrong");
  });
});
