import { describe, expect, it, vi } from "vitest";
import type { RefreshableProvider } from "./routes/maintenance.js";
import {
  describeProviderReset, providerResetFailure, RESET_PROVIDERS, resetProviderSources, resetTimedOut
} from "./catalog-reset.js";

const noSleep = async (): Promise<void> => undefined;

describe("resetProviderSources", () => {
  it("drives every attached book instead of relaunching the browser side", async () => {
    const refresh = vi.fn(async (provider: RefreshableProvider) => provider.length);
    const outcomes = await resetProviderSources({ refresh, sleep: noSleep });
    expect(refresh.mock.calls.map(([provider]) => provider)).toEqual([...RESET_PROVIDERS]);
    expect(outcomes.every((outcome) => outcome.failure === null)).toBe(true);
  });

  it("lets the healthy books finish when one book never comes back", async () => {
    const outcomes = await resetProviderSources({
      providers: ["CMD", "IM", "BTI"],
      sleep: noSleep,
      refresh: async (provider) => {
        if (provider === "IM") throw new Error("CHROME_BRIDGE_SNAPSHOT_UNDELIVERED:IM");
        return 1;
      }
    });
    expect(outcomes.map((outcome) => outcome.failure)).toEqual([
      null, "CHROME_BRIDGE_SNAPSHOT_UNDELIVERED:IM", null
    ]);
    expect(providerResetFailure(outcomes)).toBeNull();
  });

  it("reports each book the moment it comes back, not only at the end", async () => {
    const seen: string[] = [];
    let releaseCmd = (): void => undefined;
    const cmdBlocked = new Promise<void>((resolve) => { releaseCmd = resolve; });
    const running = resetProviderSources({
      providers: ["CMD", "BTI"],
      sleep: noSleep,
      onOutcome: (outcome) => { seen.push(outcome.provider); },
      refresh: async (provider) => {
        if (provider === "CMD") await cmdBlocked;
        return 1;
      }
    });
    await vi.waitFor(() => { expect(seen).toEqual(["BTI"]); });
    releaseCmd();
    await running;
    expect(seen).toEqual(["BTI", "CMD"]);
  });

  it("starts the books apart so six bootstraps do not land in one tick", async () => {
    const order: string[] = [];
    await resetProviderSources({
      providers: ["CMD", "BTI"],
      staggerMs: 1_500,
      sleep: async (delayMs) => { order.push(`sleep:${delayMs}`); },
      refresh: async (provider) => { order.push(`refresh:${provider}`); return 1; }
    });
    expect(order).toEqual(["refresh:CMD", "sleep:1500", "refresh:BTI"]);
  });

  it("only fails the reset when no book at all came back", async () => {
    const outcomes = await resetProviderSources({
      providers: ["CMD", "IM"],
      sleep: noSleep,
      refresh: async () => { throw new Error("PROVIDER_FEED_BASELINE_TIMEOUT"); }
    });
    const failure = providerResetFailure(outcomes);
    expect(failure?.message).toBe(
      "CHROME_BRIDGE_RESET_INCOMPLETE:CMD=PROVIDER_FEED_BASELINE_TIMEOUT;IM=PROVIDER_FEED_BASELINE_TIMEOUT"
    );
  });

  it("names the books that did and did not come back", () => {
    expect(describeProviderReset([
      { provider: "CMD", delivered: 1, failure: null },
      { provider: "IM", delivered: null, failure: "CHROME_BRIDGE_SNAPSHOT_UNDELIVERED:IM" }
    ])).toBe("Reset sàn: 1/2 sàn đã lấy kèo lại (CMD); " +
      "chưa lấy lại được: IM(CHROME_BRIDGE_SNAPSHOT_UNDELIVERED:IM)");
  });

  it("does not call a book failed when only its baseline was late", () => {
    // Measured 2026-09-13: a reset reported SBOBET and SABA as not recovered,
    // and both were LIVE and quoting three minutes later.
    expect(resetTimedOut("PROVIDER_FEED_BASELINE_TIMEOUT")).toBe(true);
    expect(resetTimedOut("CHROME_BRIDGE_SNAPSHOT_UNDELIVERED:IM")).toBe(false);
    expect(describeProviderReset([
      { provider: "CMD", delivered: 1, failure: null },
      { provider: "SABA", delivered: null, failure: "PROVIDER_FEED_BASELINE_TIMEOUT" },
      { provider: "IM", delivered: null, failure: "CHROME_BRIDGE_SNAPSHOT_UNDELIVERED:IM" }
    ])).toBe("Reset sàn: 1/3 sàn đã lấy kèo lại (CMD); " +
      "đã khởi động lại nhưng chưa kịp báo về trong 90 giây: SABA; " +
      "chưa lấy lại được: IM(CHROME_BRIDGE_SNAPSHOT_UNDELIVERED:IM)");
  });
});
