import { describe, expect, it } from "vitest";

import { ConfiguredProxyAuthEgress, DirectAuthEgress } from "./auth-egress.js";

describe("DirectAuthEgress", () => {
  it("leases direct network access without a Playwright proxy", async () => {
    const lease = await new DirectAuthEgress().acquire(new AbortController().signal);

    expect(lease.name).toBe("DIRECT");
    expect(lease.playwrightProxy).toBeNull();
    await lease.release();
    await lease.release();
  });

  it("fails before acquiring when the request is already aborted", async () => {
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));

    await expect(new DirectAuthEgress().acquire(controller.signal)).rejects.toThrow("cancelled");
  });
});

describe("ConfiguredProxyAuthEgress", () => {
  it.each([
    ["http://127.0.0.1:8080", "http://127.0.0.1:8080"],
    ["https://proxy.example:8443/", "https://proxy.example:8443"],
    ["socks5://127.0.0.1:40000", "socks5://127.0.0.1:40000"],
  ])("normalizes supported proxy URL %s", async (input, expected) => {
    const lease = await new ConfiguredProxyAuthEgress(input).acquire(
      new AbortController().signal,
    );

    expect(lease.name).toBe("CONFIGURED_PROXY");
    expect(lease.playwrightProxy).toEqual({ server: expected });
    await lease.release();
  });

  it.each([
    "ftp://127.0.0.1:21",
    "http://user:secret@127.0.0.1:8080",
    "not-a-url",
  ])("rejects unsafe or unsupported proxy URL %s", (proxyUrl) => {
    expect(() => new ConfiguredProxyAuthEgress(proxyUrl)).toThrow();
  });
});
