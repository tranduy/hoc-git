import { describe, expect, it, vi } from "vitest";
import { retrySabaBootstrapRefresh } from "./saba-bootstrap-refresh.js";

describe("retrySabaBootstrapRefresh", () => {
  it("requests a baseline immediately and retries after the owning frame contexts attach", async () => {
    const delays: number[] = [];
    const refresh = vi.fn(async () => undefined);

    await retrySabaBootstrapRefresh(refresh, () => false,
      async (delayMs) => { delays.push(delayMs); });

    expect(delays).toEqual([0, 1_000, 5_000, 15_000, 30_000]);
    expect(refresh).toHaveBeenCalledTimes(5);
  });

  it("continues after an early main-frame probe cannot see the SABA socket", async () => {
    const refresh = vi.fn()
      .mockRejectedValueOnce(new Error("SABA_SOCKET_CONTEXT_NOT_READY"))
      .mockResolvedValue(undefined);

    await expect(retrySabaBootstrapRefresh(refresh, () => false,
      async () => undefined)).resolves.toBeUndefined();
    expect(refresh).toHaveBeenCalledTimes(5);
  });

  it("stops retrying as soon as the SABA socket baseline is complete", async () => {
    let ready = false;
    const refresh = vi.fn(async () => { ready = true; });
    const delays: number[] = [];

    await retrySabaBootstrapRefresh(refresh, () => ready,
      async (delayMs) => { delays.push(delayMs); });

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(delays).toEqual([0]);
  });
});
