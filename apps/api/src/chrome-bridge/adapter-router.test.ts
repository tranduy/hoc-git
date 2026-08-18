import { describe, expect, it } from "vitest";
import type { ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import { AdapterRouter, canCompareSources, type ChromeTrafficAdapter } from "./adapter-router.js";

function envelope(body: string, hostname = "sports.example"): ChromeBridgeEnvelope {
  return {
    version: 1, kind: "NETWORK", lobby: "SABA", sourceId: "chrome:SABA:7", tabId: 7, sequence: 0,
    observedAtMs: 1_000, receivedMonotonicMs: 50, transport: "WS_FRAME",
    request: { hostname, pathnameClass: "/feed", resourceType: "WebSocket" },
    payload: { encoding: "UTF8", body }
  };
}

const sabaAdapter: ChromeTrafficAdapter = {
  id: "saba-v1",
  lobby: "SABA",
  providerFamily: "SABA",
  fingerprint: (value) => value.request.hostname === "sports.example" && value.payload.body.includes("marketId"),
  decode: () => []
};

describe("AdapterRouter", () => {
  it("does not activate from hostname alone and locks after stable schema evidence", () => {
    const router = new AdapterRouter([sabaAdapter], { confirmationsRequired: 2 });
    expect(router.route(envelope("{}"))).toMatchObject({ status: "CANDIDATE", adapter: null });
    expect(router.route(envelope('{"marketId":1}'))).toMatchObject({ status: "CANDIDATE", adapter: null });
    expect(router.route({ ...envelope('{"marketId":2}'), sequence: 1 })).toMatchObject({
      status: "TRUSTED", adapter: sabaAdapter
    });
  });

  it("quarantines only the conflicting tab", () => {
    const conflicting: ChromeTrafficAdapter = {
      ...sabaAdapter,
      id: "other-v1",
      fingerprint: (value) => value.payload.body.includes("otherMarker")
    };
    const router = new AdapterRouter([sabaAdapter, conflicting], { confirmationsRequired: 1 });
    expect(router.route(envelope('{"marketId":1,"otherMarker":true}'))).toMatchObject({ status: "QUARANTINED" });
    expect(router.route({ ...envelope('{"marketId":1}'), sourceId: "chrome:SABA:8", tabId: 8 })).toMatchObject({
      status: "TRUSTED",
      adapter: sabaAdapter
    });
  });

  it("exposes source identity separately from bookmaker family", () => {
    const router = new AdapterRouter([sabaAdapter], { confirmationsRequired: 1 });
    const result = router.route(envelope('{"marketId":1}'));
    expect(result).toMatchObject({ sourceId: "chrome:SABA:7", providerFamily: "SABA" });
  });

  it("blocks comparison between different lobby sources owned by one bookmaker family", () => {
    expect(canCompareSources(
      { sourceId: "chrome:KSPORT:3", providerFamily: "SBOBET" },
      { sourceId: "chrome:SBO:4", providerFamily: "SBOBET" }
    )).toBe(false);
    expect(canCompareSources(
      { sourceId: "chrome:SABA:3", providerFamily: "SABA" },
      { sourceId: "chrome:SBO:4", providerFamily: "SBOBET" }
    )).toBe(true);
  });
});
