import type { TicketRealtimeCheckRequest } from "@tool-chenh/contracts";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { registerProviderPreflightRoutes, type TicketRealtimeAuditJournalEntry } from "./provider-preflight.js";

const displayed = { provider: "APSPORT", accountId: "ap", providerEventId: "ap-event",
  providerMarketId: "tsport:4:offer", providerSelectionId: "ap-under", selection: "UNDER", line: "1",
  rawOdds: "-0.93", rawFormat: "MALAY", decimalOdds: "2.075268817204301", quoteStatus: "OPEN",
  providerObservedAtMs: 900, receivedMonotonicMs: 70, sequence: 17, requestedStake: "92036" } as const;
const request: TicketRealtimeCheckRequest = { eventLabel: "Torino vs AS Roma", participantA: "Torino",
  participantB: "AS Roma", marketType: "FH_TOTAL", scope: "FIRST_HALF", capturedAtMs: 1_000,
  legs: [displayed, { ...displayed, provider: "BTI", accountId: "bti", providerEventId: "bti-event",
    providerMarketId: "bti-market:1", providerSelectionId: "bti-over", selection: "OVER",
    rawOdds: "0.91", decimalOdds: "1.91", requestedStake: "100000" }] };

describe("read-only price audit persistence latency", () => {
  it.each(["DISPLAY_CAPTURED", "CHECK_COMPLETED"] as const)(
    "returns actual prices while %s storage is stalled without claiming persistence", async stalledType => {
      const order: string[] = [];
      const stored: TicketRealtimeAuditJournalEntry[] = [];
      let release!: () => void;
      const stalled = new Promise<void>(resolve => { release = resolve; });
      let completedStored!: () => void;
      const drained = new Promise<void>(resolve => { completedStored = resolve; });
      const app = Fastify();
      registerProviderPreflightRoutes(app, { preflight: async () => { throw new Error("MUST_READ_PROVIDER"); } }, {
        clock: { nowMs: () => 1_020 },
        journal: { append: async entry => {
          order.push(entry.type);
          if (entry.type === stalledType) await stalled;
          stored.push(entry);
          if (entry.type === "CHECK_COMPLETED") completedStored();
        } },
        visiblePriceProbe: { probe: async input => {
          order.push(`READ:${input.provider}`);
          return { rawOdds: input.provider === "APSPORT" ? "-0.93" : "0.91", observedAtMs: 1_010,
            method: "IN_PAGE_FETCH" };
        } }
      });
      let timer: ReturnType<typeof setTimeout> | undefined;
      const pending = app.inject({ method: "POST", url: "/api/preflight/realtime-check", payload: request });
      const response = await Promise.race([pending, new Promise<"storage blocked response">(resolve => {
        timer = setTimeout(() => resolve("storage blocked response"), 1_000);
      })]);
      if (timer !== undefined) clearTimeout(timer);
      const beforeRelease = [...order];
      const storedBeforeRelease = [...stored];
      release();
      await pending;
      await drained;
      await app.close();

      expect(response).not.toBe("storage blocked response");
      if (response !== "storage blocked response") {
        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({ persisted: false, legs: [
          { status: "MATCH", directMethod: "IN_PAGE_FETCH", direct: { rawOdds: "-0.93", eligible: false } },
          { status: "MATCH", directMethod: "IN_PAGE_FETCH", direct: { rawOdds: "0.91", eligible: false } }
        ] });
      }
      expect(beforeRelease.slice(0, 3)).toEqual(["DISPLAY_CAPTURED", "READ:APSPORT", "READ:BTI"]);
      expect(storedBeforeRelease.map(entry => entry.type)).toEqual(stalledType === "DISPLAY_CAPTURED" ? [] : ["DISPLAY_CAPTURED"]);
      expect(stored.map(entry => entry.type)).toEqual(["DISPLAY_CAPTURED", "CHECK_COMPLETED"]);
    });

  it.each(["DISPLAY_CAPTURED", "CHECK_COMPLETED"] as const)(
    "retains ordered completion and truthful persistence after a rejected %s append", async rejectedType => {
      const order: string[] = [];
      const app = Fastify();
      registerProviderPreflightRoutes(app, { preflight: async () => { throw new Error("MUST_READ_PROVIDER"); } }, {
        journal: { append: async entry => {
          order.push(entry.type);
          if (entry.type === rejectedType) throw new Error("STORAGE_UNAVAILABLE");
        } },
        visiblePriceProbe: { probe: async input => ({ rawOdds: input.provider === "APSPORT" ? "-0.93" : "0.91",
          observedAtMs: 1_010, method: "IN_PAGE_FETCH" }) }
      });
      const response = await app.inject({ method: "POST", url: "/api/preflight/realtime-check", payload: request });
      await app.close();
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ persisted: false, legs: [{ status: "MATCH" }, { status: "MATCH" }] });
      expect(order).toEqual(["DISPLAY_CAPTURED", "CHECK_COMPLETED"]);
    });
});
