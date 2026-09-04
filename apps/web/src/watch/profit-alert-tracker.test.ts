import { describe, expect, it } from "vitest";
import type { RankedEvent, RankedTicket } from "./ranked-tickets.js";
import { loadProfitAlerts, ProfitAlertTracker, saveProfitAlerts } from "./profit-alert-tracker.js";

function ranked(profit: string, state: RankedTicket["state"] = "VERIFIED_PROFIT",
  key = "FT_AH|FULL_TIME|-0.5|settlement", roi = "0.06", eventKey = "event-1",
  swapped = false): RankedEvent {
  const ticket = { key, eventKey, state, row: { marketType: "FT_AH", scope: "FULL_TIME", line: "-0.5" },
    plan: { currency: "VND", worstCaseProfit: profit, roi, legs: swapped ? [
      { provider: "SABA", selection: "AWAY" }, { provider: "BTI", selection: "HOME" }
    ] : [{ provider: "SABA", selection: "HOME" }, { provider: "BTI", selection: "AWAY" }] } } as unknown as RankedTicket;
  return { event: { key: eventKey,
    event: { competition: "Premier League", participantA: "Alpha", participantB: "Beta" },
    catalogs: [{ accountId: "saba", provider: "SABA" }, { accountId: "bti", provider: "BTI" }] },
    tickets: [ticket], bestVerifiedProfit: state === "OBSERVATION" ? null : profit } as unknown as RankedEvent;
}

function memoryStorage(seed: string | null = null) {
  let value = seed;
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => { value = next; },
    value: () => value
  };
}

describe("ProfitAlertTracker", () => {
  it("records fresh two-book opportunities only when ROI is strictly above five percent", () => {
    const tracker = new ProfitAlertTracker();
    expect(tracker.update([ranked("50000", "OBSERVATION", undefined, "0.05")], 100).history).toEqual([]);
    expect(tracker.update([ranked("50001", "OBSERVATION", undefined, "0.050001")], 101).history).toHaveLength(1);
    expect(tracker.update([ranked("50001", "VERIFIED_NO_PROFIT", "ticket-2", "0.2")], 102).history).toHaveLength(1);
  });

  it("keeps one stable row across rate changes and updates it only to the maximum ROI", () => {
    const tracker = new ProfitAlertTracker();
    const first = tracker.update([ranked("22000", "OBSERVATION", undefined, "0.06")], 100);
    const lower = tracker.update([ranked("21000", "OBSERVATION", undefined, "0.055")], 101);
    const higher = tracker.update([ranked("90000", "OBSERVATION", undefined, "0.2")], 102);

    expect(first.added).toHaveLength(1);
    expect(lower.added).toEqual([]);
    expect(lower.changed).toBe(false);
    expect(higher.added).toEqual([]);
    expect(higher.history).toHaveLength(1);
    expect(higher.history[0]).toMatchObject({ roi: "0.2", worstCaseProfit: "90000", observedAtMs: 102,
      matchName: "Alpha vs Beta", marketName: "Chấp toàn trận", line: "-0.5",
      providers: ["SABA", "BTI"] });
  });

  it("does not duplicate a ticket when changing rates swap which outcome each book supplies", () => {
    const tracker = new ProfitAlertTracker();
    tracker.update([ranked("22000", "OBSERVATION", undefined, "0.06")], 100);
    const swapped = tracker.update([ranked("90000", "OBSERVATION", undefined, "0.2", undefined, true)], 101);

    expect(swapped.added).toEqual([]);
    expect(swapped.history).toHaveLength(1);
    expect(swapped.history[0]).toMatchObject({ roi: "0.2", worstCaseProfit: "90000" });
  });

  it("requires every provider leg to belong to a fresh catalog", () => {
    const tracker = new ProfitAlertTracker();
    expect(tracker.update([ranked("50000")], 101, new Set(["saba"])).history).toEqual([]);
    const fresh = tracker.update([ranked("50000")], 102, new Set(["saba", "bti"]));
    expect(fresh.added[0]?.identity).toContain("BTI|SABA");
  });

  it("keeps the newest 100 unique tickets and removes the oldest", () => {
    const tracker = new ProfitAlertTracker();
    for (let index = 0; index < 101; index += 1) {
      tracker.update([ranked(String(50_000 + index), "OBSERVATION", `ticket-${index}`, "0.06", `event-${index}`)], index);
    }

    const history = tracker.history();
    expect(history).toHaveLength(100);
    expect(history.some((item) => item.identity.startsWith("event-0::"))).toBe(false);
    expect(history.some((item) => item.identity.startsWith("event-100::"))).toBe(true);
  });

  it("persists, validates, sorts and caps browser history at 100 rows", () => {
    const tracker = new ProfitAlertTracker();
    for (let index = 0; index < 101; index += 1) {
      tracker.update([ranked("50000", "OBSERVATION", `ticket-${index}`, "0.06", `event-${index}`)], index);
    }
    const storage = memoryStorage();
    saveProfitAlerts(storage, tracker.history());

    const loaded = loadProfitAlerts(storage);
    expect(loaded).toHaveLength(100);
    expect(loaded[0]?.observedAtMs).toBe(100);
    expect(loadProfitAlerts(memoryStorage("not-json"))).toEqual([]);
  });
});
