import { describe, expect, it } from "vitest";
import * as contracts from "./index.js";

const validEnvelope = {
  version: 1,
  kind: "NETWORK",
  lobby: "SABA",
  sourceId: "chrome:SABA:42",
  tabId: 42,
  sequence: 7,
  observedAtMs: 1_000,
  receivedMonotonicMs: 50,
  transport: "WS_FRAME",
  request: {
    hostname: "sports.example",
    pathnameClass: "/feed/:opaque",
    resourceType: "WebSocket"
  },
  payload: { encoding: "UTF8", body: "{}" }
} as const;

describe("ChromeBridgeEnvelopeSchema", () => {
  it("accepts only the seven configured lobby identities", () => {
    const schema = (contracts as Record<string, unknown>).ChromeBridgeEnvelopeSchema as {
      safeParse(value: unknown): { success: boolean };
    };
    expect(schema).toBeDefined();
    expect(schema.safeParse(validEnvelope).success).toBe(true);
    expect(schema.safeParse({ ...validEnvelope, lobby: "UNKNOWN" }).success).toBe(false);
  });

  it("rejects URL query material and unknown envelope fields", () => {
    const schema = (contracts as Record<string, unknown>).ChromeBridgeEnvelopeSchema as {
      safeParse(value: unknown): { success: boolean };
    };
    expect(schema).toBeDefined();
    expect(schema.safeParse({
      ...validEnvelope,
      request: { ...validEnvelope.request, query: "token=super-secret" }
    }).success).toBe(false);
    expect(schema.safeParse({ ...validEnvelope, authorization: "super-secret" }).success).toBe(false);
  });

  it("rejects unsafe ordering, timestamps, tab IDs, and oversized payload text", () => {
    const schema = (contracts as Record<string, unknown>).ChromeBridgeEnvelopeSchema as {
      safeParse(value: unknown): { success: boolean };
    };
    expect(schema).toBeDefined();
    for (const invalid of [
      { ...validEnvelope, sequence: -1 },
      { ...validEnvelope, tabId: 1.5 },
      { ...validEnvelope, observedAtMs: Number.NaN },
      { ...validEnvelope, payload: { encoding: "UTF8", body: "x".repeat(262_145) } }
    ]) expect(schema.safeParse(invalid).success).toBe(false);
  });

  it("accepts a bounded public DOM snapshot transport without URL credentials", () => {
    const schema = (contracts as Record<string, unknown>).ChromeBridgeEnvelopeSchema as {
      safeParse(value: unknown): { success: boolean };
    };
    expect(schema.safeParse({
      ...validEnvelope,
      lobby: "CMD",
      sourceId: "chrome:CMD:42",
      transport: "DOM_SNAPSHOT",
      request: { hostname: "cgnew.fts368.com", pathnameClass: "/__fieldline_dom_snapshot__", resourceType: "DOM" },
      payload: { encoding: "UTF8", body: "[]" }
    }).success).toBe(true);
  });

  it("accepts only bounded credential-free source, stream, partition, and replay metadata", () => {
    const schema = contracts.ChromeBridgeEnvelopeSchema;
    const lifecycle = {
      ...validEnvelope,
      sourceEpoch: "observer-a:3",
      transport: "WS_STATE",
      request: { ...validEnvelope.request, streamId: "7", providerPartition: "IM_MARKET_2", replayed: false },
      payload: { encoding: "UTF8", body: '{"state":"OPEN"}' }
    } as const;
    expect(schema.safeParse(lifecycle).success).toBe(true);
    expect(schema.safeParse({ ...lifecycle, sourceEpoch: "x".repeat(129) }).success).toBe(false);
    expect(schema.safeParse({ ...lifecycle,
      request: { ...lifecycle.request, providerPartition: "IM_MARKET_3" } }).success).toBe(false);
    expect(schema.safeParse({ ...lifecycle,
      request: { ...lifecycle.request, streamId: "socket?token=secret" } }).success).toBe(false);
  });

  it("accepts only sanitized provider function and reconciliation cutoff metadata", () => {
    const schema = contracts.ChromeBridgeEnvelopeSchema;
    expect(schema.safeParse({ ...validEnvelope, lobby: "CMD", request: {
      ...validEnvelope.request, providerFunctionCode: 1
    } }).success).toBe(true);
    expect(schema.safeParse({ ...validEnvelope, lobby: "IM", request: {
      ...validEnvelope.request, streamId: "im:42:3", providerPartition: "IM_MARKET_1",
      reconcileCutoffSequence: 17
    } }).success).toBe(true);
    for (const request of [
      { ...validEnvelope.request, providerFunctionCode: 0 },
      { ...validEnvelope.request, providerFunctionCode: 8 },
      { ...validEnvelope.request, providerFunctionCode: "1" },
      { ...validEnvelope.request, reconcileCutoffSequence: -1 }
    ]) expect(schema.safeParse({ ...validEnvelope, request }).success).toBe(false);
  });

  it("requires exact all-or-none KSPORT recovery metadata", () => {
    const schema = contracts.ChromeBridgeEnvelopeSchema;
    const recoveryMetadata = {
      providerPartition: "KSPORT_LIVE",
      providerContentIntent: "FOOTBALL_FULL_CATALOG",
      requestStartSequence: 10
    } as const;

    const parsed = schema.parse({ ...validEnvelope, lobby: "KSPORT", request: {
      ...validEnvelope.request, ...recoveryMetadata
    } });
    expect(parsed.request).toMatchObject(recoveryMetadata);

    for (const lobby of ["IM", "BTI", "TSPORT", "SABA", "CMD", "SBO"] as const) {
      expect(schema.safeParse({ ...validEnvelope, lobby, request: {
        ...validEnvelope.request, ...recoveryMetadata
      } }).success).toBe(false);
    }

    for (const request of [
      { ...validEnvelope.request, providerPartition: "KSPORT_LIVE" },
      { ...validEnvelope.request, providerContentIntent: "FOOTBALL_FULL_CATALOG" },
      { ...validEnvelope.request, requestStartSequence: 10 },
      { ...validEnvelope.request, providerPartition: "KSPORT_LIVE", requestStartSequence: 10 },
      { ...validEnvelope.request, providerPartition: "KSPORT_TODAY",
        providerContentIntent: "FOOTBALL_FULL_CATALOG" },
      { ...validEnvelope.request, providerContentIntent: "FOOTBALL_FULL_CATALOG",
        requestStartSequence: 10 },
      { ...validEnvelope.request, ...recoveryMetadata, providerPartition: "KSPORT_UPCOMING" },
      { ...validEnvelope.request, ...recoveryMetadata, providerContentIntent: "ALL_SPORTS" },
      { ...validEnvelope.request, ...recoveryMetadata, requestStartSequence: -1 },
      { ...validEnvelope.request, ...recoveryMetadata, requestStartSequence: 1.5 },
      { ...validEnvelope.request, ...recoveryMetadata, requestStartSequence: Number.MAX_SAFE_INTEGER + 1 }
    ]) expect(schema.safeParse({ ...validEnvelope, lobby: "KSPORT", request }).success).toBe(false);
  });

  it("preserves only a positive safe KSPORT websocket recovery generation", () => {
    const schema = contracts.ChromeBridgeEnvelopeSchema;
    const ksport = { ...validEnvelope, lobby: "KSPORT", sourceId: "chrome:KSPORT:42", request: {
      ...validEnvelope.request, streamId: "7", recoveryGeneration: 3
    } } as const;

    expect(schema.parse(ksport).request).toMatchObject({ streamId: "7", recoveryGeneration: 3 });
    for (const recoveryGeneration of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "3"] as const) {
      expect(schema.safeParse({ ...ksport, request: { ...ksport.request, recoveryGeneration } }).success).toBe(false);
    }
    expect(schema.safeParse({ ...ksport, lobby: "SABA", sourceId: "chrome:SABA:42" }).success).toBe(false);
  });

  it("requires an exact sanitized method and observer request identity for every HTTP response", () => {
    const schema = contracts.ChromeBridgeEnvelopeSchema;
    const http = {
      ...validEnvelope,
      transport: "HTTP_RESPONSE",
      request: {
        ...validEnvelope.request,
        method: "POST",
        observerRequestId: "observer-a:request:17"
      }
    } as const;

    expect(schema.safeParse(http).success).toBe(true);
    for (const request of [
      { ...http.request, method: undefined },
      { ...http.request, observerRequestId: undefined },
      { ...http.request, method: "post" },
      { ...http.request, method: "GET /secret" },
      { ...http.request, observerRequestId: "request?token=secret" }
    ]) {
      expect(schema.safeParse({ ...http, request }).success).toBe(false);
    }
  });

  it("accepts only all-or-none opaque frame and document provenance", () => {
    const schema = contracts.ChromeBridgeEnvelopeSchema;
    const http = {
      ...validEnvelope,
      transport: "HTTP_RESPONSE",
      request: {
        ...validEnvelope.request,
        method: "POST",
        observerRequestId: "observer-a:request:17",
        requestFrameKey: "http-frame:8f3a1b2c",
        requestDocumentKey: "http-document:4d5e6f70"
      }
    } as const;

    expect(schema.safeParse(http).success).toBe(true);
    expect(schema.safeParse({ ...http, request: {
      ...http.request, requestFrameKey: undefined
    } }).success).toBe(false);
    expect(schema.safeParse({ ...http, request: {
      ...http.request, requestDocumentKey: undefined
    } }).success).toBe(false);
    expect(schema.safeParse({ ...http, request: {
      ...http.request, requestFrameKey: "frame?token=secret"
    } }).success).toBe(false);
    expect(schema.safeParse({ ...http, request: {
      ...http.request, frameId: "raw-frame", loaderId: "raw-loader"
    } }).success).toBe(false);
  });
});

