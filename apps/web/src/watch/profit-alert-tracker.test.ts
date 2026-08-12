import { describe, expect, it } from "vitest";
import type { RankedEvent, RankedTicket } from "./ranked-tickets.js";
import { ProfitAlertTracker } from "./profit-alert-tracker.js";

function ranked(profit: string, state: RankedTicket["state"] = "VERIFIED_PROFIT",
  key = "ticket-1"): RankedEvent {
  const ticket = { key, eventKey: "event-1", state, plan: { worstCaseProfit: profit,
    legs: [{ provider: "SABA", selection: "HOME" }, { provider: "SBOBET", selection: "AWAY" }] } } as unknown as RankedTicket;
  return { event: { key: "event-1", event: { participantA: "Alpha", participantB: "Beta" } },
    tickets: [ticket], bestVerifiedProfit: state === "OBSERVATION" ? null : profit } as unknown as RankedEvent;
}

describe("ProfitAlertTracker", () => {
  it("emits once on entry and only repeats after a 5,000 VND profit increase", () => {
    const tracker = new ProfitAlertTracker();
    expect(tracker.update([ranked("20000")], 100)).toHaveLength(1);
    expect(tracker.update([ranked("20000")], 101)).toEqual([]);
    expect(tracker.update([ranked("24999")], 102)).toEqual([]);
    expect(tracker.update([ranked("25000")], 103)).toHaveLength(1);
  });

  it("re-arms after falling below threshold or disappearing", () => {
    const tracker = new ProfitAlertTracker();
    tracker.update([ranked("22000")], 100);
    expect(tracker.update([ranked("19000", "VERIFIED_NO_PROFIT")], 101)).toEqual([]);
    expect(tracker.update([ranked("22000")], 102)).toHaveLength(1);
    expect(tracker.update([], 103)).toEqual([]);
    expect(tracker.update([ranked("22000")], 104)).toHaveLength(1);
  });

  it("uses exact sorted legs in identity and never alerts observations", () => {
    const tracker = new ProfitAlertTracker();
    expect(tracker.update([ranked("50000", "OBSERVATION")], 100)).toEqual([]);
    const [alert] = tracker.update([ranked("50000")], 101);
    expect(alert?.id).toContain("event-1::ticket-1::SABA:HOME|SBOBET:AWAY");
  });
});
