import type { ChromeBridgeEnvelope, ProviderQuote } from "@tool-chenh/contracts";
import { QuoteBook, type SourceFreshnessPolicy } from "@tool-chenh/core";
import { describe, expect, it } from "vitest";
import { SabaQuoteClockMapper } from "./saba-quote-clock.js";

type EnvelopeClock = Pick<ChromeBridgeEnvelope, "observedAtMs" | "receivedMonotonicMs">;

const quote = (receivedMonotonicMs: number, overrides: Partial<ProviderQuote> = {}): ProviderQuote => ({
  provider: "SABA",
  category: "FOOTBALL",
  providerEventId: "event-1",
  providerMarketId: "market-1",
  providerSelectionId: "home",
  marketType: "FT_AH",
  scope: "FULL_TIME",
  selection: "HOME",
  line: "-0.5",
  rawOdds: "0.91",
  rawFormat: "MALAY",
  status: "OPEN",
  isLive: false,
  sourceTimestampMs: null,
  receivedMonotonicMs,
  sequence: 1,
  ...overrides
});

const policies: Readonly<Record<string, SourceFreshnessPolicy>> = {
  SABA: {
    websocketTtlMs: 1_000,
    pollingTtlMs: 1_000,
    maxFutureClockSkewMs: 100,
    missingSourceTimestamp: "USE_RECEIVED_TIME"
  }
};

function applyToRealQuoteBook(value: ProviderQuote, monotonicNowMs: number) {
  const book = new QuoteBook(policies);
  const applied = book.apply({
    source: { provider: "SABA", category: "FOOTBALL" },
    kind: "FULL_SNAPSHOT",
    transport: "POLLING",
    sequence: value.sequence,
    clock: { monotonicNowMs, wallClockNowMs: 50_000 },
    quotes: [value]
  });
  return { book, applied };
}

