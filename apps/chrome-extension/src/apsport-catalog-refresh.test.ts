import { describe, expect, it, vi } from "vitest";
import { apsportSelectionPriceFromEvent, collectApsportCatalog, collectApsportEventDetail, eligibleApsportFootballEvent,
  type ApsportCatalogPageRequest, type ApsportRawEvent } from "./apsport-catalog-refresh.js";

const NOW = Date.parse("2026-08-28T00:00:00.000Z");

function event(id: string, options: {
  readonly live?: boolean;
  readonly startAt?: string | null;
  readonly league?: string;
  readonly home?: string;
  readonly away?: string;
} = {}): ApsportRawEvent {
  return {
    "1": `league-${id}`,
    "2": id,
    "5": options.home ?? `Home ${id}`,
    "6": options.live ?? false,
    "10": "Active",
    "11": options.startAt === undefined ? "2026-08-28T01:00:00.000Z" : options.startAt,
    "22": options.away ?? `Away ${id}`,
    "50": [],
    "53": options.league ?? "Premier League"
  };
}

function league(name: string, events: readonly ApsportRawEvent[]) {
  return { "5": name, "15": events };
}

describe("eligibleApsportFootballEvent", () => {
  it("keeps every active live event and applies an inclusive 24-hour cutoff only to prematch", () => {
    expect(eligibleApsportFootballEvent(event("live-old", {
      live: true, startAt: "2020-01-01T00:00:00.000Z"
    }), NOW, 24)).toBe(true);
    expect(eligibleApsportFootballEvent(event("at-boundary", {
      startAt: "2026-08-29T00:00:00.000Z"
    }), NOW, 24)).toBe(true);
    expect(eligibleApsportFootballEvent(event("outside", {
      startAt: "2026-08-29T00:00:00.001Z"
    }), NOW, 24)).toBe(false);
    expect(eligibleApsportFootballEvent(event("missing", { startAt: null }), NOW, 24)).toBe(false);
    expect(eligibleApsportFootballEvent(event("invalid", { startAt: "not-a-date" }), NOW, 24)).toBe(false);
  });

  it("rejects inactive and virtual football identities before detail collection", () => {
    expect(eligibleApsportFootballEvent({ ...event("inactive"), "10": "Suspended" }, NOW, 24)).toBe(false);
    expect(eligibleApsportFootballEvent(event("virtual", {
      league: "Virtual E-Soccer League", home: "Alpha (V)", away: "Beta (V)"
    }), NOW, 24)).toBe(false);
    expect(eligibleApsportFootballEvent(event("virtual-vi", {
      league: "Bóng đá ảo điện tử", home: "Alpha", away: "Beta"
    }), NOW, 24)).toBe(false);
  });

  it("keeps a status-sparse provider event when its market groups prove it is active", () => {
    const statusSparse = { ...event("status-sparse"), "10": undefined,
      "50": [{ "3": 3, "9": [{ "6": "market-1" }], "10": "Active" }] };

    expect(eligibleApsportFootballEvent(statusSparse, NOW, 24)).toBe(true);
    expect(eligibleApsportFootballEvent({ ...statusSparse,
      "50": [{ "3": 3, "9": [{ "6": "market-1" }], "10": "Suspended" }] }, NOW, 24)).toBe(false);
  });
});

