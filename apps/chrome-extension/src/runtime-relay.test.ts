import { describe, expect, it, vi } from "vitest";
import { createRuntimeRelay } from "./runtime-relay.js";

describe("createRuntimeRelay", () => {
  it("stops calling an invalidated extension context after a synchronous failure", () => {
    const sendMessage = vi.fn(() => { throw new Error("Extension context invalidated."); });
    const relay = createRuntimeRelay(sendMessage);

    expect(() => relay({ kind: "NETWORK_CAPTURE" })).not.toThrow();
    expect(() => relay({ kind: "NETWORK_CAPTURE" })).not.toThrow();
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it("absorbs an asynchronous send failure and disables later sends", async () => {
    const sendMessage = vi.fn(() => Promise.reject(new Error("Extension context invalidated.")));
    const relay = createRuntimeRelay(sendMessage);

    relay({ kind: "NETWORK_CAPTURE" });
    await Promise.resolve();
    await Promise.resolve();
    relay({ kind: "NETWORK_CAPTURE" });

    expect(sendMessage).toHaveBeenCalledTimes(1);
  });
});
