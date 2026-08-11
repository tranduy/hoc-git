import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { AppSnapshot } from "@tool-chenh/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
    FOOTBALL: { events: 2, markets: 3 },
    LOL: { events: 1, markets: 1 },
    mappings: { VERIFIED: 2, REVIEW_REQUIRED: 1, REJECTED: 0 },
    opportunities: 0
  },
  events: [
    { canonicalEventId: "football-1", category: "FOOTBALL", competition: "Premier League", seasonStage: null, startAtUtcMs: 1_800_000_100_000, participantA: "Northbridge", participantB: "Riverside", providerEventIds: ["saba-f-1", "im-f-1"], isLive: false, mappingStatus: "VERIFIED", mappingEvidence: [] },
    { canonicalEventId: "football-2", category: "FOOTBALL", competition: "Cup Final", seasonStage: null, startAtUtcMs: 1_799_999_900_000, participantA: "City Academy", participantB: "United Academy", providerEventIds: ["saba-f-2", "im-f-2"], isLive: true, mappingStatus: "REVIEW_REQUIRED", mappingEvidence: [] },
    { canonicalEventId: "lol-1", category: "LOL", competition: "Summer Split", seasonStage: null, startAtUtcMs: 1_800_000_200_000, participantA: "Blue Comets", participantB: "Red Phoenix", providerEventIds: ["saba-l-1", "im-l-1"], isLive: false, mappingStatus: "REVIEW_REQUIRED", mappingEvidence: [] }
  ],
  markets: [
    { canonicalMarketId: "football-market", canonicalEventId: "football-1", category: "FOOTBALL", marketType: "FT_1X2", scope: "FULL_TIME", line: null, settlementProfile: "football", providerMarketIds: ["1"], mappingStatus: "VERIFIED", mappingEvidence: [] },
    { canonicalMarketId: "football-total", canonicalEventId: "football-1", category: "FOOTBALL", marketType: "FT_TOTAL", scope: "FULL_TIME", line: "2.5", settlementProfile: "football", providerMarketIds: ["3"], mappingStatus: "VERIFIED", mappingEvidence: [] },
    { canonicalMarketId: "football-cup", canonicalEventId: "football-2", category: "FOOTBALL", marketType: "FT_AH", scope: "FULL_TIME", line: null, settlementProfile: "football", providerMarketIds: ["4"], mappingStatus: "REVIEW_REQUIRED", mappingEvidence: [] },
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

    for (const label of ["Dashboard", "Football Live", "LoL Live", "Football Overview", "LoL Overview", "Opportunities", "Mapping Review", "Sessions"]) {
      expect(screen.getByRole("link", { name: label })).toBeTruthy();
    }

    fireEvent.click(screen.getByRole("link", { name: "Football Overview" }));
    expect(screen.getByRole("heading", { name: "Football" })).toBeTruthy();
    expect(screen.getByText("Northbridge")).toBeTruthy();
    expect(screen.queryByText("Blue Comets")).toBeNull();

    fireEvent.click(screen.getByRole("link", { name: "LoL Overview" }));
    expect(screen.getByRole("heading", { name: "LoL" })).toBeTruthy();
    expect(screen.getByText("Blue Comets")).toBeTruthy();
    expect(screen.queryByText("Northbridge")).toBeNull();

    fireEvent.click(screen.getByRole("link", { name: "Sessions" }));
    expect(screen.getByRole("heading", { name: "Sessions" })).toBeTruthy();
  });

  it("uses independent menu routes for Football Live and LoL Live", () => {
    window.history.replaceState({}, "", "/lol-live");
    render(<App initialSnapshot={snapshot} />);

    expect(screen.getByRole("heading", { name: "LoL Live Price Gaps" })).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Category" })).toBeNull();
    expect(screen.getByRole("link", { name: "LoL Live" }).getAttribute("aria-current")).toBe("page");

    fireEvent.click(screen.getByRole("link", { name: "Football Live" }));
    expect(screen.getByRole("heading", { name: "Football Live Price Gaps" })).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Category" })).toBeNull();
    expect(window.location.pathname).toBe("/football-live");
  });

  it("names provider state with an icon label and text", () => {
    render(<App initialSnapshot={snapshot} />);

    expect(within(screen.getByLabelText("SABA Football: LIVE")).getByText("LIVE")).toBeTruthy();
    expect(within(screen.getByLabelText("IM Football: DEGRADED")).getByText("DEGRADED")).toBeTruthy();
    expect(screen.getByLabelText("SABA Football: LIVE").className).toContain("provider-status--saba");
    expect(screen.getByLabelText("IM Football: DEGRADED").className).toContain("provider-status--im");
  });

  it("renders dashboard metrics from the snapshot", () => {
    render(<App initialSnapshot={snapshot} />);

    const metrics = within(screen.getByLabelText("Market summary"));
    expect(metrics.getByText("Football events").nextElementSibling?.textContent).toBe("2");
    expect(metrics.getByText("LoL events").nextElementSibling?.textContent).toBe("1");
    expect(metrics.getByText("Verified mappings").nextElementSibling?.textContent).toBe("2");
    expect(metrics.getByText("Maximum quote age").nextElementSibling?.textContent).toBe("0 ms");
  });

  it("composes timing, competition, market, and mapping filters against rendered rows", () => {
    render(<App initialSnapshot={snapshot} />);
    fireEvent.click(screen.getByRole("link", { name: "Football Overview" }));

    fireEvent.change(screen.getByLabelText("Timing"), { target: { value: "PRE_MATCH" } });
    fireEvent.change(screen.getByLabelText("Competition"), { target: { value: "Premier League" } });
    fireEvent.change(screen.getByLabelText("Market"), { target: { value: "FT_TOTAL" } });
    fireEvent.change(screen.getByLabelText("Mapping"), { target: { value: "VERIFIED" } });

    expect(screen.getByText("Northbridge")).toBeTruthy();
    expect(screen.queryByText("City Academy")).toBeNull();
    const table = within(screen.getByRole("table"));
    expect(table.getByText(/FT_TOTAL/u)).toBeTruthy();
    expect(table.queryByText(/FT_1X2/u)).toBeNull();

    fireEvent.change(screen.getByLabelText("Timing"), { target: { value: "LIVE" } });
    expect(screen.getByText("No events match these filters.")).toBeTruthy();
  });

  it("exposes a review-required market under a verified parent event", () => {
    const market = {
      ...snapshot.markets[0]!,
      canonicalMarketId: "football-review-market",
      marketType: "FT_AH" as const,
      mappingStatus: "REVIEW_REQUIRED" as const
    };
    render(<App initialSnapshot={{ ...snapshot, markets: [...snapshot.markets, market] }} />);
    fireEvent.click(screen.getByRole("link", { name: "Football Overview" }));

    fireEvent.change(screen.getByLabelText("Mapping"), { target: { value: "REVIEW_REQUIRED" } });

    const northbridgeRow = screen.getByText("Northbridge").closest("tr")!;
    expect(within(northbridgeRow).getByText(/FT_AH/u)).toBeTruthy();
    expect(within(northbridgeRow).queryByText(/FT_1X2/u)).toBeNull();
  });

  it("uses authoritative lifecycle state and fails closed when lifecycle is unknown", () => {
    const authoritative = {
      ...snapshot,
      events: [
        { ...snapshot.events[0]!, startAtUtcMs: snapshot.generatedAtMs + 60_000, isLive: true },
        { ...snapshot.events[1]!, startAtUtcMs: snapshot.generatedAtMs - 60_000, isLive: false },
        { ...snapshot.events[0]!, canonicalEventId: "football-unknown", participantA: "Unknown State", providerEventIds: ["saba-unknown", "im-unknown"], isLive: null }
      ]
    };
    render(<App initialSnapshot={authoritative} />);
    fireEvent.click(screen.getByRole("link", { name: "Football Overview" }));

    expect(within(screen.getByText("Northbridge").closest("tr")!).getByText("Live")).toBeTruthy();
    expect(within(screen.getByText("City Academy").closest("tr")!).getByText("Pre-match")).toBeTruthy();
    expect(within(screen.getByText("Unknown State").closest("tr")!).getByText("Unknown")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Timing"), { target: { value: "LIVE" } });
    expect(screen.getByText("Northbridge")).toBeTruthy();
    expect(screen.queryByText("City Academy")).toBeNull();
    expect(screen.queryByText("Unknown State")).toBeNull();

    fireEvent.change(screen.getByLabelText("Timing"), { target: { value: "PRE_MATCH" } });
    expect(screen.getByText("City Academy")).toBeTruthy();
    expect(screen.queryByText("Northbridge")).toBeNull();
    expect(screen.queryByText("Unknown State")).toBeNull();
  });

  it("does not leak Football filter choices into the LoL category", () => {
    render(<App initialSnapshot={snapshot} />);
    fireEvent.click(screen.getByRole("link", { name: "Football Overview" }));
    fireEvent.change(screen.getByLabelText("Timing"), { target: { value: "LIVE" } });
    expect(screen.getByText("City Academy")).toBeTruthy();

    fireEvent.click(screen.getByRole("link", { name: "LoL Overview" }));
    expect(screen.getByText("Blue Comets")).toBeTruthy();
    expect((screen.getByLabelText("Timing") as HTMLSelectElement).value).toBe("ALL");
  });

  it("renders Back and Forward navigation, announces the route, and moves focus to main", async () => {
    render(<App initialSnapshot={snapshot} />);
    fireEvent.click(screen.getByRole("link", { name: "Football Overview" }));
    fireEvent.click(screen.getByRole("link", { name: "LoL Overview" }));

    window.history.back();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Football" })).toBeTruthy());
    expect(screen.getByRole("status").textContent).toContain("Football");
    expect(document.activeElement).toBe(document.querySelector("main"));
    expect(screen.getByRole("link", { name: "Football Overview" }).getAttribute("aria-current")).toBe("page");

    window.history.forward();
    await waitFor(() => expect(screen.getByRole("heading", { name: "LoL" })).toBeTruthy());
    expect(screen.getByRole("status").textContent).toContain("LoL");
  });

  it("labels the mapping view while its first snapshot is loading", () => {
    vi.stubGlobal("fetch", () => new Promise<Response>(() => {}));
    window.history.pushState({}, "", "/mappings");
    try {
      render(<App />);
      expect(screen.getByRole("heading", { name: "Loading Mapping Review" })).toBeTruthy();
      expect(screen.getByText(/No opportunity or mapping decision is available yet/i)).toBeTruthy();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
