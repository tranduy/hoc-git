import { describe, expect, it } from "vitest";
import { KsportRecoveryGenerationTracker } from "./ksport-recovery-generation.js";

function receipt(partition: "live" | "today", order: number, full: boolean): string {
  const subscription = partition === "live" ? "subSportBookLive" : "subSportBookToday";
  const path = partition === "live" ? "1_1/live" : "1_11/today";
  const providerBody = full
    ? [{ "1": `${partition} league`, "2": [{ "8": `${order}`, "2": "Home", "3": "Away", "7": {} }] }]
    : [{ "8": `${order}`, "7": {} }];
  const wrapper = JSON.stringify({ statusCode: "OK", statusCodeValue: 200,
    body: JSON.stringify(providerBody) });
  const stomp = `MESSAGE\ndestination:/topic/sports/${path}/ma/event/vi\n` +
    `subscription:${subscription}\nmessage-id:socket-${order}\n\n${wrapper}\u0000`;
  return `a${JSON.stringify([stomp])}`;
}

function subscribe(partition: "live" | "today"): string {
  const subscription = partition === "live" ? "subSportBookLive" : "subSportBookToday";
  const path = partition === "live" ? "1_1/live" : "1_11/today";
  const stomp = `SUBSCRIBE\nid:${subscription}\ndestination:/topic/sports/${path}/ma/event/vi\n\n\u0000`;
  return JSON.stringify([stomp]);
}

function rawSockJsFrame(payload: string): string {
  return (JSON.parse(payload.startsWith("a[") ? payload.slice(1) : payload) as string[])[0]!;
}

