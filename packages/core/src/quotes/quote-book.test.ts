import type { ProviderQuote } from "@tool-chenh/contracts";
import { describe, expect, it } from "vitest";
import {
  QuoteBook,
  quoteKey,
  type QuoteClockContext,
  type QuoteUpdate,
  type SourceFreshnessPolicy
} from "./quote-book.js";

const WALL_CLOCK_EPOCH_MS = 1_800_000_000_000;
const clock = (
  monotonicNowMs = 1_000,
  wallClockNowMs = WALL_CLOCK_EPOCH_MS + monotonicNowMs - 1_000
): QuoteClockContext => ({ monotonicNowMs, wallClockNowMs });

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
  sourceTimestampMs: WALL_CLOCK_EPOCH_MS,
  receivedMonotonicMs: 1_000,
  sequence: 1,
  ...overrides
});

const update = (
  quotes: readonly unknown[],
  overrides: Partial<QuoteUpdate> = {}
): QuoteUpdate => ({
  source: { provider: "SABA", category: "FOOTBALL" },
  kind: "DELTA",
  transport: "WEBSOCKET",
  sequence: typeof quotes[0] === "object" && quotes[0] !== null && "sequence" in quotes[0]
    ? (quotes[0] as { sequence: number | null }).sequence
    : null,
  clock: clock(),
  quotes,
  ...overrides
});

