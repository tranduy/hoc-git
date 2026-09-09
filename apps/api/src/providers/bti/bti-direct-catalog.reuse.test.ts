import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractBtiCatalogRecords, extractBtiNativeMarketObservations } from "./bti-direct-catalog.js";

const fixtureUrl = new URL("./fixtures/bti-native-binary-markets-2026-09-08.json", import.meta.url);
const payload = (): { data: unknown[][] } => JSON.parse(readFileSync(fixtureUrl, "utf8"));

describe("BTI native observation event identity reuse", () => {
  it("preserves every native row while avoiding another traversal to resolve known event identities", () => {
    const input = payload();
    const resolvedEventIds = new Set(extractBtiCatalogRecords(input).map(({ eventId }) => eventId));
    expect(resolvedEventIds.size).toBeGreaterThan(0);
    let traversals = 0;
    const observedPayload = { get data() { traversals += 1; return input.data; } };
    const standalone = extractBtiNativeMarketObservations(observedPayload, 1_788_860_177_471);
    const standaloneTraversals = traversals;
    traversals = 0;
    const reused = extractBtiNativeMarketObservations(observedPayload, 1_788_860_177_471, resolvedEventIds);
    expect(reused).toEqual(standalone);
    expect(traversals).toBeLessThan(standaloneTraversals);
  });

  it.each(["missing event identity", "closed event", "closed market", "suspended selection"])(
    "preserves original evidence and disposition for %s", (condition) => {
      const input = payload();
      const event = input.data[0]!;
      const market = (event[20] as unknown[][])[0]!;
      const selection = (market[13] as unknown[][])[0]!;
      if (condition === "missing event identity") event[8] = [];
      if (condition === "closed event") event[32] = true;
      if (condition === "closed market") market[15] = true;
      if (condition === "suspended selection") selection[5] = true;
      const resolvedEventIds = new Set(extractBtiCatalogRecords(input).map(({ eventId }) => eventId));
      const expected = extractBtiNativeMarketObservations(input, 1_788_860_177_471);
      const actual = extractBtiNativeMarketObservations(input, 1_788_860_177_471, resolvedEventIds);
      expect(actual.length).toBeGreaterThan(0);
      expect(actual).toEqual(expected);
      if (condition === "missing event identity") {
        expect(resolvedEventIds.size).toBe(0);
        expect(actual.some(({ reason }) => reason === "EVENT_IDENTITY_UNRESOLVED")).toBe(true);
        expect(actual.some(({ disposition }) => disposition === "NORMALIZED")).toBe(false);
      }
    }
  );
});
