import { describe, expect, it } from "vitest";
import type { RankedEvent, RankedTicket } from "./ranked-tickets.js";
import { ProfitAlertTracker } from "./profit-alert-tracker.js";

function ranked(profit: string, state: RankedTicket["state"] = "VERIFIED_PROFIT",
  key = "ticket-1", roi = "0.06"): RankedEvent {
  const ticket = { key, eventKey: "event-1", state, plan: { worstCaseProfit: profit,
    roi, legs: [{ provider: "SABA", selection: "HOME" }, { provider: "SBOBET", selection: "AWAY" }] } } as unknown as RankedTicket;
  return { event: { key: "event-1", event: { participantA: "Alpha", participantB: "Beta" },
    catalogs: [{ accountId: "saba", provider: "SABA" }, { accountId: "sbobet", provider: "SBOBET" }] },
    tickets: [ticket], bestVerifiedProfit: state === "OBSERVATION" ? null : profit } as unknown as RankedEvent;
}

describe("ProfitAlertTracker", () => {
  it("alerts for a fresh two-book observation only when its estimated ROI is above five percent", () => {
    const tracker = new ProfitAlertTracker();
    expect(tracker.update([ranked("50000", "OBSERVATION", "ticket-1", "0.05")], 100)).toEqual([]);
    expect(tracker.update([ranked("50001", "OBSERVATION", "ticket-1", "0.050001")], 101)).toHaveLength(1);
    expect(tracker.update([ranked("50001", "VERIFIED_NO_PROFIT", "ticket-2", "0.2")], 102)).toEqual([]);
    expect(tracker.update([ranked("50001", "VERIFIED_PROFIT", "ticket-3", "0.050001")], 103)).toHaveLength(1);
  });

  it("emits each exact ticket only once for the mounted dashboard session", () => {
    const tracker = new ProfitAlertTracker();
    expect(tracker.update([ranked("22000")], 100)).toHaveLength(1);
    expect(tracker.update([ranked("90000", "VERIFIED_PROFIT", "ticket-1", "0.2")], 101)).toEqual([]);
    expect(tracker.update([ranked("1000", "VERIFIED_NO_PROFIT", "ticket-1", "0.01")], 102)).toEqual([]);
    expect(tracker.update([], 103)).toEqual([]);
    expect(tracker.update([ranked("22000")], 104)).toEqual([]);
    expect(tracker.update([ranked("22000", "VERIFIED_PROFIT", "ticket-2")], 105)).toHaveLength(1);
  });

  it("alerts only when every provider leg belongs to a fresh catalog", () => {
    const tracker = new ProfitAlertTracker();
    expect(tracker.update([ranked("50000")], 101, new Set(["saba"]))).toEqual([]);
    const [fresh] = tracker.update([ranked("50000")], 102, new Set(["saba", "sbobet"]));
    expect(fresh?.id).toContain("event-1::ticket-1::SABA:HOME|SBOBET:AWAY");
    expect(fresh?.freshness).toBe("FRESH");
  });
});
