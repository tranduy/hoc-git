import { describe, expect, it } from "vitest";
import { footballRefreshPolicy, type FootballCollectionPlan } from "@tool-chenh/contracts";
import { createFootballCollectionScheduler, collectionPlanExpression } from "./football-collection-scheduler.js";

const hour = 3_600_000;
const at = 1_800_000_000_000;
const plan = (revision = at, manualRequestId?: string): FootballCollectionPlan => ({ revision,
  events: [{ eventId: "near", startAtUtcMs: at + hour, isLive: false, urgent: true },
    { eventId: "far", startAtUtcMs: at + 30 * hour, isLive: false, urgent: false },
    { eventId: "passive", startAtUtcMs: at + 80 * hour, isLive: false, urgent: false }],
  ...(manualRequestId === undefined ? {} : { manualRequestId }) });

describe("football collection scheduling", () => {
  it("bounds remembered native timing and keeps recently observed owners", () => {
    const scheduler = createFootballCollectionScheduler(footballRefreshPolicy, () => at);
    for (let index = 0; index <= 10_000; index++) scheduler.policy(String(index), at + hour, false);
    expect(scheduler.policy("0").tier).toBe("UNKNOWN");
    expect(scheduler.policy("10000").tier).toBe("NEAR");
  });

  it("uses native timing consistently for receipt tiers and near-first ordering", () => {
    const scheduler = createFootballCollectionScheduler(footballRefreshPolicy, () => at);
    scheduler.setPlan({ revision: 1, events: [
      { eventId: "a-far", startAtUtcMs: at + 30 * hour, isLive: false, urgent: false },
      { eventId: "z-near", startAtUtcMs: at + hour, isLive: false, urgent: false }
    ] });
    expect(scheduler.due("a-far", null, at + 30 * hour, false)).toBe(true);
    expect(scheduler.due("z-near", null, at + hour, false)).toBe(true);
    expect(scheduler.sort(["a-far", "z-near"])).toEqual(["z-near", "a-far"]);
    scheduler.completed("a-far", at);
    expect(scheduler.due("a-far", at, at + 30 * hour, false)).toBe(false);
    expect(scheduler.policy("a-far").tier).toBe("24_72H");
  });
  it("does not spend detail capacity on an event omitted by the paired-fixture plan", () => {
    const scheduler = createFootballCollectionScheduler(footballRefreshPolicy, () => at);
    scheduler.setPlan(plan());

    expect(scheduler.due("unmatched", null, at + hour, false)).toBe(false);
    expect(scheduler.due("near", null)).toBe(true);
  });
  it("puts one uncollected 24-72 hour event into every four-item batch", () => {
    const scheduler = createFootballCollectionScheduler(footballRefreshPolicy, () => at);
    scheduler.setPlan({ revision: 1, events: [
      ...Array.from({ length: 8 }, (_, index) => ({ eventId: `near-${index}`,
        startAtUtcMs: at + hour, isLive: false, urgent: false })),
      { eventId: "far", startAtUtcMs: at + 30 * hour, isLive: false, urgent: false }
    ] });

    expect(scheduler.sort(["near-0", "near-1", "near-2", "near-3", "near-4", "far"])
      .slice(0, 4)).toContain("far");
  });
  it("retains native timing through unchanged plans and invalidates it on authoritative timing changes", () => {
    const scheduler = createFootballCollectionScheduler(footballRefreshPolicy, () => at);
    scheduler.setPlan(plan(1));
    scheduler.due("far", null, at + hour, false);
    scheduler.completed("far", at);
    scheduler.setPlan(plan(2));
    expect(scheduler.policy("far").tier).toBe("NEAR");
    expect(scheduler.due("far", at)).toBe(false);
    scheduler.setPlan({ ...plan(3), events: plan(3).events.map(event => event.eventId === "far"
      ? { ...event, startAtUtcMs: at + 8 * hour } : event) });
    expect(scheduler.policy("far").tier).toBe("6_13H");
    expect(scheduler.policy("far", at + hour, false).tier).toBe("NEAR");
  });
  it("reconciles unknown zero and negative kickoff markers while suppressing real past prematches", () => {
    const scheduler = createFootballCollectionScheduler(footballRefreshPolicy, () => at);
    expect(scheduler.due("zero", null, 0, false)).toBe(true);
    expect(scheduler.due("negative", null, -1, false)).toBe(true);
    expect(scheduler.due("past", null, at - 1, false)).toBe(false);
  });

  it("defers far detail, excludes passive work, and never renews receipt age on plan updates", () => {
    let now = at;
    const scheduler = createFootballCollectionScheduler(footballRefreshPolicy, () => now);
    scheduler.setPlan(plan());
    expect(scheduler.due("near", null)).toBe(true);
    expect(scheduler.due("far", null)).toBe(true);
    expect(scheduler.due("passive", null)).toBe(false);
    scheduler.completed("near", at);
    scheduler.completed("far", at);
    now += 11_000;
    scheduler.setPlan(plan(now));
    expect(scheduler.due("near", null)).toBe(true);
    expect(scheduler.due("far", null)).toBe(false);
    expect(scheduler.snapshot().completed).toBe(2);
  });
  it("coalesces manual jobs and respects source-native newer kickoff", () => {
    const scheduler = createFootballCollectionScheduler(footballRefreshPolicy, () => at);
    scheduler.setPlan(plan());
    scheduler.completed("far", at);
    scheduler.setPlan(plan(at + 1, "manual-1"));
    expect(scheduler.due("far", at)).toBe(true);
    scheduler.completed("far", at + 1);
    scheduler.setPlan(plan(at + 2, "manual-1"));
    expect(scheduler.due("far", at + 1)).toBe(false);
    expect(scheduler.due("passive", null, at + 2 * hour, false)).toBe(true);
    scheduler.setPlan(plan(at - 1, "old"));
    expect(scheduler.snapshot().revision).toBe(at + 2);
  });
  it("promotes work on tier transitions but does not relabel past prematches as live", () => {
    let now = at;
    const scheduler = createFootballCollectionScheduler(footballRefreshPolicy, () => now);
    scheduler.setPlan({ revision: at, events: [{ eventId: "x", startAtUtcMs: at + 13 * hour,
      isLive: false, urgent: false }] });
    scheduler.completed("x", at);
    now += 1;
    expect(scheduler.due("x", at)).toBe(true);
    expect(scheduler.due("gone", null, at - hour, false)).toBe(false);
  });
  it("installs a self-contained page helper and reuses its receipt state", () => {
    const root: Record<string, unknown> = {};
    const run = (value: FootballCollectionPlan) => new Function("document", collectionPlanExpression(value))({documentElement: root});
    run(plan());
    const first = root.__fieldlineCollectionSchedulerV1 as ReturnType<typeof createFootballCollectionScheduler>;
    first.completed("far", at);
    run(plan(at + 1));
    expect(root.__fieldlineCollectionSchedulerV1).toBe(first);
    expect(first.snapshot().completed).toBe(1);
  });
});
