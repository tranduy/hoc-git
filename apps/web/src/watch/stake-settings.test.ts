import { beforeEach, describe, expect, it } from "vitest";
import { loadBaseStake, saveBaseStake, WATCH_BASE_STAKE_STORAGE_KEY } from "./stake-settings.js";

const unavailableStorage = {
  getItem: () => { throw new DOMException("Storage unavailable", "SecurityError"); },
  setItem: () => { throw new DOMException("Quota exceeded", "QuotaExceededError"); }
} as unknown as Storage;

describe("global base stake settings", () => {
  beforeEach(() => window.localStorage.clear());

  it("defaults to 100000 and persists a valid whole 1000 VND step", () => {
    expect(loadBaseStake(window.localStorage)).toBe("100000");
    expect(saveBaseStake(window.localStorage, "150000")).toBe(true);
    expect(window.localStorage.getItem(WATCH_BASE_STAKE_STORAGE_KEY)).toBe("150000");
    expect(loadBaseStake(window.localStorage)).toBe("150000");
  });

  it.each(["", "29999", "30500", "1e5", "bad", "100000.5"])("rejects invalid base stake %s", (value) => {
    window.localStorage.setItem(WATCH_BASE_STAKE_STORAGE_KEY, "100000");
    expect(saveBaseStake(window.localStorage, value)).toBe(false);
    expect(loadBaseStake(window.localStorage)).toBe("100000");
  });

  it("falls back without crashing when browser storage is unavailable or full", () => {
    expect(loadBaseStake(unavailableStorage)).toBe("100000");
    expect(saveBaseStake(unavailableStorage, "150000")).toBe(false);
  });
});
