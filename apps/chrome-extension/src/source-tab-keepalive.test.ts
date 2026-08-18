import { describe, expect, it, vi } from "vitest";
import { SourceTabKeepAlive } from "./source-tab-keepalive.js";

describe("SourceTabKeepAlive", () => {
  it("keeps an attached provider tab active while it is in the background", async () => {
    const attach = vi.fn(async () => undefined);
    const sendCommand = vi.fn(async () => undefined);
    const keepAlive = new SourceTabKeepAlive({
      attach,
      detach: vi.fn(async () => undefined),
      sendCommand
    });

    await keepAlive.attach(17);

    expect(attach).toHaveBeenCalledWith(17);
    expect(sendCommand.mock.calls).toEqual([
      [17, "Emulation.setFocusEmulationEnabled", { enabled: true }],
      [17, "Page.setWebLifecycleState", { state: "active" }]
    ]);
  });

  it("reasserts active lifecycle without attaching a second debugger", async () => {
    const attach = vi.fn(async () => undefined);
    const sendCommand = vi.fn(async () => undefined);
    const keepAlive = new SourceTabKeepAlive({
      attach,
      detach: vi.fn(async () => undefined),
      sendCommand
    });

    await keepAlive.pulse(17);

    expect(attach).not.toHaveBeenCalled();
    expect(sendCommand).toHaveBeenCalledWith(17, "Page.setWebLifecycleState", { state: "active" });
  });
});
