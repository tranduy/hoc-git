import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { CatalogSourceStatus } from "@tool-chenh/contracts";
import type { LiveCatalogResponse } from "../api/catalog.js";
import type { HydratedComparisonWorkerOutput } from "../catalog/comparison-worker-client.js";
import { buildComparisonEvents } from "../catalog/comparison.js";
import { capturedRefundExample } from "../watch/conditional-roi.test-fixtures.js";
import { LagSignalTracker } from "../watch/lag-signal-tracker.js";
import { PriceMovementTracker } from "../watch/price-movement-tracker.js";
import { TicketPreflightCoordinator, type VerifiedTicketEvidence } from "../watch/ticket-preflight-coordinator.js";
import * as ranking from "../watch/ranked-tickets.js";
import { LiveCatalogPage } from "./live-catalog-page.js";

const worker = vi.hoisted(() => ({ result: null as null | ((output: HydratedComparisonWorkerOutput) => void) }));
vi.mock("../catalog/comparison-worker-client.js", () => ({ ComparisonWorkerClient: class {
  constructor(options: { onResult: (output: HydratedComparisonWorkerOutput) => void }) { worker.result = options.onResult; }
  reset() { return 1; } upsert() { return 2; } setStale() { return 3; } remove() { return 4; } stop() {}
} }));

afterEach(() => { cleanup(); vi.restoreAllMocks(); window.localStorage.clear(); });

it("retains the two fresh legs immediately when a third book becomes stale before the worker finishes", async () => {
  const { row } = capturedRefundExample("handicap");
  const now = Date.now();
  const catalogs: LiveCatalogResponse[] = row.cells.map(cell => ({
    accountId: `catalog-source:${cell.provider}:FOOTBALL`, provider: cell.provider,
    category: "FOOTBALL", dataMode: "LIVE", comparisonState: "AWAITING_SECOND_PROVIDER",
    snapshotState: "FRESH", observedAtMs: now, rejectedMarketCount: 0,
    markets: [cell.market], quotes: cell.quotes,
    events: [{ provider: cell.provider, category: "FOOTBALL", providerEventId: cell.market.providerEventId,
      competition: "League", participantA: "Alpha", participantB: "Beta", startAtUtcMs: now + 3_600_000,
      eventScope: "REGULATION", seasonStage: null, bestOf: null, rematchCandidate: false,
      fixtureDiscriminator: null, isVirtual: false, sportVariant: "FOOTBALL", isLive: false, liveState: null }]
  }));
  const base = catalogs[0]!;
  catalogs.push({ ...base, accountId: "catalog-source:SBOBET:FOOTBALL", provider: "SBOBET",
    events: base.events.map(event => ({ ...event, provider: "SBOBET" })),
    markets: base.markets.map(market => ({ ...market, provider: "SBOBET" })),
    quotes: base.quotes.map(quote => ({ ...quote, provider: "SBOBET" })) });
  const sources = catalogs.map(catalog => ({ id: catalog.accountId, provider: catalog.provider, category: "FOOTBALL",
    alias: catalog.provider, sessionState: "ACTIVE", sessionSource: "FABET_LOGIN", acquiredAtMs: now, reason: null })) as CatalogSourceStatus[];
  const read = vi.fn(async (id: string) => catalogs.find(catalog => catalog.accountId === id)!);
  const props = { fixedCategory: "FOOTBALL" as const, accountApi: { list: async () => [],
    register: async () => { throw new Error("unused"); }, refresh: async () => { throw new Error("unused"); } },
    catalogSourceApi: { list: async () => sources }, catalogApi: { read } };
  const baseline = { entries: [], sequence: 0 };
  const view = render(<LiveCatalogPage {...props} catalogRealtime={{ connectionState: "LIVE", baseline, revision: null }} />);
  await waitFor(() => expect(read).toHaveBeenCalledTimes(3));
  const events = buildComparisonEvents(catalogs);
  expect(events.some(event => event.providers.length === 3 && event.rows.length > 0)).toBe(true);
  await act(async () => { worker.result!({ generation: 1, isLatest: true, displayEvents: events, freshEvents: events }); });
  expect(screen.getByRole("button", { name: "Compare Alpha vs Beta" })).toBeTruthy();
  const entry = { accountId: base.accountId, revision: "retired-bti", observedAtMs: now, snapshotState: "STALE" as const };
  view.rerender(<LiveCatalogPage {...props} catalogRealtime={{ connectionState: "LIVE", baseline,
    revision: { entry, sequence: 1 } }} />);
  // The fake worker intentionally does not send a new result after SET_STALE.
  expect(screen.queryByRole("button", { name: "Compare Alpha vs Beta" })).not.toBeNull();
  expect(screen.queryByText("No exact two-book comparison is currently available")).toBeNull();
});