describe("KsportRecoveryGenerationTracker", () => {
  it("keeps one immutable generation across the initial live and today baseline", () => {
    const tracker = new KsportRecoveryGenerationTracker();

    expect(tracker.push(receipt("live", 100, true))).toEqual([
      { payload: receipt("live", 100, true), recoveryGeneration: 1 }
    ]);
    expect(tracker.push(receipt("today", 104, true))).toEqual([
      { payload: receipt("today", 104, true), recoveryGeneration: 1 }
    ]);
  });

  it("increments a same-stream baseline attempt without relabelling delayed old evidence", () => {
    const tracker = new KsportRecoveryGenerationTracker();
    tracker.push(receipt("live", 100, true));
    tracker.push(receipt("today", 104, true));

    expect(tracker.observeSent(subscribe("live"))).toBe(2);

    expect(tracker.push(receipt("live", 200, true))).toEqual([
      { payload: receipt("live", 200, true), recoveryGeneration: 2 }
    ]);
    expect(tracker.push(receipt("today", 103, true))).toEqual([
      { payload: receipt("today", 103, true), recoveryGeneration: 1 }
    ]);
    expect(tracker.observeSent(subscribe("today"))).toBe(2);
    expect(tracker.push(receipt("today", 204, true))).toEqual([
      { payload: receipt("today", 204, true), recoveryGeneration: 2 }
    ]);
    expect(tracker.push(receipt("live", 205, false))).toEqual([
      { payload: receipt("live", 205, false), recoveryGeneration: 2 }
    ]);
  });

  it("holds split receipts until their attempt is attributable and drops mixed-generation batches", () => {
    const tracker = new KsportRecoveryGenerationTracker();
    tracker.push(receipt("live", 100, true));
    tracker.push(receipt("today", 104, true));
    tracker.observeSent(subscribe("live"));
    tracker.push(receipt("live", 200, true));
    tracker.observeSent(subscribe("today"));
    const delayed = receipt("today", 103, true);
    const current = receipt("today", 204, true);
    const combined = `a${JSON.stringify([
      ...JSON.parse(delayed.slice(1)) as string[],
      ...JSON.parse(current.slice(1)) as string[]
    ])}`;

    expect(tracker.push(combined)).toEqual([]);

    const split = receipt("today", 204, true);
    const stomp = (JSON.parse(split.slice(1)) as string[])[0]!;
    const halfway = Math.floor(stomp.length / 2);
    const first = `a${JSON.stringify([stomp.slice(0, halfway)])}`;
    const second = `a${JSON.stringify([stomp.slice(halfway)])}`;
    expect(tracker.push(first)).toEqual([]);
    expect(tracker.push(second)).toEqual([
      { payload: first, recoveryGeneration: 2 },
      { payload: second, recoveryGeneration: 2 }
    ]);
  });

  it("fails closed when an unattributed transition buffer exceeds its fixed bound", () => {
    const tracker = new KsportRecoveryGenerationTracker({ maxPendingChars: 32, maxPendingFrames: 2 });

    expect(tracker.push(`a${JSON.stringify(["MESSAGE\nunterminated"])}`)).toEqual([]);
    expect(tracker.push(`a${JSON.stringify(["xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"])}`)).toEqual([]);
    expect(tracker.push(receipt("live", 100, true))).toEqual([]);
  });

  it("never invents a recovery attempt from a newer provider receipt", () => {
    const tracker = new KsportRecoveryGenerationTracker();
    tracker.push(receipt("live", 100, true));
    tracker.push(receipt("today", 104, true));

    expect(tracker.push(receipt("live", 200, true))).toEqual([
      { payload: receipt("live", 200, true), recoveryGeneration: 1 }
    ]);
    expect(tracker.currentGeneration).toBe(1);
  });

  it("keeps the same attempt fence when the provider uses raw STOMP transport", () => {
    const tracker = new KsportRecoveryGenerationTracker();
    tracker.push(rawSockJsFrame(receipt("live", 100, true)));
    tracker.push(rawSockJsFrame(receipt("today", 104, true)));

    expect(tracker.observeSent(rawSockJsFrame(subscribe("live")))).toBe(2);
    expect(tracker.push(rawSockJsFrame(receipt("live", 200, true)))[0]?.recoveryGeneration).toBe(2);
    expect(tracker.push(rawSockJsFrame(receipt("today", 103, true)))[0]?.recoveryGeneration).toBe(1);
  });

  it("does not forget a completed old receipt before a trailing current fragment", () => {
    const tracker = new KsportRecoveryGenerationTracker();
    tracker.push(receipt("live", 100, true));
    tracker.push(receipt("today", 104, true));
    tracker.observeSent(subscribe("live"));
    tracker.push(receipt("live", 200, true));
    tracker.observeSent(subscribe("today"));

    const delayed = rawSockJsFrame(receipt("today", 103, true));
    const current = rawSockJsFrame(receipt("today", 204, true));
    const halfway = Math.floor(current.length / 2);
    expect(tracker.push(`a${JSON.stringify([delayed, current.slice(0, halfway)])}`)).toEqual([]);
    expect(tracker.push(`a${JSON.stringify([current.slice(halfway)])}`)).toEqual([]);
    expect(tracker.push(receipt("today", 204, true))).toEqual([
      { payload: receipt("today", 204, true), recoveryGeneration: 2 }
    ]);
  });

  it("fails closed when an old partial receipt crosses an explicit attempt boundary", () => {
    const tracker = new KsportRecoveryGenerationTracker();
    tracker.push(receipt("live", 100, true));
    tracker.push(receipt("today", 104, true));
    const delayed = rawSockJsFrame(receipt("live", 150, true));
    const halfway = Math.floor(delayed.length / 2);

    expect(tracker.push(`a${JSON.stringify([delayed.slice(0, halfway)])}`)).toEqual([]);
    expect(tracker.observeSent(subscribe("live"))).toBeNull();
    expect(tracker.push(`a${JSON.stringify([delayed.slice(halfway)])}`)).toEqual([]);
    expect(tracker.push(receipt("live", 200, true))).toEqual([]);
  });

  it("fails closed instead of coalescing an overlapping retry into the prior attempt", () => {
    const tracker = new KsportRecoveryGenerationTracker();
    tracker.push(receipt("live", 100, true));
    tracker.push(receipt("today", 104, true));
    expect(tracker.observeSent(subscribe("live"))).toBe(2);
    tracker.push(receipt("live", 200, true));

    expect(tracker.observeSent(subscribe("live"))).toBeNull();
    expect(tracker.failed).toBe(true);
    expect(tracker.observeSent(subscribe("today"))).toBeNull();
    expect(tracker.push(receipt("today", 204, true))).toEqual([]);
  });

  it("forwards a SockJS STOMP heartbeat without poisoning the next baseline receipt", () => {
    const tracker = new KsportRecoveryGenerationTracker();
    const heartbeat = `a${JSON.stringify(["\n"])}`;

    expect(tracker.push(heartbeat)).toEqual([{ payload: heartbeat, recoveryGeneration: 1 }]);
    tracker.push(receipt("live", 100, true));
    tracker.push(receipt("today", 104, true));
    expect(tracker.observeSent(subscribe("live"))).toBe(2);
  });

  it("ignores SockJS heartbeats between complete receipts in one transport batch", () => {
    const tracker = new KsportRecoveryGenerationTracker();
    const live = rawSockJsFrame(receipt("live", 100, true));
    const today = rawSockJsFrame(receipt("today", 104, true));
    const payload = `a${JSON.stringify([live, "\n", today])}`;

    expect(tracker.push(payload)).toEqual([{ payload, recoveryGeneration: 1 }]);
    expect(tracker.currentBaselineState.complete).toBe(true);
  });

  it("ignores SockJS heartbeats between outbound subscriptions in one attempt", () => {
    const tracker = new KsportRecoveryGenerationTracker();
    tracker.push(receipt("live", 100, true));
    tracker.push(receipt("today", 104, true));
    const live = rawSockJsFrame(subscribe("live"));
    const today = rawSockJsFrame(subscribe("today"));

    expect(tracker.observeSent(JSON.stringify([live, "\n", today]))).toBe(2);
    expect(tracker.push(receipt("live", 200, true))[0]?.recoveryGeneration).toBe(2);
    expect(tracker.push(receipt("today", 204, true))[0]?.recoveryGeneration).toBe(2);
    expect(tracker.currentBaselineState.complete).toBe(true);
  });

  it("fails closed when an inbound SockJS envelope is malformed or incomplete", () => {
    const tracker = new KsportRecoveryGenerationTracker();

    expect(tracker.push('a["MESSAGE\\ndestination:/topic/sports/1_1/live/ma/event/vi')).toEqual([]);
    expect(tracker.failed).toBe(true);
    expect(tracker.push(receipt("live", 100, true))).toEqual([]);
  });

  it("fails closed when an outbound SockJS envelope is malformed or incomplete", () => {
    const tracker = new KsportRecoveryGenerationTracker();

    expect(tracker.observeSent('["SUBSCRIBE\\nid:subSportBookLive')).toBeNull();
    expect(tracker.failed).toBe(true);
    expect(tracker.observeSent(subscribe("live"))).toBeNull();
  });
});