describe("ChromeBridgeControlMessageSchema", () => {
  it("accepts strict ACK and source-state messages and rejects secret-bearing extras", () => {
    const schema = (contracts as Record<string, unknown>).ChromeBridgeControlMessageSchema as {
      safeParse(value: unknown): { success: boolean };
    };
    expect(schema).toBeDefined();
    expect(schema.safeParse({ version: 1, kind: "ACK", sourceId: "chrome:SABA:42", sequence: 7 }).success).toBe(true);
    expect(schema.safeParse({ version: 1, kind: "ACK", sourceId: "chrome:SABA:42", sequence: 7,
      token: "super-secret" }).success).toBe(false);
    expect(schema.safeParse({ version: 1, kind: "REQUEST_SNAPSHOT", sourceId: "chrome:IM:42" }).success).toBe(true);
    expect(schema.safeParse({ version: 1, kind: "RELOAD_SOURCE", sourceId: "chrome:SABA:7" }).success).toBe(true);
    expect(schema.safeParse({ version: 1, kind: "NAVIGATE_SOURCE", sourceId: "chrome:SABA:7",
      url: "https://c0z0ob.bpd3a3fn.com/sports?token=opaque" }).success).toBe(true);
    expect(schema.safeParse({ version: 1, kind: "NAVIGATE_SOURCE", sourceId: "chrome:SABA:7",
      url: "http://c0z0ob.bpd3a3fn.com/sports" }).success).toBe(false);
    expect(schema.safeParse({ version: 1, kind: "NAVIGATE_SOURCE", sourceId: "chrome:SABA:7",
      url: "https://user:password@c0z0ob.bpd3a3fn.com/sports" }).success).toBe(false);
    expect(schema.safeParse({ version: 1, kind: "ENSURE_SOURCE", lobby: "CMD",
      url: "https://cgnew.fts368.com/sports?opaque=1" }).success).toBe(true);
    expect(schema.safeParse({ version: 1, kind: "ENSURE_SOURCE", lobby: "CMD",
      url: "http://cgnew.fts368.com/sports" }).success).toBe(false);
    expect(schema.safeParse({ version: 1, kind: "ENSURE_SOURCE", lobby: "UNKNOWN",
      url: "https://cgnew.fts368.com/sports" }).success).toBe(false);
    expect(schema.safeParse({ version: 1, kind: "RESTORE_SOURCE", lobby: "CMD" }).success).toBe(true);
    expect(schema.safeParse({ version: 1, kind: "RESTORE_SOURCE", lobby: "CMD", url: "secret" }).success).toBe(false);
    expect(schema.safeParse({ version: 1, kind: "REQUEST_SNAPSHOT", sourceId: "chrome:IM:42",
      token: "super-secret" }).success).toBe(false);
  });

  it("accepts only a strict bounded read-only selection focus command", () => {
    const schema = contracts.ChromeBridgeControlMessageSchema;
    const valid = {
      version: 1,
      kind: "FOCUS_SELECTION",
      sourceId: "chrome:CMD:42",
      providerEventId: "event-opaque-1",
      providerMarketId: "market-opaque-1",
      providerSelectionId: "selection-opaque-1"
    } as const;
    expect(schema.safeParse(valid).success).toBe(true);
    expect(schema.safeParse({ ...valid, click: true }).success).toBe(false);
    expect(schema.safeParse({ ...valid, providerSelectionId: "x".repeat(513) }).success).toBe(false);
    expect(schema.safeParse({ ...valid, providerMarketId: "" }).success).toBe(false);
  });

  it("accepts only a strict event-scoped CMD hidden-market probe command", () => {
    const schema = contracts.ChromeBridgeControlMessageSchema;
    const valid = { version: 1, kind: "PROBE_CMD_HIDDEN_MARKETS", sourceId: "chrome:CMD:42",
      requestId: "probe-4f90a2", providerEventId: "25250586" } as const;
    expect(schema.safeParse(valid).success).toBe(true);
    expect(schema.safeParse({ ...valid, clickOdds: true }).success).toBe(false);
    expect(schema.safeParse({ ...valid, providerEventId: "" }).success).toBe(false);
    expect(schema.safeParse({ ...valid, requestId: "x".repeat(129) }).success).toBe(false);
  });

  it("accepts only a strict read-only visible selection price probe command", () => {
    const schema = contracts.ChromeBridgeControlMessageSchema;
    const valid = { version: 1, kind: "PROBE_SELECTION_PRICE", sourceId: "chrome:TSPORT:42",
      requestId: "price-4f90a2", providerEventId: "event-1", providerMarketId: "market-1",
      providerSelectionId: "selection-1", eventLabel: "Alpha vs Beta",
      participantA: "Alpha", participantB: "Beta", marketType: "FT_TOTAL",
      scope: "FULL_TIME", selection: "UNDER", line: "2.5" } as const;
    expect(schema.safeParse(valid).success).toBe(true);
    expect(schema.safeParse({ ...valid, click: true }).success).toBe(false);
    expect(schema.safeParse({ ...valid, requestId: "x".repeat(129) }).success).toBe(false);
    expect(schema.safeParse({ ...valid, providerSelectionId: "" }).success).toBe(false);
    expect(schema.safeParse({ ...valid, eventLabel: "" }).success).toBe(false);
    expect(schema.safeParse({ ...valid, participantA: "" }).success).toBe(false);
    expect(schema.safeParse({ ...valid, participantB: "x".repeat(257) }).success).toBe(false);
    const { participantA: _participantA, ...withoutParticipant } = valid;
    expect(schema.safeParse(withoutParticipant).success).toBe(false);
    expect(schema.safeParse({ ...valid, line: "not-a-line" }).success).toBe(false);
  });
});