it("uses output snapshot clocks and clears current and pending preflight evidence on intermediate observations", async () => {
  const { row } = capturedRefundExample("handicap");
  const now = Date.now();
  const catalogs: LiveCatalogResponse[] = row.cells.map(cell => ({
    accountId: `catalog-source:${cell.provider}:FOOTBALL`, provider: cell.provider,
    category: "FOOTBALL", dataMode: "LIVE", comparisonState: "AWAITING_SECOND_PROVIDER",
    snapshotState: "FRESH", observedAtMs: now - 2_000, rejectedMarketCount: 0,
    markets: [cell.market], quotes: cell.quotes,
    events: [{ provider: cell.provider, category: "FOOTBALL", providerEventId: cell.market.providerEventId,
      competition: "League", participantA: "Alpha", participantB: "Beta", startAtUtcMs: now + 3_600_000,
      eventScope: "REGULATION", seasonStage: null, bestOf: null, rematchCandidate: false,
      fixtureDiscriminator: null, isVirtual: false, sportVariant: "FOOTBALL", isLive: false, liveState: null }]
  }));
  const sources = catalogs.map(catalog => ({ id: catalog.accountId, provider: catalog.provider, category: "FOOTBALL",
    alias: catalog.provider, sessionState: "ACTIVE", sessionSource: "FABET_LOGIN", acquiredAtMs: now, reason: null })) as CatalogSourceStatus[];
  const read = vi.fn(async (id: string) => ({ ...catalogs.find(catalog => catalog.accountId === id)!, observedAtMs: now }));
  const signals = vi.spyOn(LagSignalTracker.prototype, "update").mockReturnValue([]);
  const movements = vi.spyOn(PriceMovementTracker.prototype, "update").mockReturnValue([]);
  const pending: Array<(value: ReadonlyMap<string, VerifiedTicketEvidence>) => void> = [];
  const preflight = vi.spyOn(TicketPreflightCoordinator.prototype, "refresh")
    .mockImplementation(() => new Promise(resolve => pending.push(resolve)));
  const clear = vi.spyOn(TicketPreflightCoordinator.prototype, "clear");
  const rank = vi.spyOn(ranking, "rankedEvent");
  render(<LiveCatalogPage fixedCategory="FOOTBALL" accountApi={{ list: async () => [],
    register: async () => { throw new Error("unused"); }, refresh: async () => { throw new Error("unused"); } }}
    catalogSourceApi={{ list: async () => sources }} catalogApi={{ read }} />);
  await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  const events = buildComparisonEvents(catalogs);
  expect(events.some(event => event.rows.length > 0)).toBe(true);
  const deliver = (generation: number, isLatest: boolean) => worker.result!({ generation, isLatest,
    displayEvents: events, freshEvents: events });
  await act(async () => { deliver(1, true); });
  // The sentinel is deliberately outside the row keys: the page must clear
  // the entire previous evidence map, including evidence not currently ranked.
  const oldEvidence = new Map([["previous-source-plan", {} as VerifiedTicketEvidence]]);
  await act(async () => { pending[0]!(oldEvidence); });
  expect(rank.mock.calls.at(-1)![0].verified.size).toBe(1);
  await act(async () => { deliver(2, true); });
  const refreshCount = preflight.mock.calls.length;
  await act(async () => { deliver(3, false); });
  expect(preflight).toHaveBeenCalledTimes(refreshCount);
  expect(clear).toHaveBeenCalled();
  expect(rank.mock.calls.at(-1)![0].verified.size).toBe(0);
  expect(signals.mock.calls.at(-1)![3]).toBe(now - 2_000);
  expect(movements.mock.calls.at(-1)![1]).toBe(now - 2_000);
  expect(signals.mock.calls.at(-1)![1]).toEqual(new Set(catalogs.map(catalog => catalog.provider)));
  await act(async () => { pending[1]!(oldEvidence); });
  expect(rank.mock.calls.at(-1)![0].verified.size).toBe(0);
  await act(async () => { worker.result!({ generation: 4, isLatest: false, displayEvents: [], freshEvents: [] }); });
  expect(signals.mock.calls.at(-1)![3]).toBe(0);
  expect(signals.mock.calls.at(-1)![1]).toEqual(new Set());
  expect(movements.mock.calls.at(-1)![1]).toBe(0);
});