describe("collectApsportCatalog", () => {
  it("resolves an exact hidden APSPORT selection directly from event detail", () => {
    const detailed = { ...event("hidden-live", { live: true }), "50": [{ "3": 80, "10": "Active", "9": [{
      "0": "hidden-over", "2": "hidden-under", "6": "hidden-market", "7": "1.5",
      "8": { "2": "-0.45" }, "9": { "2": "0.35" }
    }] }] };

    expect(apsportSelectionPriceFromEvent(detailed, {
      providerEventId: "hidden-live", providerMarketId: "hidden-market",
      providerSelectionId: "hidden-under", marketType: "SH_TOTAL", scope: "SECOND_HALF",
      selection: "UNDER", line: "1.5"
    })).toEqual({ status: "FOUND", rawOdds: "0.35" });
    expect(apsportSelectionPriceFromEvent(detailed, {
      providerEventId: "hidden-live", providerMarketId: "hidden-market",
      providerSelectionId: "closed-selection", marketType: "SH_TOTAL", scope: "SECOND_HALF",
      selection: "UNDER", line: "1.5"
    })).toEqual({ status: "NOT_FOUND" });
  });

  it("refetches one exact event detail after a realtime event signal", async () => {
    const requests: ApsportCatalogPageRequest[] = [];
    const detailed = event("live-42", { live: true });

    const result = await collectApsportEventDetail({
      eventId: "live-42",
      template: { origin: "https://pacific.agenate.com", headers: { lng: "vi" }, body: {} },
      request: async (input) => {
        requests.push(input);
        return { status: 200, data: [league("Live", [detailed])] };
      },
      sleep: async () => undefined,
      isCurrent: () => true
    });

    expect(requests).toEqual([expect.objectContaining({
      kind: "DETAIL",
      eventId: "live-42",
      url: "https://pacific.agenate.com/be-ui/pac/api/v3/events/live-42"
    })]);
    expect(result).toEqual(expect.objectContaining({ "2": "live-42" }));
  });

  it("uses the provider's distinct native bodies for event and lazy-league rosters", async () => {
    const requests: ApsportCatalogPageRequest[] = [];
    await collectApsportCatalog({
      generation: "apsport-native-bodies",
      nowMs: NOW,
      prematchWindowHours: 24,
      template: { origin: "https://pacific.agenate.com", headers: {}, body: { stale: true } },
      request: async (input) => {
        requests.push(input);
        return { status: 200, data: [] };
      },
      sleep: async () => undefined,
      isCurrent: () => true,
      onRoster: async () => undefined,
      onDetail: async () => undefined
    });

    expect(requests.find((request) => request.kind === "EVENTS" && request.mode === 2)?.body).toEqual({
      mno: "2", si: "1", mg: "1", do: "1", so: "0",
      il: false, ls: false, st: false, lmt: false, co: false
    });
    expect(requests.find((request) => request.kind === "OTHER_LEAGUES" && request.mode === 2)?.body).toEqual({
      mno: "2", si: "1", mg: "1", so: "0"
    });
    expect(requests.find((request) => request.kind === "EVENTS" && request.mode === 3)?.body)
      .toEqual(expect.objectContaining({ mno: "3", do: "0" }));
  });

  it("uses lazy-league cursor field 17 and requests detail only for live plus next-24h events", async () => {
    const requests: ApsportCatalogPageRequest[] = [];
    const detailIds: string[] = [];
    const rosterBatches: unknown[] = [];
    const detailBatches: Array<{ readonly complete: boolean; readonly records: readonly ApsportRawEvent[] }> = [];
    const eligible = [
      event("live", { live: true, startAt: null }),
      event("soon", { startAt: "2026-08-28T23:59:59.000Z" })
    ];
    const outside = event("outside", { startAt: "2026-08-29T00:00:00.001Z" });
    const request = vi.fn(async (input: ApsportCatalogPageRequest) => {
      requests.push(input);
      if (input.kind === "EVENTS") return { status: 200, data: [league("Top", [eligible[0]!, outside])] };
      if (input.kind === "OTHER_LEAGUES") return { status: 200,
        data: [{ "4": "lazy-league", "5": "Lazy", "7": 999, "17": 42 }] };
      if (input.kind === "LEAGUE_TOPS") return { status: 200, data: [league("Lazy", [eligible[1]!])] };
      if (input.kind !== "DETAIL") throw new Error("UNEXPECTED_ROSTER_REQUEST");
      detailIds.push(input.eventId);
      return { status: 200, data: [league("Detail", [{ ...eligible.find((item) => item["2"] === input.eventId)!,
        "53": "Detail" }])] };
    });

    await collectApsportCatalog({
      generation: "apsport-refresh-1",
      nowMs: NOW,
      prematchWindowHours: 24,
      template: { origin: "https://pacific.agenate.com", headers: { "x-client": "opaque" }, body: { si: 1 } },
      request,
      sleep: async () => undefined,
      isCurrent: () => true,
      onRoster: async (batch) => { rosterBatches.push(batch); },
      onDetail: async (batch) => { detailBatches.push(batch); },
      detailBatchSize: 10
    });

    expect(detailIds.sort()).toEqual(["live", "soon"]);
    expect(requests.filter((item): item is Extract<ApsportCatalogPageRequest, { readonly kind: "DETAIL" }> =>
      item.kind === "DETAIL").map((item) => item.eventId).sort())
      .toEqual(["live", "soon"]);
    const lazyBodies = requests.filter((item) => item.kind === "LEAGUE_TOPS").map((item) => item.body);
    expect(lazyBodies).toContainEqual(expect.objectContaining({
      lis: [{ li: "lazy-league", in: "42" }]
    }));
    expect(JSON.stringify(lazyBodies)).not.toContain('"in":"999"');
    expect(rosterBatches).toHaveLength(1);
    expect(detailBatches).toEqual([expect.objectContaining({
      complete: true,
      records: [expect.objectContaining({ "2": "live" }), expect.objectContaining({ "2": "soon" })]
    })]);
  });

  it("retries a rate-limited detail with bounded Retry-After and keeps the queue single-flight", async () => {
    const sleeps: number[] = [];
    let active = 0;
    let maximumActive = 0;
    let attempts = 0;
    const request = vi.fn(async (input: ApsportCatalogPageRequest) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      try {
        if (input.kind === "EVENTS") return { status: 200, data: [league("Top", [event("1", { live: true })])] };
        if (input.kind === "OTHER_LEAGUES" || input.kind === "LEAGUE_TOPS") return { status: 200, data: [] };
        attempts += 1;
        if (attempts === 1) return { status: 429, data: null, retryAfterMs: 1_500 };
        return { status: 200, data: [league("Detail", [event("1", { live: true })])] };
      } finally {
        active -= 1;
      }
    });

    await collectApsportCatalog({
      generation: "apsport-refresh-2", nowMs: NOW, prematchWindowHours: 24,
      template: { origin: "https://pacific.agenate.com", headers: {}, body: {} }, request,
      sleep: async (delayMs) => { sleeps.push(delayMs); }, isCurrent: () => true,
      onRoster: async () => undefined, onDetail: async () => undefined
    });

    expect(attempts).toBe(2);
    expect(sleeps).toEqual([1_500]);
    expect(maximumActive).toBe(1);
  });

  it("stops a superseded generation before requesting another event detail", async () => {
    let current = true;
    const detailIds: string[] = [];
    const completed: boolean[] = [];
    const request = vi.fn(async (input: ApsportCatalogPageRequest) => {
      if (input.kind === "EVENTS") return { status: 200,
        data: [league("Top", [event("1", { live: true }), event("2", { live: true })])] };
      if (input.kind === "OTHER_LEAGUES" || input.kind === "LEAGUE_TOPS") return { status: 200, data: [] };
      if (input.kind !== "DETAIL") throw new Error("UNEXPECTED_ROSTER_REQUEST");
      detailIds.push(input.eventId);
      current = false;
      return { status: 200, data: [league("Detail", [event(input.eventId, { live: true })])] };
    });

    await collectApsportCatalog({
      generation: "apsport-refresh-old", nowMs: NOW, prematchWindowHours: 24,
      template: { origin: "https://pacific.agenate.com", headers: {}, body: {} }, request,
      sleep: async () => undefined, isCurrent: () => current,
      onRoster: async () => undefined,
      onDetail: async (batch) => { completed.push(batch.complete); }
    });

    expect(detailIds).toEqual(["1"]);
    expect(completed).toEqual([]);
  });
});
