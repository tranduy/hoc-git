import { describe, expect, it, vi } from "vitest";
import { ApsportPageRecoveryWatchdog } from "./apsport-page-recovery.js";

const emptyPage = {
  sourceId: "chrome:TSPORT:7",
  tabId: 7,
  rosterCount: 229,
  matchRows: 0
} as const;

describe("ApsportPageRecoveryWatchdog", () => {
  it("does not reload APSPORT from virtualized DOM emptiness alone", async () => {
    const reload = vi.fn(async (_tabId: number) => undefined);
    const watchdog = new ApsportPageRecoveryWatchdog({ reload });

    for (let sample = 0; sample < 12; sample += 1) await watchdog.observe(emptyPage);

    expect(reload).not.toHaveBeenCalled();
  });

  it("does not reload when the authenticated API roster is actually empty", async () => {
    const reload = vi.fn(async (_tabId: number) => undefined);
    const watchdog = new ApsportPageRecoveryWatchdog({ reload });

    for (let sample = 0; sample < 6; sample += 1) {
      await watchdog.observe({ ...emptyPage, rosterCount: 0 });
    }

    expect(reload).not.toHaveBeenCalled();
  });

});