describe("QuoteBook ordering and freshness", () => {
  it("accepts a strictly higher delta sequence", () => {
    const book = new QuoteBook(policies);
    expect(book.apply(update([quote()])).accepted).toBe(true);

    const result = book.apply(update([quote({ rawOdds: "2.2", sequence: 2 })]));

    expect(result).toMatchObject({ accepted: true, reason: null });
    expect(book.snapshot(clock()).quotes[0]?.quote.rawOdds).toBe("2.2");
  });

  it.each([1, 0])("ignores duplicate or lower sequence %s", (sequence) => {
    const book = new QuoteBook(policies);
    book.apply(update([quote({ sequence: 1 })]));

    const result = book.apply(update([quote({ rawOdds: "9", sequence })]));

    expect(result).toMatchObject({ accepted: false, reason: "OUT_OF_ORDER" });
    expect(book.snapshot(clock()).quotes[0]?.quote.rawOdds).toBe("2.1");
  });

  it("rejects an unsequenced delta without mutation and recovers through an unsequenced full snapshot", () => {
    const book = new QuoteBook(policies);
    book.apply(update([quote()]));

    const rejected = book.apply(update([quote({ sequence: null, rawOdds: "9" })]));

    expect(rejected).toMatchObject({ accepted: false, reason: "NEEDS_SNAPSHOT" });
    expect(book.snapshot(clock()).quotes[0]).toMatchObject({
      quote: { rawOdds: "2.1", sequence: 1 },
      eligible: false,
      ineligibilityReasons: ["NEEDS_SNAPSHOT"]
    });

    expect(book.apply(update([
      quote({ sequence: null, rawOdds: "2.2" })
    ], { kind: "FULL_SNAPSHOT" }))).toMatchObject({ accepted: true, reason: null });
    expect(book.snapshot(clock()).quotes[0]).toMatchObject({
      quote: { rawOdds: "2.2", sequence: null },
      eligible: true
    });
    expect(book.apply(update([quote({ sequence: 1, rawOdds: "2.3" })]))).toMatchObject({
      accepted: true,
      reason: null
    });
  });

  it("treats a full snapshot as authoritative over an older sequence baseline", () => {
    const book = new QuoteBook(policies);
    book.apply(update([quote({ sequence: 10 })]));
    book.apply(update([quote({ sequence: 12 })]));

    expect(book.apply(update([
      quote({ sequence: 1, rawOdds: "2.2" })
    ], { kind: "FULL_SNAPSHOT" }))).toMatchObject({ accepted: true, reason: null });
    expect(book.apply(update([quote({ sequence: 2, rawOdds: "2.3" })]))).toMatchObject({
      accepted: true,
      reason: null
    });
    expect(book.snapshot(clock()).quotes[0]?.quote.rawOdds).toBe("2.3");
  });

  it("quarantines every selection in a market after a sequence gap until a fresh full snapshot", () => {
    const book = new QuoteBook(policies);
    book.apply(update([
      quote({ providerSelectionId: "over" }),
      quote({ providerSelectionId: "under", selection: "UNDER", rawOdds: "2.05" })
    ]));

    const gap = book.apply(update([quote({ sequence: 3 })]));
    expect(gap).toMatchObject({ accepted: false, reason: "SEQUENCE_GAP" });
    expect(book.snapshot(clock()).quotes.map((item) => item.ineligibilityReasons)).toEqual([
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
    expect(book.snapshot(clock()).quotes.every((item) => item.eligible)).toBe(true);
  });

  it("immediately invalidates a suspended provider selection", () => {
    const book = new QuoteBook(policies);
    book.apply(update([quote()]));

    const result = book.apply(update([quote({ sequence: 2, status: "SUSPENDED" })]));
    const stored = book.snapshot(clock()).quotes[0]!;

    expect(result).toMatchObject({ accepted: true, reason: "SUSPENDED" });
    expect(stored.eligible).toBe(false);
    expect(stored.ineligibilityReasons).toEqual(["SUSPENDED"]);
  });

  it("immediately invalidates a closed provider selection", () => {
    const book = new QuoteBook(policies);

    const result = book.apply(update([quote({ status: "CLOSED" })]));

    expect(result).toMatchObject({ accepted: true, reason: "CLOSED" });
    expect(book.snapshot(clock()).quotes[0]).toMatchObject({
      eligible: false,
      ineligibilityReasons: ["CLOSED"]
    });
  });

  it("expires a WebSocket quote at its configured TTL", () => {
    const book = new QuoteBook(policies);
    book.apply(update([quote()]));

    expect(book.snapshot(clock(1_999)).quotes[0]?.eligible).toBe(true);
    expect(book.snapshot(clock(2_000)).quotes[0]).toMatchObject({
      eligible: false,
      ineligibilityReasons: ["STALE"]
    });
  });

  it("reports the earliest source or receive expiry for deterministic opportunity TTL", () => {
    const book = new QuoteBook(policies);
    book.apply(update([quote({
      sourceTimestampMs: WALL_CLOCK_EPOCH_MS - 500,
      receivedMonotonicMs: 1_000
    })]));

    expect(book.snapshot(clock()).quotes[0]?.expiresAtMonotonicMs).toBe(1_500);
    expect(book.snapshot(clock(1_499)).quotes[0]?.eligible).toBe(true);
    expect(book.snapshot(clock(1_500)).quotes[0]?.ineligibilityReasons).toContain("STALE");
  });

  it("expires a polling quote at its independently configured TTL", () => {
    const book = new QuoteBook(policies);
    book.apply(update([quote()], { transport: "POLLING" }));

    expect(book.snapshot(clock(5_999)).quotes[0]?.eligible).toBe(true);
    expect(book.snapshot(clock(6_000)).quotes[0]).toMatchObject({
      eligible: false,
      ineligibilityReasons: ["STALE"]
    });
  });

  it("blocks a quote whose source timestamp exceeds allowed future clock skew", () => {
    const book = new QuoteBook(policies);

    const result = book.apply(update([quote({
      sourceTimestampMs: WALL_CLOCK_EPOCH_MS + 101
    })]));

    expect(result).toMatchObject({ accepted: true, reason: "CLOCK_SKEW" });
    expect(book.snapshot(clock()).quotes[0]).toMatchObject({
      eligible: false,
      ineligibilityReasons: ["CLOCK_SKEW"]
    });
  });

  it("checks future monotonic receive time independently from the wall clock", () => {
    const book = new QuoteBook(policies);

    const result = book.apply(update([quote({ receivedMonotonicMs: 1_101 })]));

    expect(result).toMatchObject({ accepted: true, reason: "CLOCK_SKEW" });
    expect(book.snapshot(clock()).quotes[0]?.ineligibilityReasons).toEqual(["CLOCK_SKEW"]);
  });

  it("applies the configured missing timestamp policy with explicit provenance", () => {
    const book = new QuoteBook(policies);
    const rejected = quote({
      provider: "IM",
      providerSelectionId: "im-over",
      sourceTimestampMs: null
    });
    const allowed = quote({ sourceTimestampMs: null });

    book.apply(update([rejected], {
      transport: "POLLING",
      source: { provider: "IM", category: "FOOTBALL" }
    }));
    book.apply(update([allowed], { transport: "POLLING" }));
    const snapshot = book.snapshot(clock());

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
    expect(book.snapshot(clock()).quotes).toEqual([]);
  });

  it("rejects malformed quote payloads without replacing a valid quote", () => {
    const book = new QuoteBook(policies);
    book.apply(update([quote()]));

    const result = book.apply(update([{ ...quote({ sequence: 2 }), rawOdds: "NaN" }]));

    expect(result).toMatchObject({ accepted: false, reason: "SCHEMA_ERROR" });
    expect(result.diagnostics[0]?.reason).toBe("SCHEMA_ERROR");
    expect(book.snapshot(clock()).quotes[0]?.quote.sequence).toBe(1);
    expect(book.snapshot(clock()).quotes[0]).toMatchObject({
      eligible: false,
      ineligibilityReasons: ["SCHEMA_ERROR"]
    });

    expect(book.apply(update([quote({ sequence: 2 })]))).toMatchObject({
      accepted: false,
      reason: "NEEDS_SNAPSHOT"
    });

    book.apply(update([quote({ sequence: 3 })], { kind: "FULL_SNAPSHOT" }));
    expect(book.snapshot(clock()).quotes[0]?.eligible).toBe(true);
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
    expect(book.snapshot(clock()).quotes[0]?.eligible).toBe(true);

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
    expect(book.snapshot(clock()).quotes[0]).toMatchObject({
      eligible: false,
      ineligibilityReasons: ["SCHEMA_ERROR"]
    });
  });

  it("uses trusted source identity to quarantine only that source and category", () => {
    const book = new QuoteBook(policies);
    const anotherSaba = quote({
      providerEventId: "event-2",
      providerMarketId: "market-2",
      providerSelectionId: "home",
      marketType: "FT_1X2",
      line: null,
      selection: "HOME"
    });
    const im = quote({
      provider: "IM",
      providerEventId: "im-event",
      providerMarketId: "im-market",
      providerSelectionId: "im-over"
    });
    const sabaLol = quote({
      category: "LOL",
      providerEventId: "lol-event",
      providerMarketId: "lol-market",
      providerSelectionId: "team-a",
      marketType: "MAP_WINNER",
      scope: "MAP_1",
      line: null,
      selection: "TEAM_A"
    });
    book.apply(update([quote()], { kind: "FULL_SNAPSHOT" }));
    book.apply(update([anotherSaba], { kind: "FULL_SNAPSHOT" }));
    book.apply(update([im], {
      kind: "FULL_SNAPSHOT",
      source: { provider: "IM", category: "FOOTBALL" }
    }));
    book.apply(update([sabaLol], {
      kind: "FULL_SNAPSHOT",
      source: { provider: "SABA", category: "LOL" }
    }));

    book.apply(update([{ rawOdds: "NaN" }]));
    const quarantined = book.snapshot(clock());

    expect(quarantined.byKey[quoteKey(quote())]?.ineligibilityReasons).toEqual(["SCHEMA_ERROR"]);
    expect(quarantined.byKey[quoteKey(anotherSaba)]?.ineligibilityReasons).toEqual(["SCHEMA_ERROR"]);
    expect(quarantined.byKey[quoteKey(im)]?.eligible).toBe(true);
    expect(quarantined.byKey[quoteKey(sabaLol)]?.eligible).toBe(true);

    book.apply(update([quote({ sequence: 2 })], { kind: "FULL_SNAPSHOT" }));
    expect(book.apply(update([quote({ sequence: 3, rawOdds: "2.2" })]))).toMatchObject({
      accepted: true,
      reason: null
    });
    book.apply(update([{ ...anotherSaba, sequence: 2 }], { kind: "FULL_SNAPSHOT" }));
    expect(book.snapshot(clock()).quotes.every((item) => item.eligible)).toBe(true);
  });

  it("requires a full snapshot after an umbrella quarantine discards an unseen-market delta", () => {
    const book = new QuoteBook(policies);
    const existing = quote();
    const unseen = quote({
      providerEventId: "event-unseen",
      providerMarketId: "market-unseen",
      providerSelectionId: "over-unseen"
    });
    book.apply(update([existing], { kind: "FULL_SNAPSHOT" }));
    book.apply(update([{ rawOdds: "NaN" }]));

    expect(book.apply(update([unseen]))).toMatchObject({
      accepted: false,
      reason: "NEEDS_SNAPSHOT"
    });
    book.apply(update([quote({ sequence: 2 })], { kind: "FULL_SNAPSHOT" }));

    expect(book.apply(update([{ ...unseen, sequence: 2 }]))).toMatchObject({
      accepted: false,
      reason: "NEEDS_SNAPSHOT"
    });
    expect(book.snapshot(clock()).byKey[quoteKey(unseen)]).toBeUndefined();

    expect(book.apply(update([
      { ...unseen, sequence: 2, rawOdds: "2.2" }
    ], { kind: "FULL_SNAPSHOT" }))).toMatchObject({ accepted: true, reason: null });
    expect(book.snapshot(clock()).byKey[quoteKey(unseen)]).toMatchObject({
      eligible: true,
      quote: { rawOdds: "2.2", sequence: 2 }
    });
  });

  it("uses the trusted envelope when malformed payload provenance conflicts", () => {
    const book = new QuoteBook(policies);
    const im = quote({
      provider: "IM",
      providerEventId: "im-event",
      providerMarketId: "im-market",
      providerSelectionId: "im-over"
    });
    book.apply(update([quote()], { kind: "FULL_SNAPSHOT" }));
    book.apply(update([im], {
      kind: "FULL_SNAPSHOT",
      source: { provider: "IM", category: "FOOTBALL" }
    }));

    book.apply(update([{
      ...im,
      rawOdds: "NaN"
    }]));

    expect(book.snapshot(clock()).byKey[quoteKey(quote())]?.ineligibilityReasons).toEqual([
      "SCHEMA_ERROR"
    ]);
    expect(book.snapshot(clock()).byKey[quoteKey(im)]?.eligible).toBe(true);
  });

  it("isolates the same provider market identity across trusted categories", () => {
    const book = new QuoteBook(policies);
    const football = quote();
    const conflictingLol = quote({
      category: "LOL",
      providerSelectionId: "over",
      marketType: "MAP_WINNER",
      scope: "MAP_1",
      line: null,
      selection: "TEAM_A"
    });
    book.apply(update([football], { kind: "FULL_SNAPSHOT" }));

    const result = book.apply(update([conflictingLol], {
      kind: "FULL_SNAPSHOT",
      source: { provider: "SABA", category: "LOL" }
    }));

    expect(result).toMatchObject({ accepted: true, reason: null });
    expect(quoteKey(conflictingLol)).not.toBe(quoteKey(football));
    expect(book.snapshot(clock()).quotes).toHaveLength(2);
    expect(book.snapshot(clock()).byKey[quoteKey(football)]?.eligible).toBe(true);
    expect(book.snapshot(clock()).byKey[quoteKey(conflictingLol)]?.eligible).toBe(true);
  });

  it("quarantines all cached markets when the runtime envelope is not trustworthy", () => {
    const book = new QuoteBook(policies);
    const im = quote({
      provider: "IM",
      providerEventId: "im-event",
      providerMarketId: "im-market",
      providerSelectionId: "im-over"
    });
    book.apply(update([quote()], { kind: "FULL_SNAPSHOT" }));
    book.apply(update([im], {
      kind: "FULL_SNAPSHOT",
      source: { provider: "IM", category: "FOOTBALL" }
    }));

    book.apply({
      ...update([{ rawOdds: "NaN" }]),
      source: { provider: "", category: "FOOTBALL" }
    });

    expect(book.snapshot(clock()).quotes.every((item) =>
      item.ineligibilityReasons.includes("SCHEMA_ERROR")
    )).toBe(true);

    book.apply(update([quote({ sequence: 2 })], { kind: "FULL_SNAPSHOT" }));
    expect(book.apply(update([quote({ sequence: 3, rawOdds: "2.2" })]))).toMatchObject({
      accepted: true,
      reason: null
    });
    expect(book.snapshot(clock()).byKey[quoteKey(im)]?.ineligibilityReasons).toEqual([
      "SCHEMA_ERROR"
    ]);
  });
});
