import { describe, expect, it, vi } from "vitest";
import { apsportSelectionPriceFromEvent, buildApsportPageRequestExpression, collectApsportCatalog,
  collectApsportEventDetail, eligibleApsportFootballEvent,
  type ApsportCatalogPageRequest, type ApsportRawEvent } from "./apsport-catalog-refresh.js";

const NOW = Date.parse("2026-08-28T00:00:00.000Z");

describe("buildApsportPageRequestExpression", () => {
  it("aborts a provider fetch inside the page instead of leaving it spinning after CDP times out", () => {
    const expression = buildApsportPageRequestExpression({
      origin: "https://pacific.agenate.com", headers: { lng: "vi" }, body: { si: 1 }
    }, {
      kind: "EVENTS", mode: 2, url: "https://pacific.agenate.com/be-ui/pac/api/v3/events",
      body: { mno: "2" }
    });

    expect(expression).toContain("new AbortController()");
    expect(expression).toContain("signal: controller.signal");
    expect(expression).toContain("controller.abort()");
  });
});

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
  it("keeps every active live event and every future prematch event without a time horizon", () => {
    expect(eligibleApsportFootballEvent(event("live-old", {
      live: true, startAt: "2020-01-01T00:00:00.000Z"
    }), NOW, 24)).toBe(true);
    expect(eligibleApsportFootballEvent(event("at-boundary", {
      startAt: "2026-08-29T00:00:00.000Z"
    }), NOW, 24)).toBe(true);
    expect(eligibleApsportFootballEvent(event("outside", {
      startAt: "2026-09-28T00:00:00.000Z"
    }), NOW, 24)).toBe(true);
    expect(eligibleApsportFootballEvent(event("past", {
      startAt: "2026-08-27T23:59:59.999Z"
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

  it("keeps empty-market Major League Soccer events without admitting eSoccer leagues", () => {
    expect(eligibleApsportFootballEvent(event("mls-empty", {
      league: "USA Major League Soccer", home: "Austin FC", away: "LA Galaxy"
    }), NOW, 24)).toBe(true);
    for (const leagueName of ["eSoccer Battle", "e-Soccer Battle", "e Soccer Battle"]) {
      expect(eligibleApsportFootballEvent(event(`virtual-${leagueName}`, {
        league: leagueName, home: "Alpha", away: "Beta"
      }), NOW, 24)).toBe(false);
    }
  });

  it("keeps a status-sparse provider event when its market groups prove it is active", () => {
    const statusSparse = { ...event("status-sparse"), "10": undefined,
      "50": [{ "3": 3, "9": [{ "6": "market-1" }], "10": "Active" }] };

    expect(eligibleApsportFootballEvent(statusSparse, NOW, 24)).toBe(true);
    expect(eligibleApsportFootballEvent({ ...statusSparse,
      "50": [{ "3": 3, "9": [{ "6": "market-1" }], "10": "Suspended" }] }, NOW, 24)).toBe(false);
  });

  it("does not discard a status-sparse event merely because its active native group is not mapped yet", () => {
    const statusSparse = { ...event("unknown-active"), "10": undefined,
      "50": [{ "3": 999, "9": [{ "6": "native-market" }], "10": "Active" }] };

    expect(eligibleApsportFootballEvent(statusSparse, NOW, 24)).toBe(true);
  });
});

describe("collectApsportCatalog", () => {
  // Native event/offer from .run/apsport-live-evidence-frames.json, captured
  // 2026-08-27. Keep the provider's offer ID intact beneath the catalog namespace.
  const nativeTotal = { "2": 5682368, "6": true, "10": "Active", "50": [{
    "2": 5682368, "3": 3, "6": false, "10": "Active", "9": [{
      "0": "56823680030000005h", "2": "56823680030000005a",
      "6": "1985150448351005", "7": "0.5",
      "8": { "0": "2.6159375", "2": "-0.62" },
      "9": { "0": "1.35553125", "2": "0.36" }
    }]
  }] };
  const normalizedTotalIdentity = { providerEventId: "5682368",
    providerMarketId: "tsport:3:1985150448351005", providerSelectionId: "56823680030000005a",
    marketType: "FT_TOTAL", scope: "FULL_TIME", selection: "UNDER", line: "0.5" };

  it("resolves a normalized AP market ID using both its native group and intact offer ID", () => {
    expect(apsportSelectionPriceFromEvent(nativeTotal, normalizedTotalIdentity))
      .toEqual({ status: "FOUND", rawOdds: "0.36" });
    expect(nativeTotal["50"][0]!["9"][0]!["6"]).toBe("1985150448351005");
  });

  it.each([
    { providerMarketId: "tsport:4:1985150448351005" },
    { providerMarketId: "tsport:3:1985150448351006" },
    { providerMarketId: "unrelated:3:1985150448351005" },
    { providerMarketId: "tsport:3:extra:1985150448351005" },
    { providerEventId: "5682369" },
    { providerSelectionId: "56823680030000005h" },
    { marketType: "FH_TOTAL" },
    { scope: "FIRST_HALF" },
    { selection: "OVER" },
    { line: "0.75" },
    { line: null }
  ])("refuses a normalized AP price when an exact ticket anchor differs: %j", changed => {
    expect(apsportSelectionPriceFromEvent(nativeTotal, { ...normalizedTotalIdentity, ...changed }))
      .toEqual({ status: "NOT_FOUND" });
  });

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

  it("reads exact AP binary props whose source publishes decimal odds without a Malay slot", () => {
    const detailed = { ...event("binary-prop"), "50": [{ "3": 8, "10": "Active", "9": [{
      "0": "binary-odd", "2": "binary-even", "6": "binary-market", "7": "0.0",
      "8": { "0": "1.9091743119", "1": "1.91" }, "9": { "0": "1.7660550458", "1": "1.77" }
    }] }] };

    expect(apsportSelectionPriceFromEvent(detailed, {
      providerEventId: "binary-prop", providerMarketId: "binary-market",
      providerSelectionId: "binary-even", marketType: "FT_ODD_EVEN", scope: "FULL_TIME",
      selection: "EVEN", line: null
    })).toEqual({ status: "FOUND", rawOdds: "1.7660550458" });
  });

  it("refetches one exact event detail after a realtime event signal", async () => {
    const requests: ApsportCatalogPageRequest[] = [];
    const detailed = event("live-42", { live: true });

    const result = await collectApsportEventDetail({
      eventId: "live-42",
      leagueId: "league-42",
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
      url: "https://pacific.agenate.com/be-ui/pac/api/v3/events/live-42",
      body: expect.objectContaining({ li: "league-42" })
    })]);
    expect(result).toEqual(expect.objectContaining({ "2": "live-42" }));
  });

  it("rejects structurally incomplete detail and non-object raw market rows", async () => {
    const malformedDetails: ApsportRawEvent[] = [
      { ...event("missing-home"), "5": "" },
      { ...event("same-teams"), "22": "Home same-teams" },
      { ...event("missing-league"), "53": "" },
      { ...event("missing-start"), "11": null },
      { ...event("missing-group-id"), "50": [{ "9": [] }] },
      { ...event("malformed-odd"), "50": [{ "3": 999, "9": [null] }] }
    ];

    for (const malformed of malformedDetails) {
      const id = String(malformed["2"]);
      const result = await collectApsportEventDetail({
        eventId: id, template: { origin: "https://pacific.agenate.com", headers: {}, body: {} },
        request: async () => ({ status: 200, data: [league("Detail", [malformed])] }),
        sleep: async () => undefined, isCurrent: () => true
      });
      expect(result, id).toBeNull();
    }
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

  it("does not retry or publish when a mandatory roster endpoint returns a permanent 403", async () => {
    const onRoster = vi.fn(async () => undefined);
    let attempts = 0;

    await expect(collectApsportCatalog({
      generation: "apsport-failed-roster",
      nowMs: NOW,
      prematchWindowHours: 24,
      template: { origin: "https://pacific.agenate.com", headers: {}, body: {} },
      request: async () => { attempts += 1; return { status: 403, data: null }; },
      sleep: async () => undefined,
      isCurrent: () => true,
      onRoster,
      onDetail: async () => undefined
    })).rejects.toThrow("APSPORT_ROSTER_HTTP_403");

    expect(attempts).toBe(1);
    expect(onRoster).not.toHaveBeenCalled();
  });

  it("retries only each failed roster endpoint before publishing one complete roster", async () => {
    const attempts = new Map<string, number>();
    const sleeps: number[] = [];
    const rosters: ApsportRawEvent[][] = [];

    await collectApsportCatalog({
      generation: "apsport-roster-retry", nowMs: NOW, prematchWindowHours: 24,
      template: { origin: "https://pacific.agenate.com", headers: {}, body: {} },
      request: async (input) => {
        if (input.kind === "DETAIL") throw new Error("UNEXPECTED_DETAIL");
        const key = `${input.kind}:${input.mode}`;
        const attempt = (attempts.get(key) ?? 0) + 1;
        attempts.set(key, attempt);
        if (attempt === 1) return { status: 0, data: null };
        if (input.kind === "EVENTS") return { status: 200,
          data: [league("Top", [event(`top-${input.mode}`, { live: true, startAt: null })])] };
        if (input.kind === "OTHER_LEAGUES") return { status: 200,
          data: [{ "4": `league-${input.mode}`, "5": "Lazy", "7": 999, "17": input.mode }] };
        return { status: 200,
          data: [league("Lazy", [event(`lazy-${input.mode}`, { live: true, startAt: null })])] };
      },
      sleep: async (delayMs) => { sleeps.push(delayMs); }, isCurrent: () => true,
      onRoster: async (batch) => { rosters.push([...batch.records]); },
      onDetail: async () => undefined
    });

    expect(Object.fromEntries(attempts)).toEqual({
      "EVENTS:2": 2, "OTHER_LEAGUES:2": 2, "LEAGUE_TOPS:2": 2,
      "EVENTS:4": 2, "OTHER_LEAGUES:4": 2, "LEAGUE_TOPS:4": 2,
      "EVENTS:3": 2, "OTHER_LEAGUES:3": 2, "LEAGUE_TOPS:3": 2
    });
    expect(sleeps).toEqual(Array.from({ length: 9 }, () => 1_000));
    expect(rosters).toHaveLength(1);
    expect(rosters[0]).toHaveLength(6);
  });

  it.each([
    [408, undefined, 1_000],
    [429, 90_000, 60_000],
    [503, undefined, 1_000]
  ] as const)("retries transient roster status %s with a bounded delay",
    async (status, retryAfterMs, expectedDelayMs) => {
    let attempts = 0;
    const sleeps: number[] = [];
    await collectApsportCatalog({
      generation: `apsport-roster-${status}`, nowMs: NOW, prematchWindowHours: 24,
      template: { origin: "https://pacific.agenate.com", headers: {}, body: {} },
      request: async () => {
        attempts += 1;
        return attempts === 1 ? { status, data: null, ...(retryAfterMs === undefined ? {} : { retryAfterMs }) }
          : { status: 200, data: [] };
      },
      sleep: async (delayMs) => { sleeps.push(delayMs); }, isCurrent: () => true,
      onRoster: async () => undefined, onDetail: async () => undefined
    });

    expect(attempts).toBe(7);
    expect(sleeps).toEqual([expectedDelayMs]);
  });

  it("exhausts one transient roster endpoint after three attempts without publishing", async () => {
    let attempts = 0;
    const sleeps: number[] = [];
    const onRoster = vi.fn(async () => undefined);

    await expect(collectApsportCatalog({
      generation: "apsport-roster-exhausted", nowMs: NOW, prematchWindowHours: 24,
      template: { origin: "https://pacific.agenate.com", headers: {}, body: {} },
      request: async () => { attempts += 1; return { status: 0, data: null }; },
      sleep: async (delayMs) => { sleeps.push(delayMs); }, isCurrent: () => true,
      onRoster, onDetail: async () => undefined
    })).rejects.toThrow("APSPORT_ROSTER_HTTP_0");

    expect(attempts).toBe(3);
    expect(sleeps).toEqual([1_000, 2_000]);
    expect(onRoster).not.toHaveBeenCalled();
  });

  it("stops a roster retry after cancellation without requesting another endpoint", async () => {
    let current = true;
    let attempts = 0;
    const onRoster = vi.fn(async () => undefined);

    await expect(collectApsportCatalog({
      generation: "apsport-roster-cancelled", nowMs: NOW, prematchWindowHours: 24,
      template: { origin: "https://pacific.agenate.com", headers: {}, body: {} },
      request: async () => { attempts += 1; return { status: 0, data: null }; },
      sleep: async () => { current = false; }, isCurrent: () => current,
      onRoster, onDetail: async () => undefined
    })).resolves.toBeUndefined();

    expect(attempts).toBe(1);
    expect(onRoster).not.toHaveBeenCalled();
  });

  it("stops after a successful roster response retires the current generation", async () => {
    let current = true;
    const requests: ApsportCatalogPageRequest[] = [];
    const onRoster = vi.fn(async () => undefined);

    await collectApsportCatalog({
      generation: "apsport-roster-retired", nowMs: NOW, prematchWindowHours: 24,
      template: { origin: "https://pacific.agenate.com", headers: {}, body: {} },
      request: async (input) => {
        requests.push(input);
        current = false;
        return { status: 200, data: [] };
      },
      sleep: async () => undefined, isCurrent: () => current,
      onRoster, onDetail: async () => undefined
    });

    expect(requests).toHaveLength(1);
    expect(onRoster).not.toHaveBeenCalled();
  });

  it("keeps live in the roster but hydrates hidden details only for nearest-first prematch events", async () => {
    const requests: ApsportCatalogPageRequest[] = [];
    const detailIds: string[] = [];
    const rosterBatches: unknown[] = [];
    const detailBatches: Array<{ readonly complete: boolean; readonly records: readonly ApsportRawEvent[] }> = [];
    const eligible = [
      event("live", { live: true, startAt: null }),
      event("soon", { startAt: "2026-08-28T23:59:59.000Z" }),
      event("far", { startAt: "2026-09-28T00:00:00.000Z" })
    ];
    const request = vi.fn(async (input: ApsportCatalogPageRequest) => {
      requests.push(input);
      if (input.kind === "EVENTS") return { status: 200, data: [league("Top", [eligible[0]!, eligible[2]!])] };
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

    expect(detailIds).toEqual(["soon", "far"]);
    expect(requests.filter((item): item is Extract<ApsportCatalogPageRequest, { readonly kind: "DETAIL" }> =>
      item.kind === "DETAIL").map((item) => item.eventId))
      .toEqual(["soon", "far"]);
    const lazyBodies = requests.filter((item) => item.kind === "LEAGUE_TOPS").map((item) => item.body);
    expect(lazyBodies).toContainEqual(expect.objectContaining({
      lis: [{ li: "lazy-league", in: "42" }]
    }));
    expect(JSON.stringify(lazyBodies)).not.toContain('"in":"999"');
    expect(rosterBatches).toHaveLength(1);
    expect(detailBatches).toEqual([expect.objectContaining({
      complete: true,
      records: [expect.objectContaining({ "2": "soon" }), expect.objectContaining({ "2": "far" })]
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
        if (input.kind === "EVENTS") return { status: 200, data: [league("Top", [event("1")])] };
        if (input.kind === "OTHER_LEAGUES" || input.kind === "LEAGUE_TOPS") return { status: 200, data: [] };
        attempts += 1;
        if (attempts === 1) return { status: 429, data: null, retryAfterMs: 1_500 };
        return { status: 200, data: [league("Detail", [event("1")])] };
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

  it("retries transient detail transport failures but not an ordinary permanent 4xx", async () => {
    const transientStatuses = [0, 408, 503, 200];
    const sleeps: number[] = [];
    const transient = await collectApsportEventDetail({
      eventId: "transient", template: { origin: "https://pacific.agenate.com", headers: {}, body: {} },
      request: async () => {
        const status = transientStatuses.shift()!;
        return status === 200
          ? { status, data: [league("Detail", [event("transient")])] }
          : { status, data: null };
      },
      sleep: async (delayMs) => { sleeps.push(delayMs); }, isCurrent: () => true
    });

    let permanentAttempts = 0;
    const permanent = await collectApsportEventDetail({
      eventId: "permanent", template: { origin: "https://pacific.agenate.com", headers: {}, body: {} },
      request: async () => { permanentAttempts += 1; return { status: 403, data: null }; },
      sleep: async () => undefined, isCurrent: () => true
    });

    expect(transient).toEqual(expect.objectContaining({ "2": "transient" }));
    expect(sleeps).toEqual([1_000, 2_000, 3_000]);
    expect(permanent).toBeNull();
    expect(permanentAttempts).toBe(1);
  });

  it("stops a transient detail retry when cancellation happens during its backoff", async () => {
    let current = true;
    let attempts = 0;

    const result = await collectApsportEventDetail({
      eventId: "cancelled", template: { origin: "https://pacific.agenate.com", headers: {}, body: {} },
      request: async () => { attempts += 1; return { status: 503, data: null }; },
      sleep: async () => { current = false; }, isCurrent: () => current
    });

    expect(result).toBeNull();
    expect(attempts).toBe(1);
  });

  it("does not complete a sweep when detail is missing or has a malformed raw market container", async () => {
    const completed: boolean[] = [];
    const detailRecords: ApsportRawEvent[][] = [];
    const roster = [event("missing"), event("malformed"), event("empty")];

    await collectApsportCatalog({
      generation: "apsport-invalid-detail", nowMs: NOW, prematchWindowHours: 24,
      template: { origin: "https://pacific.agenate.com", headers: {}, body: {} },
      request: async (input) => {
        if (input.kind === "EVENTS") return { status: 200, data: [league("Top", roster)] };
        if (input.kind === "OTHER_LEAGUES" || input.kind === "LEAGUE_TOPS") return { status: 200, data: [] };
        if (input.kind !== "DETAIL") throw new Error("UNEXPECTED_ROSTER_REQUEST");
        if (input.eventId === "missing") return { status: 200, data: [] };
        if (input.eventId === "malformed") {
          const malformed = { ...event("malformed") };
          delete malformed["50"];
          return { status: 200, data: [league("Detail", [malformed])] };
        }
        return { status: 200, data: [league("Detail", [{ ...event("empty"), "50": [] }])] };
      },
      sleep: async () => undefined, isCurrent: () => true,
      onRoster: async () => undefined,
      onDetail: async (batch) => { completed.push(batch.complete); detailRecords.push([...batch.records]); },
      detailBatchSize: 10
    });

    expect(completed).toEqual([false]);
    expect(detailRecords).toEqual([[expect.objectContaining({ "2": "empty", "50": [] })]]);
  });

  it("stops a superseded generation before requesting another event detail", async () => {
    let current = true;
    const detailIds: string[] = [];
    const completed: boolean[] = [];
    const request = vi.fn(async (input: ApsportCatalogPageRequest) => {
      if (input.kind === "EVENTS") return { status: 200,
        data: [league("Top", [event("1"), event("2")])] };
      if (input.kind === "OTHER_LEAGUES" || input.kind === "LEAGUE_TOPS") return { status: 200, data: [] };
      if (input.kind !== "DETAIL") throw new Error("UNEXPECTED_ROSTER_REQUEST");
      detailIds.push(input.eventId);
      current = false;
      return { status: 200, data: [league("Detail", [event(input.eventId)])] };
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
