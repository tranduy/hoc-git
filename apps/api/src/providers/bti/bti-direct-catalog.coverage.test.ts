import { describe, expect, it } from "vitest";
import { mapMarkets } from "@tool-chenh/core";
import { extractBtiCatalogRecords, extractBtiNativeMarketIdentities,
  extractBtiNativeMarketObservations } from "./bti-direct-catalog.js";
import { BtiObservedCatalogReader } from "./bti-observed-catalog.js";

// Synthetic positional payloads: these regress parser behavior, not live provider coverage.
function selection(id: string, name: string, side: number, line: number | null, detail = false): unknown[] {
  const value: unknown[] = [];
  value[0] = id;
  value[detail ? 2 : 1] = { EN: name };
  value[detail ? 8 : 6] = ["", "1.8", "", "", "", "0.80"];
  value[detail ? 9 : 7] = side;
  value[detail ? 16 : 13] = line;
  return value;
}

function market(id: string, code: string, label: string, values: unknown[], detail = false): unknown[] {
  const value: unknown[] = [];
  value[0] = id; value[1] = label;
  value[detail ? 5 : 3] = [code, label];
  value[detail ? 13 : 7] = values;
  return value;
}

function payload(markets: unknown[], detail = false, closed = false) {
  const event: unknown[] = [];
  event[0] = "event";
  event[detail ? 8 : 1] = [["h", { EN: "Alpha" }], ["a", { EN: "Beta" }]];
  event[detail ? 11 : 3] = "2026-09-08T12:00:00Z";
  event[detail ? 13 : 5] = false;
  event[detail ? 20 : 8] = markets;
  if (detail) { event[2] = "League"; event[32] = closed; return { data: [event] }; }
  const league: unknown[] = []; league[1] = "League"; league[12] = [event];
  return { serializedData: [league] };
}

const pair = (detail = false) => [selection("o", "Over", 1, 4.5, detail), selection("u", "Under", 3, 4.5, detail)];

