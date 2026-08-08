import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { AppSnapshot } from "@tool-chenh/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { App } from "./app.js";

const snapshot: AppSnapshot = {
  revision: 4,
  generatedAtMs: 1_800_000_000_000,
  providerStatuses: [
    { adapterId: "saba-football", provider: "SABA", category: "FOOTBALL", status: "LIVE", detail: null, updatedAtMs: 1 },
    { adapterId: "im-football", provider: "IM", category: "FOOTBALL", status: "DEGRADED", detail: "Polling slowly", updatedAtMs: 1 },
    { adapterId: "saba-lol", provider: "SABA", category: "LOL", status: "CONNECTING", detail: null, updatedAtMs: 1 },
    { adapterId: "im-lol", provider: "IM", category: "LOL", status: "DISCONNECTED", detail: "Offline", updatedAtMs: 1 }
  ],
  counts: {
    FOOTBALL: { events: 1, markets: 1 },
    LOL: { events: 1, markets: 1 },
    mappings: { VERIFIED: 1, REVIEW_REQUIRED: 1, REJECTED: 0 },
    opportunities: 0
  },
  events: [
    { canonicalEventId: "football-1", category: "FOOTBALL", competition: "Premier League", seasonStage: null, startAtUtcMs: 1_800_000_100_000, participantA: "Northbridge", participantB: "Riverside", providerEventIds: ["saba-f-1", "im-f-1"], mappingStatus: "VERIFIED", mappingEvidence: [] },
    { canonicalEventId: "lol-1", category: "LOL", competition: "Summer Split", seasonStage: null, startAtUtcMs: 1_800_000_200_000, participantA: "Blue Comets", participantB: "Red Phoenix", providerEventIds: ["saba-l-1", "im-l-1"], mappingStatus: "REVIEW_REQUIRED", mappingEvidence: [] }
  ],
  markets: [
    { canonicalMarketId: "football-market", canonicalEventId: "football-1", category: "FOOTBALL", marketType: "FT_1X2", scope: "FULL_TIME", line: null, settlementProfile: "football", providerMarketIds: ["1"], mappingStatus: "VERIFIED", mappingEvidence: [] },
    { canonicalMarketId: "lol-market", canonicalEventId: "lol-1", category: "LOL", marketType: "MAP_WINNER", scope: "MAP_3", line: null, settlementProfile: "lol", providerMarketIds: ["2"], mappingStatus: "REVIEW_REQUIRED", mappingEvidence: [] }
  ],
  opportunities: [],
  blockedDiagnostics: []
};

describe("App navigation", () => {
  beforeEach(() => window.history.pushState({}, "", "/"));
  afterEach(() => cleanup());

  it("shows every primary view and filters Football and LoL event rows", () => {
    render(<App initialSnapshot={snapshot} />);

    for (const label of ["Dashboard", "Football", "LoL", "Opportunities", "Mapping Review"]) {
      expect(screen.getByRole("link", { name: label })).toBeTruthy();
    }

    fireEvent.click(screen.getByRole("link", { name: "Football" }));
    expect(screen.getByRole("heading", { name: "Football" })).toBeTruthy();
    expect(screen.getByText("Northbridge")).toBeTruthy();
    expect(screen.queryByText("Blue Comets")).toBeNull();

    fireEvent.click(screen.getByRole("link", { name: "LoL" }));
    expect(screen.getByRole("heading", { name: "LoL" })).toBeTruthy();
    expect(screen.getByText("Blue Comets")).toBeTruthy();
    expect(screen.queryByText("Northbridge")).toBeNull();
  });

  it("names provider state with an icon label and text", () => {
    render(<App initialSnapshot={snapshot} />);

    expect(within(screen.getByLabelText("SABA Football: LIVE")).getByText("LIVE")).toBeTruthy();
    expect(within(screen.getByLabelText("IM Football: DEGRADED")).getByText("DEGRADED")).toBeTruthy();
  });
});
