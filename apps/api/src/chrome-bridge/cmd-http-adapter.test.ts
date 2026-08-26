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

function envelope(body: unknown, sequence: number, providerFunctionCode = 1): ChromeBridgeEnvelope {
  const value = { version: 1, kind: "NETWORK", lobby: "CMD", sourceId: "chrome:CMD:9", tabId: 9,
    sourceEpoch: "observer-cmd:0", sequence, observedAtMs: 1_787_494_070_000 + sequence,
    receivedMonotonicMs: 100 + sequence, transport: "HTTP_RESPONSE",
    request: { hostname: "cgnew.fts368.com", pathnameClass: "/Member/BetsView/BetLight/DataOdds.ashx",
      resourceType: "XHR", method: "GET", observerRequestId: `observer-a:request:${sequence}`,
      requestFrameKey: "http-frame:cmd-main", requestDocumentKey: "http-document:cmd-document",
      providerFunctionCode }, payload: { encoding: "UTF8", body: JSON.stringify(body) } };
  return value as ChromeBridgeEnvelope;
}

describe("CmdHttpCatalogAdapter", () => {
  it("accepts the current decimal-string cursor and bounded alternating metadata row", () => {
    const adapter = new CmdHttpCatalogAdapter();
    const metadata = Array.from({ length: 64 }, (_, index) => [index + 1, `league-${index + 1}`]).flat();
    const update = adapter.decode(envelope({ ...fullResponse, t: "8281247",
      data: [metadata] }, 1)).at(-1);

    expect(update).toMatchObject({ authoritativeBaseline: true, evidenceMode: "BASELINE",
      generation: "cmd:8281247" });
  });

  it("rejects noncanonical string cursors and short metadata lookalikes", () => {
    const adapter = new CmdHttpCatalogAdapter();

    for (const t of ["08281247", "8.281247e6", "8281247.0", "9007199254740992", ""] as const) {
      expect(adapter.decode(envelope({ ...fullResponse, t }, 1))).toEqual([]);
    }
    expect(adapter.decode(envelope({ ...fullResponse,
      data: [[1, "metadata-lookalike"]] }, 2))).toEqual([]);
  });

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
    expect(adapter.decode(envelope(oddsChange, 2, 3))).toEqual([]);
  });

  it("renews a quiet same-cursor fc1 only for an independently observed bound request", () => {
    const adapter = new CmdHttpCatalogAdapter();
    const body = { ...fullResponse, t: 100 };
    const firstEnvelope = envelope(body, 1, 1);
    const first = adapter.decode(firstEnvelope).at(-1);

    expect(first).toMatchObject({ authoritativeBaseline: true, evidenceMode: "BASELINE",
      generation: "cmd:100" });
    expect(adapter.decode(firstEnvelope)).toEqual([]);

    const redeliveredRequest = envelope(body, 2, 1);
    expect(adapter.decode({ ...redeliveredRequest, request: { ...redeliveredRequest.request,
      observerRequestId: firstEnvelope.request.observerRequestId } })).toEqual([]);
    const otherDocument = envelope(body, 3, 1);
    expect(adapter.decode({ ...otherDocument, request: { ...otherDocument.request,
      requestDocumentKey: "http-document:cmd-other" } })).toEqual([]);

    const renewed = adapter.decode(envelope(body, 4, 1)).at(-1);
    expect(renewed).toMatchObject({ authoritativeBaseline: true, evidenceMode: "BASELINE" });
    expect(renewed?.generation).not.toBe(first?.generation);

    const lateRedelivery = envelope(body, 5, 1);
    expect(adapter.decode({ ...lateRedelivery, request: { ...lateRedelivery.request,
      observerRequestId: firstEnvelope.request.observerRequestId } })).toEqual([]);
    const delta = adapter.decode(envelope({ ...oddsChange, t: 101 }, 6, 3)).at(-1);
    expect(delta).toMatchObject({ evidenceMode: "DELTA", generation: renewed?.generation });
    expect(adapter.decode(envelope({ ...fullResponse, t: 99 }, 7, 1))).toEqual([]);
  });

  it("renews beyond a fixed history window but rejects an unseen older request ordinal", () => {
    const adapter = new CmdHttpCatalogAdapter();
    const body = { ...fullResponse, t: 100 };
    adapter.decode(envelope(body, 1, 1));

    for (let ordinal = 2; ordinal <= 66; ordinal += 2) {
      const update = adapter.decode(envelope(body, ordinal, 1)).at(-1);
      expect(update).toMatchObject({ authoritativeBaseline: true, evidenceMode: "BASELINE" });
    }

    const olderUnseenRequest = envelope(body, 67, 1);
    expect(adapter.decode({ ...olderUnseenRequest, request: { ...olderUnseenRequest.request,
      observerRequestId: "observer-a:request:65" } })).toEqual([]);
  });

  it("requires observer-session continuity until the source is reset", () => {
    const adapter = new CmdHttpCatalogAdapter();
    const body = { ...fullResponse, t: 100 };
    const first = envelope(body, 1, 1);
    adapter.decode(first);
    const nextSession = envelope(body, 2, 1);
    const nextSessionRequest = { ...nextSession, request: { ...nextSession.request,
      observerRequestId: "observer-b:request:2" } };

    expect(adapter.decode(nextSessionRequest)).toEqual([]);
    adapter.resetSource(first.sourceId);
    expect(adapter.decode(nextSessionRequest)).toEqual([
      expect.objectContaining({ authoritativeBaseline: true, evidenceMode: "BASELINE", generation: "cmd:100" })
    ]);
  });

  it("maps the characterized line and odds commands to stable provider selections", () => {
    const adapter = new CmdHttpCatalogAdapter();
    const earlier = { ...fullResponse, t: 8_277_000 };
    adapter.decode(envelope(earlier, 1));
    const update = adapter.decode(envelope(oddsChange, 2, 3)).at(-1);
    expect(update).toMatchObject({ evidenceMode: "DELTA", provenance: "AUTHENTICATED_HTTP",
      generation: "cmd:8277000", providerTimestampMs: null });
    expect((update?.value as { quotes: Array<{ providerSelectionId: string; rawOdds: string }> }).quotes)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ providerSelectionId: "25299763:3:over", rawOdds: "0.8" }),
        expect.objectContaining({ providerSelectionId: "25299763:3:under", rawOdds: "-0.98" })
      ]));
  });

  it("commits a complete baseline below a buffered pre-baseline delta and reapplies that delta", () => {
    const adapter = new CmdHttpCatalogAdapter();
    const baseline = { ...fullResponse, t: 100 };
    const newerDelta = { ...oddsChange, t: 101 };

    expect(adapter.decode(envelope(newerDelta, 1, 3))).toEqual([]);
    const updates = adapter.decode(envelope(baseline, 2, 1));

    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ authoritativeBaseline: true, evidenceMode: "BASELINE",
      generation: "cmd:100" });
    expect((updates[0]?.value as { quotes: Array<{ providerSelectionId: string; rawOdds: string }> }).quotes)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ providerSelectionId: "25299763:3:over", rawOdds: "0.8" }),
        expect.objectContaining({ providerSelectionId: "25299763:3:under", rawOdds: "-0.98" })
      ]));
  });

  it("bounds pre-baseline deltas without blocking the next complete baseline below the overflow watermark", () => {
    const adapter = new CmdHttpCatalogAdapter();
    let overflowUpdate = adapter.decode(envelope({ ...oddsChange, t: 101 }, 1, 3));
    for (let index = 1; index < 33; index += 1) {
      overflowUpdate = adapter.decode(envelope({ ...oddsChange, t: 101 + index }, index + 1, 3));
    }

    expect(overflowUpdate).toEqual([expect.objectContaining({
      invalidateAccountId: "catalog-source:CMD:FOOTBALL", reason: "PROVIDER_STREAM_GAP"
    })]);
    expect(adapter.decode(envelope({ ...fullResponse, t: 100 }, 40, 1))).toEqual([
      expect.objectContaining({ authoritativeBaseline: true, evidenceMode: "BASELINE", generation: "cmd:100" })
    ]);
  });

  it("fails closed on lookalike hosts, incomplete full shapes, and provider reset signals", () => {
    const adapter = new CmdHttpCatalogAdapter();
    expect(adapter.fingerprint({ ...envelope(fullResponse, 1), request: { ...envelope(fullResponse, 1).request,
      hostname: "cgnew.fts368.com.evil.example" } })).toBe(false);
    expect(adapter.decode(envelope({ t: 1, a: true, data: [] }, 2))).toEqual([]);
    adapter.decode(envelope(fullResponse, 3));
    expect(adapter.decode(envelope({ t: 8_281_248, a: false, data: [] }, 4, 3))).toEqual([
      expect.objectContaining({ invalidateAccountId: "catalog-source:CMD:FOOTBALL",
        reason: "PROVIDER_STREAM_GAP" })
    ]);
  });

  it("advances the provider cursor without publishing an uncharacterized command", () => {
    const adapter = new CmdHttpCatalogAdapter();
    adapter.decode(envelope({ ...fullResponse, t: 8_277_000 }, 1));
    expect(adapter.decode(envelope({ t: 8_277_400, a: true,
      data: [[25299763, 1, 9_999, "uncharacterized"]] }, 2, 3))).toEqual([]);
    expect(adapter.decode(envelope({ ...oddsChange, t: 8_277_300 }, 3, 3))).toEqual([]);
  });

  it("requires the observed fc family and rejects a malformed atomic full generation", () => {
    const adapter = new CmdHttpCatalogAdapter();
    expect(adapter.decode(envelope(fullResponse, 1, 3))).toEqual([]);
    expect(adapter.decode(envelope(fullResponse, 2, 2))).toEqual([]);
    expect(adapter.decode(envelope({ ...fullResponse,
      today: [...fullResponse.today, [25299764, "unknown-row"]] }, 3, 1))).toEqual([]);
    expect(adapter.decode(envelope({ t: 8_281_247, a: true,
      data: fullResponse.data, f: [] }, 4, 1))).toEqual([]);
  });

  it("does not let rejected pre-baseline function families poison a later complete baseline", () => {
    const adapter = new CmdHttpCatalogAdapter();
    expect(adapter.decode(envelope({ ...fullResponse, t: 101 }, 1, 3))).toEqual([]);
    expect(adapter.decode(envelope({ ...fullResponse, t: 102 }, 2, 2))).toEqual([]);
    expect(adapter.decode(envelope({ ...fullResponse, t: 100 }, 3, 1))).toEqual([
      expect.objectContaining({ authoritativeBaseline: true, evidenceMode: "BASELINE", generation: "cmd:100" })
    ]);
  });

  it("does not let a rejected post-baseline function family poison a later valid delta", () => {
    const adapter = new CmdHttpCatalogAdapter();
    adapter.decode(envelope({ ...fullResponse, t: 100 }, 1, 1));

    expect(adapter.decode(envelope({ ...fullResponse, t: 200 }, 2, 2))).toEqual([]);
    expect(adapter.decode(envelope({ ...oddsChange, t: 150 }, 3, 3))).toEqual([
      expect.objectContaining({ evidenceMode: "DELTA", generation: "cmd:100" })
    ]);
  });

  it("rejects a mixed malformed post-baseline delta atomically without advancing its cursor", () => {
    const adapter = new CmdHttpCatalogAdapter();
    adapter.decode(envelope({ ...fullResponse, t: 100 }, 1, 1));
    const malformed = { ...oddsChange, t: 101,
      data: [...oddsChange.data, [25299763, 1, 35, 0.8, "not-an-odd"]] };

    expect(adapter.decode(envelope(malformed, 2, 3))).toEqual([]);
    expect(adapter.decode(envelope({ ...oddsChange, t: 101 }, 3, 3))).toEqual([
      expect.objectContaining({ evidenceMode: "DELTA", generation: "cmd:100" })
    ]);
  });
});