describe("BTI native coverage consistency", () => {
  it.each([false, true].flatMap((detail) => [
    ["HC0", "FT_AH"], ["HC39", "FT_AH"], ["HC1", "FH_AH"], ["HC2", "SH_AH"],
    ["HC619", "CORNER_FT_AH"], ["HC14", "CORNER_FH_AH"], ["HC10", "CARD_FT_AH"]]
    .map(([code, type]) => ({ detail, code: code!, type: type! }))))(
    "publishes signed zero and opposite handicap lines for $code (detail=$detail) without enabling push comparison",
    async ({ detail, code, type }) => {
      const lines = [-0.5, 0, 0.5];
      const input = payload([market("handicap", code, "Asian handicap", lines.flatMap((line) => [
        selection(`home:${line}`, "Alpha", 1, line, detail),
        selection(`away:${line}`, "Beta", 3, -line, detail)
      ]), detail)], detail);
      const nativeMarketObservations = extractBtiNativeMarketObservations(input, 2_000);
      expect(nativeMarketObservations.map(({ providerMarketId, disposition }) => [providerMarketId, disposition]))
        .toEqual(lines.map((line) => [`handicap:${line}`, "NORMALIZED"]));
      const reader = new BtiObservedCatalogReader({
        accounts: { withActiveHandle: async (_id, _provider, consume) => consume({ sessionId: "synthetic-session",
          provider: "BTI", category: "FOOTBALL", withSecret: async (read) => read({ kind: "LAUNCH_URL",
            value: "https://synthetic.invalid/launch" }) }) },
        source: { readCatalog: async () => ({ observedAtMs: 2_000, receivedMonotonicMs: 100,
          records: extractBtiCatalogRecords(input), nativeMarketObservations }) }
      });
      const catalog = await reader.read("synthetic-account");
      expect(catalog.markets.map(({ providerMarketId, marketType, line }) => [providerMarketId, marketType, line]))
        .toEqual(lines.map((line) => [`handicap:${line}`, type, String(line)]));
      expect(catalog.quotes).toHaveLength(6);
      for (const published of catalog.markets) {
        const quotes = catalog.quotes.filter((quote) => quote.providerMarketId === published.providerMarketId);
        expect(quotes.map(({ providerSelectionId, selection, line }) => [providerSelectionId, selection, line]))
          .toEqual([[`home:${published.line}`, "HOME", published.line], [`away:${published.line}`, "AWAY", published.line]]);
        const selections = quotes.map((quote) => ({ providerSelectionId: quote.providerSelectionId,
          canonicalOutcomeId: quote.selection === "HOME" ? "alpha" : "beta" }));
        const comparison = mapMarkets({ status: "VERIFIED", canonicalEventId: "synthetic-event", category: "FOOTBALL",
          participantOrientation: "SAME", canonicalParticipantIds: ["alpha", "beta"], evidence: [],
          leftSource: { provider: "BTI", providerEventId: "event" },
          rightSource: { provider: "IM", providerEventId: "peer-event" } },
        { ...published, selections }, { ...published, provider: "IM", providerEventId: "peer-event", selections });
        expect(comparison.evidence.find(({ gate }) => gate === "noPushFootballLine")?.passed)
          .toBe(published.line !== "0");
        expect(comparison.executionConfidence).toBe(published.line === "0" ? "BLOCKED" : "HIGH");
      }
      expect(catalog.nativeMarketObservations).toEqual(nativeMarketObservations);
    });

  it.each([false, true])("preserves safe numeric event, market and selection identities (detail=%s)", (isDetail) => {
    const values = pair(isDetail);
    values[0]![0] = 789; values[1]![0] = 790;
    const native = market("unused", "OU1", "First half total", values, isDetail);
    native[0] = 456;
    const input = payload([native], isDetail);
    const event = "data" in input ? input.data![0]! : (input.serializedData![0]![12] as unknown[][])[0]!;
    event[0] = 123;
    expect(extractBtiCatalogRecords(input)).toEqual([expect.objectContaining({ eventId: "123",
      markets: [expect.objectContaining({ marketId: "456:4.5", selections: [
        expect.objectContaining({ selectionId: "789" }), expect.objectContaining({ selectionId: "790" })
      ] })] })]);
    expect(extractBtiNativeMarketIdentities(input)).toEqual([{ eventId: "123", marketId: "456" }]);
    expect(extractBtiNativeMarketObservations(input, 100)).toEqual([
      expect.objectContaining({ providerEventId: "123", providerMarketId: "456:4.5", disposition: "NORMALIZED" })
    ]);
  });

  it.each([false, true])("accounts for unmatched alternate selections beside a normalized pair (detail=%s)", (isDetail) => {
    const input = payload([market("mixed", "OU1", "First half total", [
      selection("over", "Over 2.75", 1, 2.75, isDetail), selection("under", "Under 2.75", 3, 2.75, isDetail),
      selection("orphan", "Over 3.5", 1, 3.5, isDetail)
    ], isDetail)], isDetail);
    expect(extractBtiCatalogRecords(input)[0]!.markets.map((item) => item.marketId)).toEqual(["mixed:2.75"]);
    expect(extractBtiNativeMarketObservations(input, 100)).toEqual([
      expect.objectContaining({ providerMarketId: "mixed:2.75", disposition: "NORMALIZED", outcomeLabels: ["Over 2.75", "Under 2.75"] }),
      expect.objectContaining({ providerMarketId: "mixed", disposition: "EXCLUDED", reason: "UNPAIRED_OR_INVALID_NATIVE_SELECTIONS",
        outcomeLabels: ["Over 3.5"] })
    ]);
  });

  it.each([["participants", 8], ["league", 2], ["start", 11], ["phase", 13]] as const)(
    "does not claim normalization with missing event %s", (_field, index) => {
    const input = payload([market("total", "OU1", "First half total", pair(true), true)], true);
    const event = input.data![0]!;
    event[index] = null;
    expect(extractBtiCatalogRecords(input)).toEqual([]);
    expect(extractBtiNativeMarketObservations(input, 100)).toEqual([
      expect.objectContaining({ providerEventId: "event", providerMarketId: "total",
        disposition: "EXCLUDED", reason: "EVENT_IDENTITY_UNRESOLVED" })
    ]);
  });

  it.each([Number.MAX_SAFE_INTEGER + 1, 1.25, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects nonexact numeric event identity %s", (id) => {
      const input = payload([market("total", "OU1", "First half total", pair(true), true)], true);
      input.data![0]![0] = id;
      expect(extractBtiCatalogRecords(input)).toEqual([]);
      expect(extractBtiNativeMarketObservations(input, 100).every((item) => item.disposition !== "NORMALIZED")).toBe(true);
    });

  it.each(["market", "selection"])("does not round an unsafe numeric %s into canonical identity", (field) => {
    const values = pair(true);
    const native = market("safe-market", "OU1", "First half total", values, true);
    if (field === "market") native[0] = Number.MAX_SAFE_INTEGER + 1;
    else values[0]![0] = Number.MAX_SAFE_INTEGER + 1;
    const input = payload([native], true);
    expect(extractBtiCatalogRecords(input)[0]!.markets).toEqual([]);
    expect(extractBtiNativeMarketObservations(input, 100).every((item) => item.disposition !== "NORMALIZED")).toBe(true);
  });

  it("accounts for malformed unnamed leftovers without assigning them to the valid pair", () => {
    const input = payload([market("mixed", "OU1", "First half total", [...pair(true), []], true)], true);
    expect(extractBtiNativeMarketObservations(input, 100)).toEqual([
      expect.objectContaining({ providerMarketId: "mixed:4.5", disposition: "NORMALIZED", outcomeLabels: ["Over", "Under"] }),
      expect.objectContaining({ providerMarketId: "mixed", disposition: "EXCLUDED", outcomeLabels: ["UNNAMED_SELECTION"],
        reason: "UNPAIRED_OR_INVALID_NATIVE_SELECTIONS" })
    ]);
  });

  it("keeps distinct unnamed detail rows in both native inventory and exported identities", () => {
    const input = payload([market("", "ZZ999", "Unknown one", pair(true), true),
      market("", "ZZ999", "Unknown two", pair(true), true),
      market("", "OU619", "Corners total", pair(true), true)], true);
    expect(extractBtiCatalogRecords(input)[0]!.markets).toEqual([]);
    const inventory = extractBtiNativeMarketObservations(input, 100);
    expect(new Set(inventory.map(({ providerMarketId }) => providerMarketId)).size).toBe(3);
    expect(inventory.map(({ disposition }) => disposition)).toEqual(["UNMAPPED", "UNMAPPED", "EXCLUDED"]);
    expect(extractBtiNativeMarketIdentities(input).map(({ marketId }) => marketId))
      .toEqual(inventory.map(({ providerMarketId }) => providerMarketId));
    expect(inventory.every(({ providerMarketId }) => providerMarketId !== "")).toBe(true);
  });

  it("retains each unnamed roster market as distinct native evidence", () => {
    const input = payload([market("", "ZZ999", "Unknown one", pair()), market("", "ZZ999", "Unknown two", pair())]);
    expect(extractBtiCatalogRecords(input)[0]!.markets).toEqual([]);
    const inventory = extractBtiNativeMarketObservations(input, 100);
    expect(inventory).toHaveLength(2);
    expect(new Set(inventory.map(({ providerMarketId }) => providerMarketId)).size).toBe(2);
    expect(extractBtiNativeMarketIdentities(input).map(({ marketId }) => marketId))
      .toEqual(inventory.map(({ providerMarketId }) => providerMarketId));
  });

  it("uses roster participants to retain the exact team-total identity", () => {
    const input = payload([market("team-total", "OU7", "Alpha: Team total goals", pair())]);
    expect(extractBtiCatalogRecords(input)[0]!.markets).toEqual([
      expect.objectContaining({ marketId: "team-total:4.5", marketType: "HOME_FT_TOTAL" })
    ]);
    expect(extractBtiNativeMarketObservations(input, 100)[0]).toMatchObject({ disposition: "NORMALIZED" });
  });

  it("retains native roster market identity and labels when the native code is absent", () => {
    const input = payload([market("unknown-code", "", "Mystery", pair())]);
    expect(extractBtiCatalogRecords(input)[0]!.markets).toEqual([]);
    expect(extractBtiNativeMarketObservations(input, 100)).toEqual([
      expect.objectContaining({ providerMarketId: "unknown-code", nativeType: "UNKNOWN", nativeLabel: "Mystery",
        disposition: "UNMAPPED" })
    ]);
  });

  it("does not turn three native binary selections into two by dropping an invalid third outcome", () => {
    const extra = selection("third", "Unknown", 11, null, true);
    extra[8] = [];
    const input = payload([market("ambiguous", "QA38", "Odd/Even", [
      selection("odd", "Odd", 7, null, true), selection("even", "Even", 8, null, true), extra
    ], true)], true);
    expect(extractBtiCatalogRecords(input)[0]!.markets).toEqual([]);
    expect(extractBtiNativeMarketObservations(input, 100)[0]).toMatchObject({
      disposition: "EXCLUDED", reason: "INVALID_TWO_WAY_SHAPE", outcomeLabels: ["Odd", "Even", "Unknown"]
    });
  });

  it("preserves opaque native identities for merging line replacements and closed markets", () => {
    const closed = market("native:2.5", "OU619", "Corners total", pair(true), true);
    closed[15] = true;
    const input = payload([closed,
      market("opaque", "ZZ999", "Unknown", [], true)], true);
    expect(extractBtiNativeMarketIdentities(input)).toEqual([
      { eventId: "event", marketId: "native:2.5" }, { eventId: "event", marketId: "opaque" }
    ]);
  });

  it("does not retain an invented second-half code as structural mapping evidence", () => {
    const input = payload([market("synthetic", "BTI-2H", "Second Half Total", pair(true), true)], true);
    expect(extractBtiCatalogRecords(input)[0]!.markets).toEqual([]);
    expect(extractBtiNativeMarketObservations(input, 100)[0]).toMatchObject({ disposition: "UNMAPPED" });
  });

  it("publishes known corner and card roster markets that native coverage reports as normalized", () => {
    const input = payload([[market("corner", "OU619", "Corners total", pair())],
      [market("cards", "OU10", "Cards total", pair())]]);
    expect(extractBtiCatalogRecords(input)[0]!.markets.map(({ marketId, marketType }) => ({ marketId, marketType })))
      .toEqual([{ marketId: "corner:4.5", marketType: "CORNER_FT_TOTAL" },
        { marketId: "cards:4.5", marketType: "CARD_FT_TOTAL" }]);
    expect(extractBtiNativeMarketObservations(input, 100).map(({ providerMarketId }) => providerMarketId))
      .toEqual(["corner:4.5", "cards:4.5"]);
  });

  it("accepts known line-free roster binary domains without inventing a line", () => {
    const input = payload([market("odd-even", "QA38", "Odd/Even", [
      selection("odd", "Odd", 7, null), selection("even", "Even", 8, null)
    ])]);
    expect(extractBtiCatalogRecords(input)[0]!.markets).toEqual([
      expect.objectContaining({ marketId: "odd-even", marketType: "FT_ODD_EVEN", lineText: null,
        selections: [expect.objectContaining({ selection: "ODD" }), expect.objectContaining({ selection: "EVEN" })] })
    ]);
    expect(extractBtiNativeMarketObservations(input, 100)[0]).toMatchObject({ disposition: "NORMALIZED" });
  });

  it.each(["Corners Total", "Cards Over Under", "First Half Bookings Handicap", "Goals Total"])(
    "retains an unknown code with the plausible label %s as unmapped", (label) => {
      const input = payload([market("unknown", "ZZ999", label, pair(true), true)], true);
      expect(extractBtiCatalogRecords(input)[0]!.markets).toEqual([]);
      expect(extractBtiNativeMarketObservations(input, 100)).toEqual([
        expect.objectContaining({ providerMarketId: "unknown", nativeType: "ZZ999", nativeLabel: `${label} ${label}`,
          outcomeLabels: ["Over", "Under"], disposition: "UNMAPPED", reason: "NATIVE_TYPE_UNMAPPED" })
      ]);
    }
  );

  it("excludes closed event markets from native normalized coverage", () => {
    const input = payload([market("closed-event-market", "OU619", "Corners total", pair(true), true)], true, true);
    expect(extractBtiCatalogRecords(input)).toEqual([]);
    expect(extractBtiNativeMarketObservations(input, 100)).toEqual([
      expect.objectContaining({ providerMarketId: "closed-event-market", disposition: "EXCLUDED", reason: "EVENT_CLOSED" })
    ]);
  });
});
