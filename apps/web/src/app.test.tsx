import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { AppSnapshot } from "@tool-chenh/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./app.js";

const snapshot: AppSnapshot = {
  revision: 1, generatedAtMs: 1, providerStatuses: [],
  counts: { FOOTBALL: { events: 0, markets: 0 }, LOL: { events: 0, markets: 0 },
    mappings: { VERIFIED: 0, REVIEW_REQUIRED: 0, REJECTED: 0 }, opportunities: 0 },
  events: [], markets: [], opportunities: [], blockedDiagnostics: []
};

describe("Football-only application shell", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("chrome-bridge/features")) return new Response(JSON.stringify({ openProviderTicket: true }), { status: 200 });
      return new Response(JSON.stringify([]), { status: 200 });
    }));
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("routes the root directly to Football and renders no permanent navigation menu", async () => {
    render(<App initialSnapshot={snapshot} />);
    expect(screen.getByRole("heading", { name: "Football Live Price Gaps" })).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Primary navigation" })).toBeNull();
    await waitFor(() => expect(window.location.pathname).toBe("/football-live"));
  });

  it("keeps secondary diagnostic routes directly addressable without exposing a sidebar", () => {
    window.history.replaceState({}, "", "/mappings");
    render(<App initialSnapshot={snapshot} />);
    expect(screen.getByRole("heading", { name: "Mapping Review" })).toBeTruthy();
    expect(screen.queryByRole("navigation")).toBeNull();
  });
});
