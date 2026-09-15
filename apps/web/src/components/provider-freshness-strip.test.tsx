import { act, cleanup, render, screen } from "@testing-library/react";
import type { CatalogSourceStatus } from "@tool-chenh/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProviderFreshnessStrip, classifyFreshness, formatAge, sessionNeedsAttention }
  from "./provider-freshness-strip.js";

const source = (provider: CatalogSourceStatus["provider"], acquiredAtMs: number | null,
  sessionState: CatalogSourceStatus["sessionState"] = "ACTIVE"): CatalogSourceStatus => ({
  id: `catalog-source:${provider}:FOOTBALL`, alias: provider, provider, category: "FOOTBALL",
  sessionState, acquiredAtMs, reason: null
});

describe("classifyFreshness", () => {
  it("maps catalog age onto LIVE / SLOW / STALE / NONE", () => {
    const now = 100_000;
    expect(classifyFreshness(source("SABA", 95_000), now).tone).toBe("LIVE");
    expect(classifyFreshness(source("SABA", 85_000), now).tone).toBe("LIVE");
    expect(classifyFreshness(source("SABA", 75_000), now).tone).toBe("SLOW");
    // 30 s is the operator contract; anything older is not answering.
    expect(classifyFreshness(source("SABA", 70_000), now).tone).toBe("SLOW");
    expect(classifyFreshness(source("SABA", 69_000), now).tone).toBe("STALE");
    expect(classifyFreshness(source("SABA", null, "UNCONFIGURED"), now)).toMatchObject({ tone: "NONE", ageMs: null });
  });

  it("formats ages for humans", () => {
    expect(formatAge(null)).toBe("no data yet");
    expect(formatAge(4_900)).toBe("4s ago");
    expect(formatAge(125_000)).toBe("2m 5s ago");
    expect(formatAge(3_725_000)).toBe("1h 2m ago");
  });
});

describe("ProviderFreshnessStrip", () => {
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it("shows every provider of the category with its age and keeps counting between polls", async () => {
    vi.useFakeTimers();
    let now = 1_000_000;
    const list = vi.fn(async () => [
      source("SABA", now - 3_000),
      source("IM", now - 22_000),
      source("BTI", now - 45_000),
      source("CMD", null, "UNCONFIGURED"),
      { ...source("SABA", now - 1_000), id: "catalog-source:SABA:LOL", category: "LOL" as const }
    ]);

    render(<ProviderFreshnessStrip api={{ list }} category="FOOTBALL" pollMs={2_000} now={() => now} />);
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByTestId("provider-freshness-SABA").textContent).toContain("Fresh");
    expect(screen.getByTestId("provider-freshness-SABA").textContent).toContain("3s ago");
    expect(screen.getByTestId("provider-freshness-IM").textContent).toContain("Lagging");
    // Past the 30s contract a book is not answering, not merely slow.
    expect(screen.getByTestId("provider-freshness-BTI").textContent).toContain("Outdated");
    expect(screen.getByTestId("provider-freshness-CMD").textContent).toContain("No data");
    expect(screen.getByTestId("provider-freshness-CMD").textContent).toContain("no data yet");
    expect(screen.queryByTestId("provider-freshness-LOL")).toBeNull();

    // One second later, without a new poll, the age advances.
    now += 1_000;
    await act(async () => { vi.advanceTimersByTime(1_000); });
    expect(screen.getByTestId("provider-freshness-SABA").textContent).toContain("4s ago");

    // The strip keeps polling.
    await act(async () => { vi.advanceTimersByTime(2_000); await Promise.resolve(); });
    expect(list.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("says a book needs signing in even while its catalog is perfectly fresh", async () => {
    // Freshness and session health are independent: the extension reads a
    // logged-in tab and never touches the stored secret, so an expired session
    // has no symptom here. Measured 2026-09-15, every session was past renewal,
    // the newest by twenty-seven hours, and this strip read Fresh for all six.
    const now = 1_000_000;
    const list = vi.fn(async () => [
      { ...source("SABA", now - 3_000), reason: "EXPIRED" as const },
      source("BTI", now - 3_000)
    ]);

    render(<ProviderFreshnessStrip api={{ list }} category="FOOTBALL" pollMs={60_000} now={() => now} />);
    await act(async () => { await Promise.resolve(); });

    expect(screen.getByTestId("provider-freshness-SABA").textContent).toContain("Fresh");
    expect(screen.getByTestId("provider-session-SABA").textContent).toBe("session expired");
    expect(screen.queryByTestId("provider-session-BTI")).toBeNull();
  });

  it("separates an expired session from a book that never signed in", () => {
    expect(sessionNeedsAttention({ ...source("SABA", 1), reason: "EXPIRED" })).toBe(true);
    expect(sessionNeedsAttention(source("SABA", 1, "ACTION_REQUIRED"))).toBe(true);
    expect(sessionNeedsAttention(source("SABA", 1))).toBe(false);
  });

  it("surfaces a fetch failure instead of hiding the strip", async () => {
    const list = vi.fn(async () => { throw new Error("Catalog source request timed out"); });
    render(<ProviderFreshnessStrip api={{ list }} category="FOOTBALL" pollMs={60_000} />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole("status").textContent).toContain("timed out");
  });
});
