import { describe, expect, it, vi } from "vitest";
import { ApsportContextProbe } from "./apsport-context-probe.js";

describe("AP context timeout probe", () => {
  it("separates browser target health from a renderer timeout and reports only safe tab flags", async () => {
    const sendCommand = vi.fn(async (_tabId: number, method: string) => {
      if (method === "Target.getTargetInfo") return { targetInfo: {
        type: "page", attached: true, targetId: "private-target", url: "https://provider/?token=secret"
      } };
      throw Error("frame-command-timeout");
    });
    const probe = new ApsportContextProbe({ sendCommand, now: () => 10_000,
      readTabHealth: async () => ({ status: "complete", discarded: false, frozen: true,
        pendingNavigation: false, url: "https://provider/?token=secret" }) });
    const result = await probe.read(7);
    expect(result).toContain("target=page attached=true isolate=TIMEOUT");
    expect(result).toContain("tab=complete discarded=false frozen=true navigating=false");
    expect(result).not.toMatch(/secret|private-target|https/);
    expect(sendCommand.mock.calls.map((call) => call[1])).toEqual(["Target.getTargetInfo", "Runtime.getIsolateId"]);
  });

  it("coalesces in-flight probes and reuses evidence for one minute without issuing more commands", async () => {
    let now = 1_000;
    let finish!: (value: unknown) => void;
    const pending = new Promise((resolve) => { finish = resolve; });
    const sendCommand = vi.fn(async () => pending);
    const probe = new ApsportContextProbe({ sendCommand, now: () => now });
    const first = probe.read(7);
    const second = probe.read(7);
    expect(sendCommand).toHaveBeenCalledTimes(2);
    finish({ targetInfo: { type: "page", attached: true }, id: "private-isolate" });
    await Promise.all([first, second]);
    now += 59_000;
    expect(await probe.read(7)).toContain("ageMs=59000");
    expect(sendCommand).toHaveBeenCalledTimes(2);
    now += 1_000;
    await probe.read(7);
    expect(sendCommand).toHaveBeenCalledTimes(4);
  });

  it("bounds both unresponsive CDP commands and the optional tab lookup", async () => {
    vi.useFakeTimers();
    try {
      const probe = new ApsportContextProbe({ sendCommand: async () => new Promise(() => undefined),
        readTabHealth: async () => new Promise(() => undefined), timeoutMs: 100 });
      const pending = probe.read(7);
      await vi.advanceTimersByTimeAsync(101);
      const result = await pending;
      expect(result).toContain("target=TIMEOUT attached=unknown isolate=TIMEOUT tab=TIMEOUT");
    } finally { vi.useRealTimers(); }
  });
});
