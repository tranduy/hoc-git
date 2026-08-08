import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { AppSnapshot } from "@tool-chenh/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { MappingsPage } from "./mappings-page.js";

const evidence = (gate: string, passed: boolean) => ({ gate, passed, expected: `${gate} expected`, actual: `${gate} actual`, reason: passed ? "matched" : "conflicts" });

const snapshot: AppSnapshot = {
  revision: 9,
  generatedAtMs: 1_800_000_000_000,
  providerStatuses: [],
  counts: { FOOTBALL: { events: 2, markets: 1 }, LOL: { events: 1, markets: 1 }, mappings: { VERIFIED: 2, REVIEW_REQUIRED: 2, REJECTED: 2 }, opportunities: 0 },
  events: [
    { canonicalEventId: "event-verified", category: "FOOTBALL", competition: "Premier League", seasonStage: null, startAtUtcMs: 1, participantA: "Northbridge", participantB: "Riverside", providerEventIds: ["a", "b"], mappingStatus: "VERIFIED", mappingEvidence: [evidence("same participants", true)] },
    { canonicalEventId: "event-review", category: "LOL", competition: "Summer Split", seasonStage: "Playoffs", startAtUtcMs: 2, participantA: "Blue", participantB: "Red", providerEventIds: ["c", "d"], mappingStatus: "REVIEW_REQUIRED", mappingEvidence: [evidence("same tournament", true), evidence("same stage", false)] },
    { canonicalEventId: "event-rejected", category: "FOOTBALL", competition: "Cup", seasonStage: null, startAtUtcMs: 3, participantA: "Alpha", participantB: "Beta", providerEventIds: ["e", "f"], mappingStatus: "REJECTED", mappingEvidence: [evidence("same category", false)] }
  ],
  markets: [
    { canonicalMarketId: "market-verified", canonicalEventId: "event-verified", category: "FOOTBALL", marketType: "FT_1X2", scope: "FULL_TIME", line: null, settlementProfile: "football", providerMarketIds: ["m1", "m2"], mappingStatus: "VERIFIED", mappingEvidence: [evidence("same market", true)] },
    { canonicalMarketId: "market-review", canonicalEventId: "event-review", category: "LOL", marketType: "MAP_WINNER", scope: "MAP_3", line: null, settlementProfile: "lol", providerMarketIds: ["m3", "m4"], mappingStatus: "REVIEW_REQUIRED", mappingEvidence: [evidence("compatible map", false)] },
    { canonicalMarketId: "market-rejected", canonicalEventId: "event-rejected", category: "FOOTBALL", marketType: "FT_TOTAL", scope: "FULL_TIME", line: "2.5", settlementProfile: "football", providerMarketIds: ["m5", "m6"], mappingStatus: "REJECTED", mappingEvidence: [evidence("same settlement", false)] }
  ],
  opportunities: [],
  blockedDiagnostics: []
};

describe("MappingsPage", () => {
  afterEach(cleanup);

  it("filters every mapping status and expands expected, actual, pass/fail, and reason evidence without write controls", () => {
    render(<MappingsPage snapshot={snapshot} connectionState="LIVE" />);

    expect(screen.getByText("Northbridge vs Riverside")).toBeTruthy();
    expect(screen.getByText("Blue vs Red")).toBeTruthy();
    expect(screen.getByText("Alpha vs Beta")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Mapping status"), { target: { value: "REVIEW_REQUIRED" } });
    expect(screen.queryByText("Northbridge vs Riverside")).toBeNull();
    expect(screen.getByText("Blue vs Red")).toBeTruthy();
    fireEvent.click(screen.getByText(/Blue vs Red/u));
    const expanded = screen.getByText("Blue vs Red").closest("details") as HTMLDetailsElement;
    expect(expanded.open).toBe(true);
    expect(within(expanded).getByText("same tournament expected")).toBeTruthy();
    expect(within(expanded).getByText("same tournament actual")).toBeTruthy();
    expect(within(expanded).getByText("PASS")).toBeTruthy();
    expect(within(expanded).getByText("FAIL")).toBeTruthy();
    const table = within(expanded).getByRole("table");
    expect(within(table).getByText("Mapping evidence gates")).toBeTruthy();
    expect(table.querySelectorAll("th[scope='col']")).toHaveLength(5);
    fireEvent.change(screen.getByLabelText("Mapping status"), { target: { value: "REJECTED" } });
    expect(screen.getByText("Alpha vs Beta")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Mapping status"), { target: { value: "VERIFIED" } });
    expect(screen.getByText("Northbridge vs Riverside")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /verify|approve|save|submit/i })).toBeNull();
  });

  it("gives an empty filter result a safe read-only next action", () => {
    render(<MappingsPage snapshot={{ ...snapshot, events: [], markets: [] }} connectionState="LIVE" />);

    expect(screen.getByText("No mappings match this filter.")).toBeTruthy();
    expect(screen.getByText(/Wait for a fresh server snapshot/i)).toBeTruthy();
  });

  it("labels disconnected evidence as last-known and gives stale diagnostics a safe next action", () => {
    const diagnostics = [{ code: "STALE", category: "LOL" as const, canonicalMarketId: "market-review", reason: "provider timestamp expired", mappingEvidence: [] }];
    render(<MappingsPage snapshot={{ ...snapshot, blockedDiagnostics: diagnostics }} connectionState="DISCONNECTED" />);

    expect(screen.getByRole("alert").textContent).toContain("last-known and non-actionable");
    expect(screen.getByRole("status").textContent).toContain("provider timestamp expired");
    expect(screen.getAllByText(/wait for a fresh server snapshot/i)).toHaveLength(2);
  });
});
