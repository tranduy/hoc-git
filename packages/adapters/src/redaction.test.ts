import { describe, expect, it } from "vitest";
import { redactCapture } from "./redaction.js";

describe("redactCapture", () => {
  it("redacts nested secret keys without changing provider quote fields", () => {
    const capture = {
      token: "top-secret-token",
      ACCESS_TOKEN: "top-secret-access-token",
      nested: {
        Cookie: "sid=top-secret-cookie",
        authorization: "Bearer top-secret-bearer",
        accountId: "private-account",
        MEMBERCODE: "private-member",
        providerEventId: "saba-football-101",
        providerMarketId: "saba-total-101",
        providerSelectionId: "saba-over-25",
        rawOdds: "2.08",
        sourceTimestampMs: 1_800_000_000_000,
        receivedMonotonicMs: 250
      }
    };

    expect(redactCapture(capture)).toEqual({
      token: "REDACTED",
      ACCESS_TOKEN: "REDACTED",
      nested: {
        Cookie: "REDACTED",
        authorization: "REDACTED",
        accountId: "REDACTED",
        MEMBERCODE: "REDACTED",
        providerEventId: "saba-football-101",
        providerMarketId: "saba-total-101",
        providerSelectionId: "saba-over-25",
        rawOdds: "2.08",
        sourceTimestampMs: 1_800_000_000_000,
        receivedMonotonicMs: 250
      }
    });
  });

  it("redacts sensitive URL query parameters and preserves ordinary parameters", () => {
    const capture = {
      endpoint: "https://fixture.invalid/feed?sport=football&session=secret-session&TOKEN=secret-token&accountId=secret-account&page=2",
      relative: "/stream?memberCode=secret-member&market=FT_TOTAL",
      ordinary: "provider://feed?providerEventId=saba-101&selection=OVER"
    };

    expect(redactCapture(capture)).toEqual({
      endpoint: "https://fixture.invalid/feed?sport=football&session=REDACTED&TOKEN=REDACTED&accountId=REDACTED&page=2",
      relative: "/stream?memberCode=REDACTED&market=FT_TOTAL",
      ordinary: "provider://feed?providerEventId=saba-101&selection=OVER"
    });
  });

  it("replaces circular references with a safe marker", () => {
    const capture: Record<string, unknown> = { providerEventId: "event-1" };
    capture.self = capture;

    expect(redactCapture(capture)).toEqual({
      providerEventId: "event-1",
      self: "[Circular]"
    });
  });

  it("throws a generic error without leaking values from hostile getters", () => {
    const capture = Object.defineProperty({}, "payload", {
      enumerable: true,
      get(): never {
        throw new Error("top-secret-from-getter");
      }
    });

    expect(() => redactCapture(capture)).toThrow("Unable to redact capture");
    expect(() => redactCapture(capture)).not.toThrow("top-secret-from-getter");
  });
});
