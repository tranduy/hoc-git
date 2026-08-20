import type { ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import { describe, expect, it, vi } from "vitest";
import { SelectionPriceProbeCoordinator } from "./selection-price-probe-coordinator.js";

function envelope(requestId: string, observedAtMs = 1_020): ChromeBridgeEnvelope {
  return { version: 1, kind: "NETWORK", lobby: "TSPORT", sourceId: "chrome:TSPORT:9", tabId: 9, sequence: 2,
    observedAtMs, receivedMonotonicMs: 100, transport: "DOM_SNAPSHOT",
    request: { hostname: "tsport.invalid", pathnameClass: "/__fieldline_selection_price_probe__", resourceType: "DOM" },
    payload: { encoding: "UTF8", body: JSON.stringify({ requestId, providerEventId: "event-1",
      providerMarketId: "market-1", providerSelectionId: "selection-1", status: "FOUND",
      rawOdds: "0.17", observedAtMs, method: "DOM" }) } };
}

describe("SelectionPriceProbeCoordinator", () => {
  it("uses the live provider tab and resolves only the exact post-click DOM result", async () => {
    const sent: unknown[] = [];
    const coordinator = new SelectionPriceProbeCoordinator({
      listSources: () => [{ lobby: "TSPORT", sourceId: "chrome:TSPORT:9", tabId: 9, state: "LIVE",
        lastSequence: 1, lastAcceptedAtMs: 1_000, reason: null }],
      controlPlane: { probeSelectionPrice: (sourceId, input) => { sent.push({ sourceId, ...input }); return true; } },
      idFactory: () => "price-1", timeoutMs: 1_000
    });
    const result = coordinator.probe({ provider: "APSPORT", providerEventId: "event-1",
      providerMarketId: "market-1", providerSelectionId: "selection-1", eventLabel: "Alpha vs Beta",
      participantA: "Alpha", participantB: "Beta",
      marketType: "FT_TOTAL", scope: "FULL_TIME", selection: "UNDER", line: "2.5", requestedAtMs: 1_010 });
    coordinator.ingest(envelope("other"));
    coordinator.ingest(envelope("price-1"));

    await expect(result).resolves.toEqual({ rawOdds: "0.17", observedAtMs: 1_020, method: "DOM" });
    expect(sent).toEqual([{ sourceId: "chrome:TSPORT:9", requestId: "price-1", providerEventId: "event-1",
      providerMarketId: "market-1", providerSelectionId: "selection-1", eventLabel: "Alpha vs Beta",
      participantA: "Alpha", participantB: "Beta",
      marketType: "FT_TOTAL", scope: "FULL_TIME", selection: "UNDER", line: "2.5" }]);
  });

  it("fails closed instead of returning a DOM sample older than the button click", async () => {
    const coordinator = new SelectionPriceProbeCoordinator({
      listSources: () => [{ lobby: "CMD", sourceId: "chrome:CMD:9", tabId: 9, state: "LIVE",
        lastSequence: 1, lastAcceptedAtMs: 1_000, reason: null }],
      controlPlane: { probeSelectionPrice: () => true }, idFactory: () => "price-2", timeoutMs: 1_000
    });
    const result = coordinator.probe({ provider: "CMD", providerEventId: "event-1",
      providerMarketId: "market-1", providerSelectionId: "selection-1", eventLabel: "Alpha vs Beta",
      participantA: "Alpha", participantB: "Beta",
      marketType: "FT_AH", scope: "FULL_TIME", selection: "HOME", line: "-0.5", requestedAtMs: 1_100 });
    coordinator.ingest({ ...envelope("price-2", 1_050), lobby: "CMD", sourceId: "chrome:CMD:9" });

    await expect(result).rejects.toThrow("VISIBLE_PRICE_NOT_FRESH");
  });

  it("accepts a correlated CMD DOM result from the installed bridge version that omitted the method field", async () => {
    const coordinator = new SelectionPriceProbeCoordinator({
      listSources: () => [{ lobby: "CMD", sourceId: "chrome:CMD:9", tabId: 9, state: "LIVE",
        lastSequence: 1, lastAcceptedAtMs: 1_000, reason: null }],
      controlPlane: { probeSelectionPrice: () => true }, idFactory: () => "price-cmd", timeoutMs: 1_000
    });
    const result = coordinator.probe({ provider: "CMD", providerEventId: "event-1",
      providerMarketId: "market-1", providerSelectionId: "selection-1", eventLabel: "Alpha vs Beta",
      participantA: "Alpha", participantB: "Beta", marketType: "FT_AH", scope: "FULL_TIME",
      selection: "HOME", line: "-0.5", requestedAtMs: 1_000 });
    const legacyResult = JSON.parse(envelope("price-cmd").payload.body) as Record<string, unknown>;
    delete legacyResult.method;
    const accepted = coordinator.ingest({ ...envelope("price-cmd"), lobby: "CMD", sourceId: "chrome:CMD:9",
      payload: { encoding: "UTF8", body: JSON.stringify(legacyResult) } });

    expect(accepted).toBe(true);
    await expect(result).resolves.toEqual({ rawOdds: "0.17", observedAtMs: 1_020, method: "DOM" });
  });

  it("accepts a correlated SABA DOM result from the installed bridge version that omitted the method field", async () => {
    const coordinator = new SelectionPriceProbeCoordinator({
      listSources: () => [{ lobby: "SABA", sourceId: "chrome:SABA:9", tabId: 9, state: "LIVE",
        lastSequence: 1, lastAcceptedAtMs: 1_000, reason: null }],
      controlPlane: { probeSelectionPrice: () => true }, idFactory: () => "price-saba-legacy", timeoutMs: 1_000
    });
    const result = coordinator.probe({ provider: "SABA", providerEventId: "event-1",
      providerMarketId: "market-1", providerSelectionId: "selection-1", eventLabel: "Alpha vs Beta",
      participantA: "Alpha", participantB: "Beta", marketType: "FT_AH", scope: "FULL_TIME",
      selection: "HOME", line: "-0.5", requestedAtMs: 1_000 });
    const legacyResult = JSON.parse(envelope("price-saba-legacy").payload.body) as Record<string, unknown>;
    delete legacyResult.method;
    const accepted = coordinator.ingest({ ...envelope("price-saba-legacy"), lobby: "SABA",
      sourceId: "chrome:SABA:9", payload: { encoding: "UTF8", body: JSON.stringify(legacyResult) } });

    expect(accepted).toBe(true);
    await expect(result).resolves.toEqual({ rawOdds: "0.17", observedAtMs: 1_020, method: "DOM" });
  });

  it("fails immediately when no matching provider tab is live", async () => {
    const coordinator = new SelectionPriceProbeCoordinator({ listSources: () => [],
      controlPlane: { probeSelectionPrice: vi.fn(() => false) }, timeoutMs: 250 });
    await expect(coordinator.probe({ provider: "BTI", providerEventId: "event-1",
      providerMarketId: "market-1", providerSelectionId: "selection-1", eventLabel: "Alpha vs Beta",
      participantA: "Alpha", participantB: "Beta",
      marketType: "FT_AH", scope: "FULL_TIME", selection: "AWAY", line: "-0.5", requestedAtMs: 1_000 }))
      .rejects.toThrow("VISIBLE_PRICE_SOURCE_NOT_LIVE");
  });

  it("preserves a bounded fail-closed DOM diagnostic for provider-specific repair", async () => {
    const coordinator = new SelectionPriceProbeCoordinator({
      listSources: () => [{ lobby: "IM", sourceId: "chrome:IM:9", tabId: 9, state: "LIVE",
        lastSequence: 1, lastAcceptedAtMs: 1_000, reason: null }],
      controlPlane: { probeSelectionPrice: () => true }, idFactory: () => "price-im", timeoutMs: 1_000
    });
    const result = coordinator.probe({ provider: "IM", providerEventId: "event-1",
      providerMarketId: "market-1", providerSelectionId: "selection-1", eventLabel: "Alpha vs Beta",
      participantA: "Alpha", participantB: "Beta",
      marketType: "FT_AH", scope: "FULL_TIME", selection: "AWAY", line: "-0.5", requestedAtMs: 1_000 });
    coordinator.ingest({ ...envelope("price-im"), lobby: "IM", sourceId: "chrome:IM:9",
      payload: { encoding: "UTF8", body: JSON.stringify({ requestId: "price-im", providerEventId: "event-1",
        providerMarketId: "market-1", providerSelectionId: "selection-1", status: "NOT_FOUND", rawOdds: null,
        observedAtMs: 1_020, method: "DOM", reason: "IM_ID_NOT_FOUND" }) } });

    await expect(result).rejects.toThrow("IM_ID_NOT_FOUND");
  });

  it("accepts SABA's exact-selection-not-found result instead of timing out", async () => {
    const coordinator = new SelectionPriceProbeCoordinator({
      listSources: () => [{ lobby: "SABA", sourceId: "chrome:SABA:9", tabId: 9, state: "LIVE",
        lastSequence: 1, lastAcceptedAtMs: 1_000, reason: null }],
      controlPlane: { probeSelectionPrice: () => true }, idFactory: () => "price-saba", timeoutMs: 1_000
    });
    const result = coordinator.probe({ provider: "SABA", providerEventId: "event-1",
      providerMarketId: "event-1__market-1", providerSelectionId: "event-1__market-1:home",
      eventLabel: "Alpha vs Beta", marketType: "FT_AH", scope: "FULL_TIME", selection: "HOME",
      participantA: "Alpha", participantB: "Beta",
      line: "-0.5", requestedAtMs: 1_000 });
    const accepted = coordinator.ingest({ ...envelope("price-saba"), lobby: "SABA",
      sourceId: "chrome:SABA:9", payload: { encoding: "UTF8", body: JSON.stringify({
        requestId: "price-saba", providerEventId: "event-1", providerMarketId: "event-1__market-1",
        providerSelectionId: "event-1__market-1:home", status: "NOT_FOUND", rawOdds: null,
        observedAtMs: 1_020, method: "DOM", reason: "EXACT_SELECTION_NOT_FOUND"
      }) } });

    expect(accepted).toBe(true);
    await expect(result).rejects.toThrow("VISIBLE_PRICE_NOT_FOUND");
  });

  it("accepts SBOBET's exact current-feed miss instead of timing out", async () => {
    const coordinator = new SelectionPriceProbeCoordinator({
      listSources: () => [{ lobby: "KSPORT", sourceId: "chrome:KSPORT:9", tabId: 9, state: "LIVE",
        lastSequence: 1, lastAcceptedAtMs: 1_000, reason: null }],
      controlPlane: { probeSelectionPrice: () => true }, idFactory: () => "price-sbobet", timeoutMs: 1_000
    });
    const result = coordinator.probe({ provider: "SBOBET", providerEventId: "event-1",
      providerMarketId: "market-1", providerSelectionId: "selection-1", eventLabel: "Alpha vs Beta",
      participantA: "Alpha", participantB: "Beta",
      marketType: "FT_TOTAL", scope: "FULL_TIME", selection: "OVER", line: "2.5", requestedAtMs: 1_000 });
    const accepted = coordinator.ingest({ ...envelope("price-sbobet"), lobby: "KSPORT",
      sourceId: "chrome:KSPORT:9", payload: { encoding: "UTF8", body: JSON.stringify({
        requestId: "price-sbobet", providerEventId: "event-1", providerMarketId: "market-1",
        providerSelectionId: "selection-1", status: "NOT_FOUND", rawOdds: null,
        observedAtMs: 1_020, method: "IN_PAGE_FETCH", reason: "SBOBET_SELECTION_NOT_FOUND"
      }) } });

    expect(accepted).toBe(true);
    await expect(result).rejects.toThrow("VISIBLE_PRICE_NOT_FOUND");
  });

  it("preserves the attempted direct-read method on an ambiguous fail-closed result", async () => {
    const coordinator = new SelectionPriceProbeCoordinator({
      listSources: () => [{ lobby: "TSPORT", sourceId: "chrome:TSPORT:9", tabId: 9, state: "LIVE",
        lastSequence: 1, lastAcceptedAtMs: 1_000, reason: null }],
      controlPlane: { probeSelectionPrice: () => true }, idFactory: () => "price-ambiguous", timeoutMs: 1_000
    });
    const result = coordinator.probe({ provider: "APSPORT", providerEventId: "event-1",
      providerMarketId: "market-1", providerSelectionId: "selection-1", eventLabel: "Alpha vs Beta",
      participantA: "Alpha", participantB: "Beta", marketType: "FT_TOTAL", scope: "FULL_TIME",
      selection: "UNDER", line: "2.5", requestedAtMs: 1_000 });
    coordinator.ingest({ ...envelope("price-ambiguous"), payload: { encoding: "UTF8", body: JSON.stringify({
      requestId: "price-ambiguous", providerEventId: "event-1", providerMarketId: "market-1",
      providerSelectionId: "selection-1", status: "AMBIGUOUS", rawOdds: null,
      observedAtMs: 1_020, method: "DOM", reason: "VISIBLE_PRICE_AMBIGUOUS"
    }) } });

    const failure = await result.catch((error: unknown) => error);
    expect(failure).toMatchObject({ message: "VISIBLE_PRICE_AMBIGUOUS", method: "DOM" });
  });

  it.each([
    ["NOT_FOUND", "TSPORT_SELECTION_NOT_FOUND", "TSPORT_SELECTION_NOT_FOUND"],
    ["AMBIGUOUS", "TSPORT_SELECTION_AMBIGUOUS", "TSPORT_SELECTION_AMBIGUOUS"]
  ] as const)("accepts TSPORT %s diagnostics instead of timing out", async (status, reason, expected) => {
    const coordinator = new SelectionPriceProbeCoordinator({
      listSources: () => [{ lobby: "TSPORT", sourceId: "chrome:TSPORT:9", tabId: 9, state: "LIVE",
        lastSequence: 1, lastAcceptedAtMs: 1_000, reason: null }],
      controlPlane: { probeSelectionPrice: () => true }, idFactory: () => "price-tsport", timeoutMs: 1_000
    });
    const result = coordinator.probe({ provider: "APSPORT", providerEventId: "event-1",
      providerMarketId: "market-1", providerSelectionId: "selection-1", eventLabel: "Alpha vs Beta",
      participantA: "Alpha", participantB: "Beta", marketType: "FT_TOTAL", scope: "FULL_TIME",
      selection: "UNDER", line: "2.5", requestedAtMs: 1_000 });
    const accepted = coordinator.ingest({ ...envelope("price-tsport"), payload: {
      encoding: "UTF8", body: JSON.stringify({ requestId: "price-tsport", providerEventId: "event-1",
        providerMarketId: "market-1", providerSelectionId: "selection-1", status, rawOdds: null,
        observedAtMs: 1_020, method: "IN_PAGE_FETCH", reason })
    } });

    expect(accepted).toBe(true);
    const failure = await result.catch((error: unknown) => error);
    expect(failure).toMatchObject({ message: expected, method: "IN_PAGE_FETCH" });
  });
});
