import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProxyOptions } from "vite";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("Vite API WebSocket proxy", () => {
  it("forwards the trusted dashboard origin during the WebSocket upgrade", async () => {
    vi.stubEnv("VITE_ORIGIN", "https://live.babiesbo.uk");
    const { default: config } = await import("../vite.config.js");
    const proxyOptions = config.server!.proxy!["/api"] as ProxyOptions;
    const handlers = new Map<string, (...args: readonly unknown[]) => void>();
    const proxy = { on: (name: string, handler: (...args: readonly unknown[]) => void) => {
      handlers.set(name, handler);
      return proxy;
    } };
    proxyOptions.configure?.(proxy as never, proxyOptions as never);
    const setHeader = vi.fn();

    handlers.get("proxyReqWs")?.({ headersSent: false, setHeader }, {}, {}, proxyOptions, {});

    expect(setHeader).toHaveBeenCalledWith("origin", "https://live.babiesbo.uk");
  });
});
