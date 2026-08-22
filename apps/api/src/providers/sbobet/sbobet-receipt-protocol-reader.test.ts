import { describe, expect, it } from "vitest";
import { SbobetReceiptProtocolReader } from "./sbobet-receipt-protocol-reader.js";

const evidence = { controlLabel: "Bet history" as const, observations: [] };

describe("SbobetReceiptProtocolReader", () => {
  it("binds the active launch secret to the browser session", async () => {
    const calls: unknown[] = [];
    const reader = new SbobetReceiptProtocolReader({ source: { inspectReceiptProtocol: async (input) => {
      calls.push(input);
      return evidence;
    } } });
    await expect(reader.inspect({ sessionId: "session-1", provider: "SBOBET", category: "FOOTBALL",
      withSecret: async (use) => use({ kind: "LAUNCH_URL", value: "https://private.test/launch" }) }))
      .resolves.toEqual(evidence);
    expect(calls).toEqual([{ sessionId: "session-1", launchUrl: "https://private.test/launch" }]);
  });

  it("rejects a wrong provider or non-launch secret", async () => {
    const reader = new SbobetReceiptProtocolReader({ source: { inspectReceiptProtocol: async () => evidence } });
    await expect(reader.inspect({ sessionId: "session-1", provider: "SABA",
      withSecret: async (use) => use({ kind: "LAUNCH_URL", value: "https://private.test/" }) }))
      .rejects.toThrow("SBOBET_RECEIPT_PROTOCOL_UNAVAILABLE");
    await expect(reader.inspect({ sessionId: "session-1", provider: "SBOBET",
      withSecret: async (use) => use({ kind: "TOKEN", value: "secret" }) }))
      .rejects.toThrow("SBOBET_RECEIPT_PROTOCOL_UNAVAILABLE");
  });
});
