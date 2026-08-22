import type { ProviderTicketPreflightRequest } from "@tool-chenh/contracts";
import { describe, expect, it } from "vitest";
import { BtiTicketPreflightReader } from "./bti-ticket-preflight-reader.js";

const selection = (id: string, side: 1 | 3, line: number, malay: string, locked = false) =>
  [id, { VI: "team" }, { VI: "team line" }, locked, false, 1.9, ["", "1.90", "", "", "", malay], side, 2, {}, "", "event", "market", line];
const market = (id: string, selections: unknown[]) =>
  [id, "Cược trực tiếp", "Cược trực tiếp", ["HC39", "full time", 1], "event", "league", "1", selections];
const payload = { serializedData: [["league", "Giải thật", 0, "", false, "", "", "", "", "", "1", "Football", [[
  "event-real", [["home-id", { VI: "Alpha" }], ["away-id", { VI: "Beta" }]], "Alpha vs Beta", "", ["0", "0"], true,
  false, [], ["event-real", 0, [], [market("market-real", [selection("home-real", 1, -0.5, "0.82"),
    selection("away-real", 3, 0.5, "-0.92")])]]
]]]] };

const request: ProviderTicketPreflightRequest = { accountId: "account-1", providerEventId: "event-real",
  providerMarketId: "market-real:-0.5", providerSelectionId: "home-real", selection: "HOME", line: "-0.5",
  expectedDecimalOdds: "1.82", requestedStake: "29000" };
const handle = { sessionId: "session-1", provider: "BTI", category: "FOOTBALL" as const,
  withSecret: async <T>(consume: (secret: { kind: "LAUNCH_URL"; value: string }) => Promise<T>) =>
    consume({ kind: "LAUNCH_URL", value: "https://private.test/" }) };

describe("BtiTicketPreflightReader", () => {
  it("reads the requested prematch event detail instead of the live-only catalog", async () => {
    const { extractBtiCatalogRecords } = await import("./bti-direct-catalog.js");
    let requestedEventId = "";
    const reader = new BtiTicketPreflightReader({ source: {
      readCatalog: async ({ providerEventId }) => {
        requestedEventId = providerEventId ?? "";
        if (providerEventId === undefined) throw new Error("live-only catalog must not be used");
        return { records: extractBtiCatalogRecords(payload), observedAtMs: 1000, receivedMonotonicMs: 10 };
      }
    }, fee: { type: "NONE" } });

    await expect(reader.preflight(handle, request)).resolves.toMatchObject({
      providerEventId: "event-real", providerSelectionId: "home-real", selection: "HOME", line: "-0.5"
    });
    expect(requestedEventId).toBe("event-real");
  });

  it("re-reads the exact public ticket and blocks honestly while limits are unavailable", async () => {
    const { extractBtiCatalogRecords } = await import("./bti-direct-catalog.js");
    const reader = new BtiTicketPreflightReader({ source: { readCatalog: async () => ({
      records: extractBtiCatalogRecords(payload), observedAtMs: 1000, receivedMonotonicMs: 10
    }) }, fee: { type: "NONE" } });
    await expect(reader.preflight(handle, request)).resolves.toMatchObject({ provider: "BTI",
      providerEventId: "event-real", providerMarketId: "market-real:-0.5", providerSelectionId: "home-real",
      decimalOdds: "1.82", quoteStatus: "OPEN", limitEvidence: null, constraint: null, eligible: false,
      reasons: ["LIMIT_UNAVAILABLE"] });
  });

  it("reports an odds change and rejects any identity mismatch", async () => {
    const { extractBtiCatalogRecords } = await import("./bti-direct-catalog.js");
    const reader = new BtiTicketPreflightReader({ source: { readCatalog: async () => ({
      records: extractBtiCatalogRecords(payload), observedAtMs: 1000, receivedMonotonicMs: 10
    }) }, fee: { type: "NONE" } });
    await expect(reader.preflight(handle, { ...request, expectedDecimalOdds: "1.9" })).resolves.toMatchObject({
      reasons: ["LIMIT_UNAVAILABLE", "ODDS_CHANGED"] });
    await expect(reader.preflight(handle, { ...request, providerSelectionId: "other" }))
      .rejects.toThrow("PREFLIGHT_IDENTITY_MISMATCH");
  });

  it("returns a short-lived constraint only when the exact BTI slip exposes every limit", async () => {
    const { extractBtiCatalogRecords } = await import("./bti-direct-catalog.js");
    const reader = new BtiTicketPreflightReader({ source: {
      readCatalog: async () => ({ records: extractBtiCatalogRecords(payload), observedAtMs: 1000,
        receivedMonotonicMs: 10 }),
      readTicketConstraint: async () => ({ providerSelectionId: "home-real", currency: "VND",
        minStake: "25250", maxStake: "17669910", stakeStep: "10", balance: "29610", observedAtMs: 2000 })
    }, clock: { nowMs: () => 2100 }, fee: { type: "PROFIT", rate: "0.03" } });

    await expect(reader.preflight(handle, { ...request, requestedStake: "29000" })).resolves.toMatchObject({
      limitEvidence: { currency: "VND", minStake: "25250", maxStake: "17669910", stakeStep: "10", balance: "29610" },
      constraint: { currency: "VND", minStake: "25250", maxStake: "17669910", stakeStep: "10",
        balance: "29610", feeType: "PROFIT", feeRate: "0.03", verifiedAsOfMs: 2000, expiresAtMs: 5000 },
      eligible: true, reasons: []
    });
  });

  it("keeps the ticket blocked for incomplete limits and reports stake failures independently", async () => {
    const { extractBtiCatalogRecords } = await import("./bti-direct-catalog.js");
    const source = { readCatalog: async () => ({ records: extractBtiCatalogRecords(payload), observedAtMs: 1000,
      receivedMonotonicMs: 10 }), readTicketConstraint: async () => null };
    await expect(new BtiTicketPreflightReader({ source, fee: { type: "NONE" } }).preflight(handle, request)).resolves.toMatchObject({
      limitEvidence: null, constraint: null, eligible: false, reasons: ["LIMIT_UNAVAILABLE"]
    });

    const constrained = new BtiTicketPreflightReader({ source: { ...source,
      readTicketConstraint: async () => ({ providerSelectionId: "home-real", currency: "VND",
        minStake: "30000", maxStake: "100000", stakeStep: "1000", balance: "50000", observedAtMs: 2000 })
    }, clock: { nowMs: () => 2000 }, fee: { type: "NONE" } });
    await expect(constrained.preflight(handle, { ...request, requestedStake: "29000" })).resolves.toMatchObject({
      eligible: false, reasons: ["BELOW_MIN"]
    });
    await expect(constrained.preflight(handle, { ...request, requestedStake: "51000" })).resolves.toMatchObject({
      eligible: false, reasons: ["INSUFFICIENT_BALANCE"]
    });
    await expect(constrained.preflight(handle, { ...request, requestedStake: "30500" })).resolves.toMatchObject({
      eligible: false, reasons: ["STAKE_STEP_MISMATCH"]
    });
  });
});