describe("CmdSnapshotChunkSchema", () => {
  const valid = {
    schemaVersion: 2,
    snapshotId: "cmd-1786776000000-abcdef",
    chunkIndex: 1,
    chunkCount: 3,
    records: [{ matchId: "m-1" }]
  } as const;

  it("accepts a strict bounded chunk", () => {
    expect(contracts.CmdSnapshotChunkSchema.safeParse(valid).success).toBe(true);
    expect(contracts.CmdSnapshotChunkSchema.safeParse({ ...valid, sweepId: "cmd:sweep:1",
      sweepComplete: true, sweepFrameKey: "odds-frame",
      sweepDocumentKey: "worker-a:9:odds-frame:document-1" }).success).toBe(true);
    expect(contracts.CmdSnapshotChunkSchema.safeParse({ ...valid, records: [], sweepId: "cmd:sweep:empty",
      sweepComplete: true, sweepFrameKey: "odds-frame",
      sweepDocumentKey: "worker-a:9:odds-frame:document-1" }).success).toBe(true);
  });

  it("rejects invalid indexes, excessive counts, empty records, and extra fields", () => {
    for (const invalid of [
      { ...valid, chunkIndex: 3 },
      { ...valid, chunkIndex: -1 },
      { ...valid, chunkCount: 65 },
      { ...valid, records: [] },
      { ...valid, sweepFrameKey: "odds-frame" },
      { ...valid, sweepDocumentKey: "worker-a:document-1" },
      { ...valid, records: [], sweepId: "cmd:sweep:partial", sweepComplete: false,
        sweepFrameKey: "odds-frame", sweepDocumentKey: "worker-a:9:odds-frame:document-1" },
      { ...valid, sweepId: "cmd:sweep:1", sweepComplete: true },
      { ...valid, sweepId: "cmd:sweep:1", sweepComplete: true, sweepFrameKey: "odds-frame" },
      { ...valid, sweepId: "cmd:sweep:1", sweepComplete: true, sweepFrameKey: "unsafe/frame",
        sweepDocumentKey: "worker-a:9:odds-frame:document-1" },
      { ...valid, credential: "secret" }
    ]) expect(contracts.CmdSnapshotChunkSchema.safeParse(invalid).success).toBe(false);
  });
});

describe("ChromeNetworkBodyChunkSchema", () => {
  const valid = {
    schemaVersion: 1,
    snapshotId: "network-42-request-abcdef",
    chunkIndex: 0,
    chunkCount: 2,
    bodyEncoding: "UTF8",
    bodyFragment: "{\"StatusCode\":100,"
  } as const;

  it("accepts strict bounded HTTP response chunks", () => {
    expect(contracts.ChromeNetworkBodyChunkSchema.safeParse(valid).success).toBe(true);
    expect(contracts.ChromeNetworkBodyChunkSchema.safeParse({ ...valid, chunkCount: 256 }).success).toBe(true);
  });

  it("rejects invalid indexes, excessive counts, and extra fields", () => {
    for (const invalid of [
      { ...valid, chunkIndex: 2 },
      { ...valid, chunkCount: 257 },
      { ...valid, bodyFragment: "x".repeat(131_073) },
      { ...valid, token: "secret" }
    ]) expect(contracts.ChromeNetworkBodyChunkSchema.safeParse(invalid).success).toBe(false);
  });
});
