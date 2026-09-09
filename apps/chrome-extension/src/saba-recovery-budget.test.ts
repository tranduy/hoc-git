import { describe, expect, it, vi } from "vitest";
import { SabaRecoveryBudget } from "./saba-recovery-budget.js";

describe("SABA recovery admission", () => {
  it("paces three attempts then rests five minutes before another batch", async () => {
    let now = 1_000;
    const budget = new SabaRecoveryBudget({ now: () => now });
    expect(await budget.admit()).toBe(true);
    expect(await budget.admit()).toBe(false);
    now += 30_000;
    expect(await budget.admit()).toBe(true);
    now += 30_000;
    expect(await budget.admit()).toBe(true);
    now += 299_999;
    expect(await budget.admit()).toBe(false);
    now += 1;
    expect(await budget.admit()).toBe(true);
    expect(budget.snapshot().attempts).toBe(1);
  });

  it("persists admission before work and shares the deadline after restart", async () => {
    let stored: unknown;
    const save = vi.fn(async (state) => { stored = state; });
    const first = new SabaRecoveryBudget({ now: () => 1_000, save });
    const admitted = await Promise.all([first.admit(), first.admit(), first.admit()]);
    expect(admitted.filter(Boolean)).toHaveLength(1);
    expect(save).toHaveBeenCalledTimes(1);
    const restarted = new SabaRecoveryBudget({ now: () => 2_000, load: async () => stored });
    expect(await restarted.admit()).toBe(false);
  });

  it("does not run recovery if saving its deadline fails", async () => {
    const budget = new SabaRecoveryBudget({ now: () => 1_000,
      save: async () => { throw new Error("storage unavailable"); } });
    expect(await budget.admit()).toBe(false);
    expect(await budget.admit()).toBe(false);
  });

  it("backs off after storage read failure instead of starting a burst", async () => {
    const budget = new SabaRecoveryBudget({ now: () => 1_000,
      load: async () => { throw new Error("storage unavailable"); } });
    expect(await budget.admit()).toBe(false);
  });
});