describe("SabaQuoteClockMapper", () => {
  it.each([
    [100_000, 99_980],
    [100, 80]
  ])("maps extension clock offset %s into the API clock domain", (envelopeSourceClock, quoteSourceClock) => {
    const mapper = new SabaQuoteClockMapper({
      now: () => ({ monotonicNowMs: 2_000, wallClockNowMs: 50_000 })
    });
    const original = quote(quoteSourceClock);
    const envelope: EnvelopeClock = {
      observedAtMs: 49_950,
      receivedMonotonicMs: envelopeSourceClock
    };

    mapper.observe([original], envelope);

    expect(mapper.localize(original)).toEqual({ ...original, receivedMonotonicMs: 1_930 });
    expect(original.receivedMonotonicMs).toBe(quoteSourceClock);
  });

  it("preserves a delayed capture acquired before the API monotonic origin", () => {
    const mapper = new SabaQuoteClockMapper({
      now: () => ({ monotonicNowMs: 400, wallClockNowMs: 20_000 })
    });
    const original = quote(8_500);

    mapper.observe([original], { observedAtMs: 19_100, receivedMonotonicMs: 9_000 });

    expect(mapper.localize(original).receivedMonotonicMs).toBe(-1_000);
  });

  it("maps each quote object once without renewing it on repeated observation", () => {
    let now = { monotonicNowMs: 1_000, wallClockNowMs: 10_000 };
    const mapper = new SabaQuoteClockMapper({ now: () => now });
    const original = quote(500);
    const envelope = { observedAtMs: 10_000, receivedMonotonicMs: 500 };
    mapper.observe([original], envelope);
    const first = mapper.localize(original);

    now = { monotonicNowMs: 9_000, wallClockNowMs: 18_000 };
    mapper.observe([original], envelope);

    expect(mapper.localize(original)).toBe(first);
    expect(first.receivedMonotonicMs).toBe(1_000);
  });

  it("maps a distinct fresh quote object at its own API acquisition time", () => {
    let now = { monotonicNowMs: 1_000, wallClockNowMs: 10_000 };
    const mapper = new SabaQuoteClockMapper({ now: () => now });
    const oldQuote = quote(500);
    mapper.observe([oldQuote], { observedAtMs: 10_000, receivedMonotonicMs: 500 });

    now = { monotonicNowMs: 1_600, wallClockNowMs: 10_600 };
    const freshQuote = quote(1_100, { rawOdds: "0.95", sequence: 2 });
    mapper.observe([freshQuote], { observedAtMs: 10_600, receivedMonotonicMs: 1_100 });

    expect(mapper.localize(oldQuote).receivedMonotonicMs).toBe(1_000);
    expect(mapper.localize(freshQuote).receivedMonotonicMs).toBe(1_600);
  });

  it.each([
    { name: "non-finite API monotonic clock", now: { monotonicNowMs: Number.NaN, wallClockNowMs: 10_000 },
      envelope: { observedAtMs: 10_000, receivedMonotonicMs: 500 }, sourceClock: 500 },
    { name: "negative API wall clock", now: { monotonicNowMs: 1_000, wallClockNowMs: -1 },
      envelope: { observedAtMs: 10_000, receivedMonotonicMs: 500 }, sourceClock: 500 },
    { name: "non-finite envelope wall clock", now: { monotonicNowMs: 1_000, wallClockNowMs: 10_000 },
      envelope: { observedAtMs: Number.POSITIVE_INFINITY, receivedMonotonicMs: 500 }, sourceClock: 500 },
    { name: "negative envelope source clock", now: { monotonicNowMs: 1_000, wallClockNowMs: 10_000 },
      envelope: { observedAtMs: 10_000, receivedMonotonicMs: -1 }, sourceClock: 0 },
    { name: "future quote source clock", now: { monotonicNowMs: 1_000, wallClockNowMs: 10_000 },
      envelope: { observedAtMs: 10_000, receivedMonotonicMs: 500 }, sourceClock: 501 },
    { name: "non-finite quote source clock", now: { monotonicNowMs: 1_000, wallClockNowMs: 10_000 },
      envelope: { observedAtMs: 10_000, receivedMonotonicMs: 500 }, sourceClock: Number.NaN }
  ])("rejects $name", ({ now, envelope, sourceClock }) => {
    const mapper = new SabaQuoteClockMapper({ now: () => now });
    const original = quote(sourceClock);

    expect(() => mapper.observe([original], envelope)).toThrow("SABA_QUOTE_CLOCK_INVALID");
    expect(() => mapper.localize(original)).toThrow("SABA_QUOTE_CLOCK_MAPPING_MISSING");
  });

  it("rejects an invalid batch atomically", () => {
    const mapper = new SabaQuoteClockMapper({
      now: () => ({ monotonicNowMs: 1_000, wallClockNowMs: 10_000 })
    });
    const valid = quote(400);
    const future = quote(501, { providerSelectionId: "away", selection: "AWAY" });

    expect(() => mapper.observe([valid, future], {
      observedAtMs: 10_000,
      receivedMonotonicMs: 500
    })).toThrow("SABA_QUOTE_CLOCK_INVALID");
    expect(() => mapper.localize(valid)).toThrow("SABA_QUOTE_CLOCK_MAPPING_MISSING");
  });

  it("refuses an unmapped or non-SABA quote", () => {
    const mapper = new SabaQuoteClockMapper({
      now: () => ({ monotonicNowMs: 1_000, wallClockNowMs: 10_000 })
    });
    const unmapped = quote(500);
    expect(() => mapper.localize(unmapped)).toThrow("SABA_QUOTE_CLOCK_MAPPING_MISSING");

    const foreign = quote(500, { provider: "IM" });
    expect(() => mapper.observe([foreign], {
      observedAtMs: 10_000,
      receivedMonotonicMs: 500
    })).toThrow("SABA_QUOTE_CLOCK_INVALID");
  });

  it.each([
    [100_000, 100_000],
    [10, 10]
  ])("ages a localized quote in a real QuoteBook for source offset %s", (sourceEnvelope, sourceQuote) => {
    const mapper = new SabaQuoteClockMapper({
      now: () => ({ monotonicNowMs: 500, wallClockNowMs: 50_000 })
    });
    const original = quote(sourceQuote);
    mapper.observe([original], { observedAtMs: 50_000, receivedMonotonicMs: sourceEnvelope });
    const localized = mapper.localize(original);
    const { book, applied } = applyToRealQuoteBook(localized, 500);

    expect(applied.accepted).toBe(true);
    expect(book.snapshot({ monotonicNowMs: 1_499, wallClockNowMs: 50_999 }).quotes[0]).toMatchObject({
      quoteAgeMs: 999,
      eligible: true
    });
    expect(book.snapshot({ monotonicNowMs: 1_500, wallClockNowMs: 51_000 }).quotes[0]).toMatchObject({
      quoteAgeMs: 1_000,
      eligible: false,
      ineligibilityReasons: ["STALE"]
    });
  });

  it("lets a real QuoteBook age a negative localized acquisition without clamping", () => {
    const mapper = new SabaQuoteClockMapper({
      now: () => ({ monotonicNowMs: 100, wallClockNowMs: 20_000 })
    });
    const original = quote(1_000);
    mapper.observe([original], { observedAtMs: 19_500, receivedMonotonicMs: 1_200 });
    const localized = mapper.localize(original);
    const { book, applied } = applyToRealQuoteBook(localized, 100);

    expect(localized.receivedMonotonicMs).toBe(-600);
    expect(applied.accepted).toBe(true);
    expect(book.snapshot({ monotonicNowMs: 400, wallClockNowMs: 50_300 }).quotes[0]).toMatchObject({
      quoteAgeMs: 1_000,
      eligible: false,
      ineligibilityReasons: ["STALE"]
    });
  });
});
