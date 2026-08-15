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
  });
});
