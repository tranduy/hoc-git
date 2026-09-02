import { describe, expect, it, vi } from "vitest";
import { ApsportPageRecoveryWatchdog } from "./apsport-page-recovery.js";

const emptyPage = {
  sourceId: "chrome:TSPORT:7",
  tabId: 7,
  rosterCount: 229,
  matchRows: 0
} as const;

describe("ApsportPageRecoveryWatchdog", () => {
  it("reloads one APSPORT tab only after three empty samples backed by a non-empty API roster", async () => {
    const reload = vi.fn(async (_tabId: number) => undefined);
    const watchdog = new ApsportPageRecoveryWatchdog({ reload });

    await watchdog.observe(emptyPage);
    await watchdog.observe(emptyPage);
    expect(reload).not.toHaveBeenCalled();

    await watchdog.observe(emptyPage);
    await watchdog.observe(emptyPage);
    expect(reload).toHaveBeenCalledOnce();
    expect(reload).toHaveBeenCalledWith(7);
  });

  it("re-arms only after the provider page renders matches again", async () => {
    const reload = vi.fn(async (_tabId: number) => undefined);
    const watchdog = new ApsportPageRecoveryWatchdog({ reload });

    for (let sample = 0; sample < 3; sample += 1) await watchdog.observe(emptyPage);
    await watchdog.observe({ ...emptyPage, matchRows: 4 });
    for (let sample = 0; sample < 3; sample += 1) await watchdog.observe(emptyPage);

    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("does not reload when the authenticated API roster is actually empty", async () => {
    const reload = vi.fn(async (_tabId: number) => undefined);
    const watchdog = new ApsportPageRecoveryWatchdog({ reload });

    for (let sample = 0; sample < 6; sample += 1) {
      await watchdog.observe({ ...emptyPage, rosterCount: 0 });
    }

    expect(reload).not.toHaveBeenCalled();
  });

  it("retries after five minutes when a renewal completes but the page stays empty", async () => {
    let now = 1_000;
    const reload = vi.fn(async (_tabId: number) => undefined);
    const watchdog = new ApsportPageRecoveryWatchdog({ reload, now: () => now });

    for (let sample = 0; sample < 3; sample += 1) await watchdog.observe(emptyPage);
    now += 5 * 60_000 - 1;
    await watchdog.observe(emptyPage);
    expect(reload).toHaveBeenCalledTimes(1);

    now += 1;
    await watchdog.observe(emptyPage);
    expect(reload).toHaveBeenCalledTimes(2);
  });
});
