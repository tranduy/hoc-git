import type { ProviderQuote } from "@tool-chenh/contracts";
import { describe, expect, it } from "vitest";
import {
  QuoteBook,
  quoteKey,
  type QuoteUpdate,
  type SourceFreshnessPolicy
} from "./quote-book.js";

const policies: Readonly<Record<string, SourceFreshnessPolicy>> = {
  SABA: {
    websocketTtlMs: 1_000,
    pollingTtlMs: 5_000,
    maxFutureClockSkewMs: 100,
    missingSourceTimestamp: "USE_RECEIVED_TIME"
  },
  IM: {
    websocketTtlMs: 2_000,
    pollingTtlMs: 8_000,
    maxFutureClockSkewMs: 100,
    missingSourceTimestamp: "REJECT"
  }
};

const quote = (overrides: Partial<ProviderQuote> = {}): ProviderQuote => ({
  provider: "SABA",
  category: "FOOTBALL",
  providerEventId: "event-1",
  providerMarketId: "market-1",
  providerSelectionId: "over",
  marketType: "FT_TOTAL",
  scope: "FULL_TIME",
  selection: "OVER",
  line: "2.5",
  rawOdds: "2.1",
  rawFormat: "DECIMAL",
  status: "OPEN",
  isLive: true,
  sourceTimestampMs: 1_000,
  receivedMonotonicMs: 1_000,
  sequence: 1,
  ...overrides
});

const update = (
  quotes: readonly unknown[],
  overrides: Partial<QuoteUpdate> = {}
): QuoteUpdate => ({
  kind: "DELTA",
  transport: "WEBSOCKET",
  nowMs: 1_000,
  quotes,
  ...overrides
});

