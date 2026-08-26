import { describe, expect, it } from "vitest";
import { KsportRecoveryGenerationTracker } from "./ksport-recovery-generation.js";

function receipt(partition: "live" | "today", order: number, full: boolean): string {
  const subscription = partition === "live" ? "subSportBookLive" : "subSportBookToday";
  const path = partition === "live" ? "1_1/live" : "1_11/today";
  const providerBody = full
    ? [{ "1": `${partition} league`, "2": [{ "8": `${order}`, "2": "Home", "3": "Away",
      "7": { "3": [`2.5 0.91*${order}h -0.99*${order}a ${order}0001`] } }] }]
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

function unrelatedReceipt(): string {
  const wrapper = JSON.stringify({ statusCode: "OK", statusCodeValue: 200, body: "{}" });
  const stomp = `MESSAGE\ndestination:/topic/jackpot/current\nsubscription:jackpot\n` +
    `message-id:socket-77\n\n${wrapper}\u0000`;
  return `a${JSON.stringify([stomp])}`;
}

function receiptWithProviderBody(partition: "live" | "today", order: number,
  providerBody: unknown): string {
  const subscription = partition === "live" ? "subSportBookLive" : "subSportBookToday";
  const path = partition === "live" ? "1_1/live" : "1_11/today";
  const wrapper = JSON.stringify({ statusCode: "OK", statusCodeValue: 200,
    body: JSON.stringify(providerBody) });
  const stomp = `MESSAGE\ndestination:/topic/sports/${path}/ma/event/vi\n` +
    `subscription:${subscription}\nmessage-id:socket-${order}\n\n${wrapper}\u0000`;
  return `a${JSON.stringify([stomp])}`;
}

function receiptWithMarketRow(partition: "live" | "today", order: number, marketRow: string): string {
  return receiptWithProviderBody(partition, order, [{ "1": `${partition} league`,
    "2": [{ "8": `${order}`, "2": "Home", "3": "Away", "7": { "3": [marketRow] } }] }]);
}

function deltaReceiptWithMarket(partition: "live" | "today", order: number,
  eventId: string, marketId: string): string {
  return receiptWithProviderBody(partition, order, {
    "8": eventId, "2": "Home", "3": "Away",
    "7": { "3": [`2.5 0.91*${marketId}h -0.99*${marketId}a ${marketId}`] }
  });
}

describe("KsportRecoveryGenerationTracker", () => {
  it("does not mark a nonempty partition full when its only market has an unsupported line", () => {
    const tracker = new KsportRecoveryGenerationTracker();
    const payload = receiptWithMarketRow("live", 100, "garbage 0.91*100h -0.99*100a 1000001");

    expect(tracker.push(payload)).toEqual([{ payload, recoveryGeneration: 1 }]);
    expect(tracker.currentBaselineState).toEqual({ live: false, today: false, complete: false });
  });

  it("does not mark a nonempty partition full when either market price is zero", () => {
    const tracker = new KsportRecoveryGenerationTracker();
    const payload = receiptWithMarketRow("live", 100, "2.5 0*100h -0.99*100a 1000001");

    expect(tracker.push(payload)).toEqual([{ payload, recoveryGeneration: 1 }]);
    expect(tracker.currentBaselineState).toEqual({ live: false, today: false, complete: false });
  });

  it("keeps explicit empty live and today partitions eligible for a complete baseline", () => {
    const tracker = new KsportRecoveryGenerationTracker();
    const live = receiptWithProviderBody("live", 100, [{ "1": "live league", "2": [] }]);
    const today = receiptWithProviderBody("today", 104, [{ "1": "today league", "2": [] }]);

    expect(tracker.push(live)).toEqual([{ payload: live, recoveryGeneration: 1 }]);
    expect(tracker.currentBaselineState).toEqual({ live: true, today: false, complete: false });
    expect(tracker.push(today)).toEqual([{ payload: today, recoveryGeneration: 1 }]);
    expect(tracker.currentBaselineState).toEqual({ live: true, today: true, complete: true });
  });

  it("does not mark a nonempty event shell with no decodable market as a full partition", () => {
    const tracker = new KsportRecoveryGenerationTracker();
    const providerBody = [{ "1": "live league",
      "2": [{ "8": "100", "2": "Home", "3": "Away", "7": {} }] }];
    const wrapper = JSON.stringify({ statusCode: "OK", statusCodeValue: 200,
      body: JSON.stringify(providerBody) });
    const stomp = "MESSAGE\ndestination:/topic/sports/1_1/live/ma/event/vi\n" +
      `subscription:subSportBookLive\nmessage-id:socket-100\n\n${wrapper}\u0000`;
    const malformed = `a${JSON.stringify([stomp])}`;

    expect(tracker.push(malformed)).toEqual([
      { payload: malformed, recoveryGeneration: 1 }
    ]);
    expect(tracker.currentBaselineState).toEqual({ live: false, today: false, complete: false });
  });

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

  it("never coalesces an overlapping retry into the prior attempt", () => {
    const tracker = new KsportRecoveryGenerationTracker();
    tracker.push(receipt("live", 100, true));
    tracker.push(receipt("today", 104, true));
    expect(tracker.observeSent(subscribe("live"))).toBe(2);
    tracker.push(receipt("live", 200, true));

    // The retry gets an ordinal of its own so the retired attempt's frames stay
    // separable. Reusing generation 2 would mix them; failing outright kills the
    // decoder for the life of the socket, which is what left SBOBET dark.
    const retry = tracker.observeSent(subscribe("live"));
    expect(retry).toBe(3);
    expect(tracker.failed).toBe(false);
  });

  it("suppresses SockJS transport noise without poisoning the next baseline receipt", () => {
    const tracker = new KsportRecoveryGenerationTracker();
    const heartbeat = `a${JSON.stringify(["\n"])}`;

    expect(tracker.push("o")).toEqual([]);
    expect(tracker.push(heartbeat)).toEqual([]);
    expect(tracker.push(unrelatedReceipt())).toEqual([]);
    tracker.push(receipt("live", 100, true));
    tracker.push(receipt("today", 104, true));
    expect(tracker.observeSent(subscribe("live"))).toBe(2);
  });

  it("advances catalog evidence only after a complete attributable receipt", () => {
    const tracker = new KsportRecoveryGenerationTracker();
    const complete = receipt("live", 100, true);
    const stomp = rawSockJsFrame(complete);
    const halfway = Math.floor(stomp.length / 2);

    expect(tracker.catalogEvidenceVersion).toBe(0);
    expect(tracker.push(`a${JSON.stringify([stomp.slice(0, halfway)])}`)).toEqual([]);
    expect(tracker.catalogEvidenceVersion).toBe(0);
    expect(tracker.push(`a${JSON.stringify([stomp.slice(halfway)])}`)).toHaveLength(2);
    expect(tracker.catalogEvidenceVersion).toBe(1);
  });

  it("advances catalog authority only when both full partitions complete one generation", () => {
    const tracker = new KsportRecoveryGenerationTracker();

    expect(tracker.catalogAuthorityGeneration).toBe(0);
    tracker.push(receipt("live", 100, true));
    expect(tracker.catalogAuthorityGeneration).toBe(0);
    tracker.push(deltaReceiptWithMarket("live", 101, "700", "7000001"));
    expect(tracker.catalogAuthorityGeneration).toBe(0);
    tracker.push(receipt("today", 104, true));
    expect(tracker.catalogAuthorityGeneration).toBe(1);
  });

  it("does not advance catalog evidence for heartbeat, noise, duplicate, out-of-order, or zero-decodable receipts",
    () => {
      const tracker = new KsportRecoveryGenerationTracker();
      const baseline = receipt("live", 100, true);
      tracker.push(baseline);
      expect(tracker.catalogEvidenceVersion).toBe(1);

      tracker.push(`a${JSON.stringify(["\n"])}`);
      tracker.push(unrelatedReceipt());
      tracker.push(baseline);
      tracker.push(receipt("live", 99, true));
      tracker.push(receipt("live", 101, false));
      expect(tracker.catalogEvidenceVersion).toBe(1);

      tracker.push(receiptWithProviderBody("live", 102, {
        "8": "102", "2": "Home", "3": "Away",
        "7": { "3": ["2.5 0.91*102h -0.99*102a 1020001"] }
      }));
      expect(tracker.catalogEvidenceVersion).toBe(2);
    });

  it("does not advance catalog evidence for a full receipt on an already committed generation", () => {
    const tracker = new KsportRecoveryGenerationTracker();
    tracker.push(receipt("live", 100, true));
    tracker.push(receipt("today", 104, true));
    expect(tracker.catalogEvidenceVersion).toBe(2);

    tracker.push(receipt("live", 200, true));
    expect(tracker.catalogEvidenceVersion).toBe(2);

    expect(tracker.observeSent(subscribe("live"))).toBe(2);
    tracker.push(receipt("live", 201, true));
    expect(tracker.catalogEvidenceVersion).toBe(3);
  });

  it("advances the first full partition below a higher pending delta without advancing its duplicate", () => {
    const tracker = new KsportRecoveryGenerationTracker();
    tracker.push(deltaReceiptWithMarket("live", 200, "700", "7000001"));
    expect(tracker.catalogEvidenceVersion).toBe(1);

    const lowerFull = receiptWithProviderBody("live", 100, [{ "1": "live league", "2": [{
      "8": "700", "2": "Home", "3": "Away",
      "7": { "3": ["2.5 0.91*7000001h -0.99*7000001a 7000001"] }
    }] }]);
    tracker.push(lowerFull);
    expect(tracker.catalogEvidenceVersion).toBe(2);

    tracker.push(lowerFull);
    expect(tracker.catalogEvidenceVersion).toBe(2);
  });

  it("orders pending delta evidence per market instead of across its whole partition", () => {
    const tracker = new KsportRecoveryGenerationTracker();
    tracker.push(deltaReceiptWithMarket("live", 200, "700", "7000001"));
    expect(tracker.catalogEvidenceVersion).toBe(1);

    tracker.push(deltaReceiptWithMarket("live", 150, "700", "7000002"));
    expect(tracker.catalogEvidenceVersion).toBe(2);

    tracker.push(deltaReceiptWithMarket("live", 175, "700", "7000001"));
    expect(tracker.catalogEvidenceVersion).toBe(2);
  });

  it("retains the highest reapplied pending market order as the committed partition fence", () => {
    const tracker = new KsportRecoveryGenerationTracker();
    tracker.push(deltaReceiptWithMarket("live", 200, "700", "7000001"));
    tracker.push(receipt("live", 100, true));
    tracker.push(receipt("today", 104, true));
    expect(tracker.catalogEvidenceVersion).toBe(3);

    tracker.push(deltaReceiptWithMarket("live", 150, "700", "7000002"));
    expect(tracker.catalogEvidenceVersion).toBe(3);
  });

  it("fails closed before pending catalog evidence exceeds the API event bound", () => {
    const tracker = new KsportRecoveryGenerationTracker();
    for (let index = 0; index < 256; index += 1) {
      const eventId = String(1_000 + index);
      expect(tracker.push(deltaReceiptWithMarket("live", index + 1, eventId, `${eventId}0001`)))
        .toHaveLength(1);
    }
    expect(tracker.failed).toBe(false);

    expect(tracker.push(deltaReceiptWithMarket("live", 257, "1256", "12560001"))).toEqual([]);
    expect(tracker.failed).toBe(true);
    expect(tracker.catalogEvidenceVersion).toBe(256);
  });

  it("fails closed before one pending event exceeds the API market bound", () => {
    const tracker = new KsportRecoveryGenerationTracker();
    for (let index = 0; index < 2_048; index += 1) {
      const marketId = String(7_000_000 + index);
      expect(tracker.push(deltaReceiptWithMarket("live", index + 1, "700", marketId))).toHaveLength(1);
    }
    expect(tracker.failed).toBe(false);

    expect(tracker.push(deltaReceiptWithMarket("live", 2_049, "700", "7002048"))).toEqual([]);
    expect(tracker.failed).toBe(true);
    expect(tracker.catalogEvidenceVersion).toBe(2_048);
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

describe("a repeated subscription must not kill the decoder", () => {
  it("retires the overlapping attempt into a new generation and keeps decoding", () => {
    // Measured 2026-08-26 on the live KSPORT socket: the page re-subscribed to a
    // partition before the previous attempt completed, the tracker failed with
    // ATTEMPT_UNAVAILABLE, and every later frame was dropped by the failed
    // latch. 30 SockJS frames produced 1 STOMP fragment and no catalog at all.
    const tracker = new KsportRecoveryGenerationTracker();

    const first = tracker.observeSent(subscribe("live"));
    expect(first).not.toBeNull();

    const second = tracker.observeSent(subscribe("live"));

    expect(tracker.failed).toBe(false);
    expect(second).not.toBeNull();
    expect(second).toBeGreaterThan(first!);
    // The decoder must still be alive for the frames that follow the retry.
    tracker.push(receipt("live", 100, true));
    expect(tracker.failed).toBe(false);
  });
});
