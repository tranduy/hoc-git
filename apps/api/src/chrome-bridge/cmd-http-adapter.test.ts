import { describe, expect, it } from "vitest";
import type { ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import { CmdHttpCatalogAdapter } from "./cmd-http-adapter.js";

// Sanitized from the authenticated cgnew.fts368.com DataOdds.ashx startup response.
// Complete response SHA-256: a4110f5dd4ecd36633e5a6de26f1cfb95fd62454445ceb14cc2686ed4fab64fb.
// Only public catalog positions used by the decoder are retained.
function publicFullRow(): unknown[] {
  const row = Array<unknown>(91).fill(null);
  Object.assign(row, {
    0: 25299763, 3: 108007, 10: -999, 12: -999, 14: -999, 16: -999, 25: 1,
    37: "ITALY SERIE D CUP QUALIFIERS", 38: "Virtus Verona", 39: "Calcio Schio",
    40: -999, 41: -999, 42: -999, 43: -999, 44: -999, 45: -999, 46: -999, 47: -999,
    53: "1H 4", 56: "08/23", 79: 0
  });
  return row;
}

const fullResponse = { t: 8_281_247, a: true, data: [], today: [publicFullRow()], f: [] };
// Authentic change rows. SHA-256: 0b165091221bfa9087cee03d9193f3c08b103d59cc4a98f392814d935afc1ac4
// and 854e50a57ae849d81113d3f85efcba6c86a38eeefbc9ef2c22bf4a686dfb04b6.
const oddsChange = { t: 8_277_338, a: true, data: [
  [25299763, 1, 33, 2.75, 0.99, 0.83, 1, 1, "S"],
  [25299763, 1, 35, 0.80, -0.98, 1, 1, "S"]
] };

function envelope(body: unknown, sequence: number): ChromeBridgeEnvelope {
  return { version: 1, kind: "NETWORK", lobby: "CMD", sourceId: "chrome:CMD:9", tabId: 9,
    sourceEpoch: "observer-cmd:0", sequence, observedAtMs: 1_787_494_070_000 + sequence,
    receivedMonotonicMs: 100 + sequence, transport: "HTTP_RESPONSE",
    request: { hostname: "cgnew.fts368.com", pathnameClass: "/Member/BetsView/BetLight/DataOdds.ashx",
      resourceType: "XHR" }, payload: { encoding: "UTF8", body: JSON.stringify(body) } };
}

describe("CmdHttpCatalogAdapter", () => {
  it("commits only the observed atomic running-plus-today full response", () => {
    const adapter = new CmdHttpCatalogAdapter();
    const update = adapter.decode(envelope(fullResponse, 1)).at(-1);
    expect(update).toMatchObject({ authoritativeBaseline: true, evidenceMode: "BASELINE",
      provenance: "AUTHENTICATED_HTTP", generation: "cmd:8281247", providerTimestampMs: null });
    expect(update?.value).toMatchObject({ accountId: "catalog-source:CMD:FOOTBALL",
      events: [{ providerEventId: "25299763", participantA: "Virtus Verona", participantB: "Calcio Schio" }] });
  });

  it("rejects a late odds generation instead of rolling back the current baseline", () => {
    const adapter = new CmdHttpCatalogAdapter();
    adapter.decode(envelope(fullResponse, 1));
    expect(adapter.decode(envelope(oddsChange, 2))).toEqual([]);
  });

  it("maps the characterized line and odds commands to stable provider selections", () => {
    const adapter = new CmdHttpCatalogAdapter();
    const earlier = { ...fullResponse, t: 8_277_000 };
    adapter.decode(envelope(earlier, 1));
    const update = adapter.decode(envelope(oddsChange, 2)).at(-1);
    expect(update).toMatchObject({ evidenceMode: "DELTA", provenance: "AUTHENTICATED_HTTP",
      generation: "cmd:8277000", providerTimestampMs: null });
    expect((update?.value as { quotes: Array<{ providerSelectionId: string; rawOdds: string }> }).quotes)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ providerSelectionId: "25299763:3:over", rawOdds: "0.8" }),
        expect.objectContaining({ providerSelectionId: "25299763:3:under", rawOdds: "-0.98" })
      ]));
  });

  it("fails closed on lookalike hosts, incomplete full shapes, and provider reset signals", () => {
    const adapter = new CmdHttpCatalogAdapter();
    expect(adapter.fingerprint({ ...envelope(fullResponse, 1), request: { ...envelope(fullResponse, 1).request,
      hostname: "cgnew.fts368.com.evil.example" } })).toBe(false);
    expect(adapter.decode(envelope({ t: 1, a: true, data: [] }, 2))).toEqual([]);
    adapter.decode(envelope(fullResponse, 3));
    expect(adapter.decode(envelope({ t: 8_281_248, a: false, data: [] }, 4))).toEqual([
      expect.objectContaining({ invalidateAccountId: "catalog-source:CMD:FOOTBALL",
        reason: "PROVIDER_STREAM_GAP" })
    ]);
  });

  it("advances the provider cursor without publishing an uncharacterized command", () => {
    const adapter = new CmdHttpCatalogAdapter();
    adapter.decode(envelope({ ...fullResponse, t: 8_277_000 }, 1));
    expect(adapter.decode(envelope({ t: 8_277_400, a: true,
      data: [[25299763, 1, 9_999, "uncharacterized"]] }, 2))).toEqual([]);
    expect(adapter.decode(envelope({ ...oddsChange, t: 8_277_300 }, 3))).toEqual([]);
  });
});
