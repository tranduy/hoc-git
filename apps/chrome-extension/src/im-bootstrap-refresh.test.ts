import { describe, expect, it, vi } from "vitest";
import { retryImBootstrapRefresh } from "./im-bootstrap-refresh.js";

describe("retryImBootstrapRefresh", () => {
  it("retries the in-page IM snapshot while a new one-time launch finishes bootstrapping", async () => {
    const delays: number[] = [];
    const refresh = vi.fn(async () => undefined);

    await retryImBootstrapRefresh(refresh, async (delayMs) => { delays.push(delayMs); });

    expect(delays).toEqual([1_000, 4_000, 8_000]);
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it("continues after a transient early refresh failure", async () => {
    const refresh = vi.fn()
      .mockRejectedValueOnce(new Error("IM_TOKEN_NOT_READY"))
      .mockResolvedValue(undefined);

    await expect(retryImBootstrapRefresh(refresh, async () => undefined)).resolves.toBeUndefined();
    expect(refresh).toHaveBeenCalledTimes(3);
  });
});
