import { describe, expect, it } from "vitest";
import { observeProtocolMetadata, structuralBodyHash } from "./protocol-inspector.js";

describe("protocol inspector", () => {
  it("removes query, fragment, credentials, and identifier-shaped path values", () => {
    expect(observeProtocolMetadata({
      url: "https://user:pass@api.cmd.test/events/41385687/odds?token=secret-canary#authorization",
      method: "GET", transport: "FETCH", status: 200, contentType: "application/json"
    })).toEqual({
      hostname: "api.cmd.test", method: "GET", transport: "FETCH",
      pathTemplate: "/events/:id/odds", status: 200, contentType: "application/json"
    });
  });

  it.each([
    "https://secure.livechatinc.com/customer/action",
    "https://www.googletagmanager.com/collect",
    "https://static.cloudflareinsights.com/beacon"
  ])("ignores non-provider telemetry host %s", (url) => {
    expect(observeProtocolMetadata({ url, method: "GET", transport: "FETCH", status: 200, contentType: null })).toBeNull();
  });

  it("hashes body structure without retaining values", () => {
    const first = structuralBodyHash({ account: { balance: 100_000, name: "secret-name" }, events: [{ id: 1 }] });
    const second = structuralBodyHash({ account: { balance: 50, name: "other-secret" }, events: [{ id: 999 }] });
    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/u);
    expect(first).not.toContain("secret");
  });

  it("redacts ASP.NET session-routing path segments", () => {
    expect(observeProtocolMetadata({
      url: "https://sports.cmd.test/(S(Tesqedix87fa7fb3816a427abcd6196bc4d345f9))/LoginCheckin/Index",
      method: "POST", transport: "XHR", status: 200, contentType: "application/json"
    })?.pathTemplate).toBe("/:session/LoginCheckin/Index");
  });
});