describe("QuoteBook ordering and freshness", () => {
  it("accepts a strictly higher delta sequence", () => {
    const book = new QuoteBook(policies);
    expect(book.apply(update([quote()])).accepted).toBe(true);

    const result = book.apply(update([quote({ rawOdds: "2.2", sequence: 2 })]));

    expect(result).toMatchObject({ accepted: true, reason: null });
    expect(book.snapshot(1_000).quotes[0]?.quote.rawOdds).toBe("2.2");
  });

  it.each([1, 0])("ignores duplicate or lower sequence %s", (sequence) => {
    const book = new QuoteBook(policies);
    book.apply(update([quote({ sequence: 1 })]));

    const result = book.apply(update([quote({ rawOdds: "9", sequence })]));

    expect(result).toMatchObject({ accepted: false, reason: "OUT_OF_ORDER" });
    expect(book.snapshot(1_000).quotes[0]?.quote.rawOdds).toBe("2.1");
  });

  it("quarantines every selection in a market after a sequence gap until a fresh full snapshot", () => {
    const book = new QuoteBook(policies);
    book.apply(update([
      quote({ providerSelectionId: "over" }),
      quote({ providerSelectionId: "under", selection: "UNDER", rawOdds: "2.05" })
    ]));

    const gap = book.apply(update([quote({ sequence: 3 })]));
    expect(gap).toMatchObject({ accepted: false, reason: "SEQUENCE_GAP" });
    expect(book.snapshot(1_000).quotes.map((item) => item.ineligibilityReasons)).toEqual([
      ["NEEDS_SNAPSHOT"],
      ["NEEDS_SNAPSHOT"]
    ]);

    expect(book.apply(update([quote({ sequence: 2 })]))).toMatchObject({
      accepted: false,
      reason: "NEEDS_SNAPSHOT"
    });

    const recovered = book.apply(update([
      quote({ sequence: 4, rawOdds: "2.2" }),
      quote({
        providerSelectionId: "under",
        selection: "UNDER",
        sequence: 4,
        rawOdds: "1.9"
      })
    ], { kind: "FULL_SNAPSHOT" }));
    expect(recovered).toMatchObject({ accepted: true, reason: null });
    expect(book.snapshot(1_000).quotes.every((item) => item.eligible)).toBe(true);
  });

  it("immediately invalidates a suspended provider selection", () => {
    const book = new QuoteBook(policies);
    book.apply(update([quote()]));

    const result = book.apply(update([quote({ sequence: 2, status: "SUSPENDED" })]));
    const stored = book.snapshot(1_000).quotes[0]!;

    expect(result).toMatchObject({ accepted: true, reason: "SUSPENDED" });
    expect(stored.eligible).toBe(false);
    expect(stored.ineligibilityReasons).toEqual(["SUSPENDED"]);
  });

  it("immediately invalidates a closed provider selection", () => {
    const book = new QuoteBook(policies);

    const result = book.apply(update([quote({ status: "CLOSED" })]));

    expect(result).toMatchObject({ accepted: true, reason: "CLOSED" });
    expect(book.snapshot(1_000).quotes[0]).toMatchObject({
      eligible: false,
      ineligibilityReasons: ["CLOSED"]
    });
  });

  it("expires a WebSocket quote at its configured TTL", () => {
    const book = new QuoteBook(policies);
    book.apply(update([quote()]));

    expect(book.snapshot(1_999).quotes[0]?.eligible).toBe(true);
    expect(book.snapshot(2_000).quotes[0]).toMatchObject({
      eligible: false,
      ineligibilityReasons: ["STALE"]
    });
  });

  it("reports the earliest source or receive expiry for deterministic opportunity TTL", () => {
    const book = new QuoteBook(policies);
    book.apply(update([quote({ sourceTimestampMs: 500, receivedMonotonicMs: 1_000 })]));

    expect(book.snapshot(1_000).quotes[0]?.expiresAtMs).toBe(1_500);
    expect(book.snapshot(1_499).quotes[0]?.eligible).toBe(true);
    expect(book.snapshot(1_500).quotes[0]?.ineligibilityReasons).toContain("STALE");
  });

  it("expires a polling quote at its independently configured TTL", () => {
    const book = new QuoteBook(policies);
    book.apply(update([quote()], { transport: "POLLING" }));

    expect(book.snapshot(5_999).quotes[0]?.eligible).toBe(true);
    expect(book.snapshot(6_000).quotes[0]).toMatchObject({
      eligible: false,
      ineligibilityReasons: ["STALE"]
    });
  });

  it("blocks a quote whose source timestamp exceeds allowed future clock skew", () => {
    const book = new QuoteBook(policies);

    const result = book.apply(update([quote({ sourceTimestampMs: 1_101 })]));

    expect(result).toMatchObject({ accepted: true, reason: "CLOCK_SKEW" });
    expect(book.snapshot(1_000).quotes[0]).toMatchObject({
      eligible: false,
      ineligibilityReasons: ["CLOCK_SKEW"]
    });
  });

  it("applies the configured missing timestamp policy with explicit provenance", () => {
    const book = new QuoteBook(policies);
    const rejected = quote({
      provider: "IM",
      providerSelectionId: "im-over",
      sourceTimestampMs: null
    });
    const allowed = quote({ sourceTimestampMs: null });

    book.apply(update([rejected], { transport: "POLLING" }));
    book.apply(update([allowed], { transport: "POLLING" }));
    const snapshot = book.snapshot(1_000);

    expect(snapshot.byKey[quoteKey(rejected)]?.ineligibilityReasons).toEqual([
      "MISSING_TIMESTAMP"
    ]);
    expect(snapshot.byKey[quoteKey(allowed)]?.eligible).toBe(true);
  });

  it("fails closed when a provider freshness policy has an unknown timestamp mode", () => {
    const invalidPolicies = {
      SABA: { ...policies.SABA, missingSourceTimestamp: "GUESS" }
    } as unknown as Readonly<Record<string, SourceFreshnessPolicy>>;
    const book = new QuoteBook(invalidPolicies);

    expect(book.apply(update([quote()]))).toMatchObject({
      accepted: false,
      reason: "POLICY_MISSING"
    });
    expect(book.snapshot(1_000).quotes).toEqual([]);
  });

  it("rejects malformed quote payloads without replacing a valid quote", () => {
    const book = new QuoteBook(policies);
    book.apply(update([quote()]));

    const result = book.apply(update([{ ...quote({ sequence: 2 }), rawOdds: "NaN" }]));

    expect(result).toMatchObject({ accepted: false, reason: "SCHEMA_ERROR" });
    expect(result.diagnostics[0]?.reason).toBe("SCHEMA_ERROR");
    expect(book.snapshot(1_000).quotes[0]?.quote.sequence).toBe(1);
    expect(book.snapshot(1_000).quotes[0]).toMatchObject({
      eligible: false,
      ineligibilityReasons: ["SCHEMA_ERROR"]
    });

    expect(book.apply(update([quote({ sequence: 2 })]))).toMatchObject({
      accepted: false,
      reason: "NEEDS_SNAPSHOT"
    });

    book.apply(update([quote({ sequence: 3 })], { kind: "FULL_SNAPSHOT" }));
    expect(book.snapshot(1_000).quotes[0]?.eligible).toBe(true);
  });

  it("quarantines a newly observed market after its first payload fails schema validation", () => {
    const book = new QuoteBook(policies);
    book.apply(update([{ ...quote(), rawOdds: "NaN" }]));

    expect(book.apply(update([quote({ sequence: 2 })]))).toMatchObject({
      accepted: false,
      reason: "NEEDS_SNAPSHOT"
    });

    expect(book.apply(update([quote({ sequence: 3 })], { kind: "FULL_SNAPSHOT" }))).toMatchObject({
      accepted: true,
      reason: null
    });
    expect(book.snapshot(1_000).quotes[0]?.eligible).toBe(true);

    book.apply(update([
      quote({ sequence: 4 }),
      quote({ providerMarketId: "different-market", sequence: 4 })
    ]));
    expect(book.apply(update([quote({ sequence: 4 })]))).toMatchObject({
      accepted: false,
      reason: "NEEDS_SNAPSHOT"
    });
  });

  it("quarantines every identifiable market in an atomically rejected malformed batch", () => {
    const book = new QuoteBook(policies);
    book.apply(update([quote()]));

    const result = book.apply(update([
      quote({ sequence: 2 }),
      { ...quote({ providerMarketId: "other-market", sequence: 2 }), rawOdds: "NaN" }
    ]));

    expect(result).toMatchObject({ accepted: false, reason: "SCHEMA_ERROR" });
    expect(book.snapshot(1_000).quotes[0]).toMatchObject({
      eligible: false,
      ineligibilityReasons: ["SCHEMA_ERROR"]
    });
  });
});
