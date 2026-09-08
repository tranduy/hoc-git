import { describe, expect, it } from "vitest";
import { SBOBET_PASSIVE_DOM_DISCOVERY_EXPRESSION, summarizeSbobetDiscovery,
  formatSbobetDiscovery, formatSbobetDomDiscovery, type SbobetDiscoverySummary,
  type SbobetDomDiscoverySummary } from "./sbobet-discovery.js";

const SECRET = "TEST_FIXTURE_SECRET_2026";

describe("summarizeSbobetDiscovery", () => {
  it("reports only classified request metadata and permitted time-range values", () => {
    const summary = summarizeSbobetDiscovery({
      url: `https://api.sb21.net/api/v2/getEvent?eventId=12345&timeRange=Today&sportId=${SECRET}` +
        `&token=${SECRET}&${SECRET}=${SECRET}`,
      method: "GET", httpStatus: 200
    });
    expect(summary).toMatchObject({ kind: "SBOBET_PASSIVE_DISCOVERY", method: "GET", httpStatus: 200,
      queryKeys: ["eventId", "timeRange", "sportId", "AUTH_KEY", "OTHER"],
      hasNumericEventId: true, timeRange: "today", membership: "UNPROVEN",
      response: { status: "NOT_OBSERVED" } });
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain(SECRET);
    expect(serialized).not.toContain("12345");
    expect(serialized).not.toContain("https://");
    expect(serialized).not.toContain("api.sb21.net");
  });

  it.each([
    `http://api.sb21.net/api/v2/getEvent?token=${SECRET}`,
    `https://sb21.net.evil.test/api/v2/getEvent?token=${SECRET}`,
    `https://user:${SECRET}@sb21.net/api/v2/getEvent`,
    `https://sb21.net/api/v2/placeBet?token=${SECRET}`
  ])("rejects a request outside the exact permitted endpoint: %s", (url) => {
    expect(summarizeSbobetDiscovery({ url, method: "GET" })).toBeNull();
  });

  it("does not promote arbitrary or conflicting query values to a valid scope", () => {
    const summary = summarizeSbobetDiscovery({
      url: `https://zenandfe.com/api/v2/getEvent?eventId=123&eventId=${SECRET}&timeRange=${SECRET}`,
      method: SECRET, httpStatus: -1
    });
    expect(summary).toMatchObject({ method: "OTHER", hasNumericEventId: false, timeRange: null, httpStatus: null });
    expect(JSON.stringify(summary)).not.toContain(SECRET);
  });

  it("rejects an oversized request URL before parsing its query entries", () => {
    expect(summarizeSbobetDiscovery({ url: "https://sb21.net/api/v2/getEvent?" + "a=x&".repeat(10_000),
      method: "GET" })).toBeNull();
  });

  it("samples native event and group IDs/counts through a wrapper without leaking native row data", () => {
    const summary = summarizeSbobetDiscovery({ url: "https://prod20091.fxf774.com/api/v2/getEvent",
      method: "POST", httpStatus: 200, body: JSON.stringify({ token: SECRET, body: JSON.stringify({
        data: [{ "1": SECRET, "2": [{ "8": 12345, "2": SECRET, "3": SECRET,
          "7": { "31": [SECRET, SECRET], "777": [{ token: SECRET }], [SECRET]: [] } }] }]
      }) }) });
    expect(summary).toMatchObject({ membership: "UNPROVEN", response: {
      status: "INSPECTED", wrapperKeys: ["body", "data"], sampledEventCount: 1,
      events: [{ eventId: "12345", container: "ALL_ARRAY_CONTAINER", nativeGroupCount: 3,
        groups: [{ groupId: "31", rowCount: 2 }, { groupId: "777", rowCount: 1 }, { groupId: null, rowCount: 0 }] }]
    } });
    expect(JSON.stringify(summary)).not.toContain(SECRET);
  });

  it("distinguishes malformed or missing containers from valid empty containers without claiming completeness", () => {
    const summary = summarizeSbobetDiscovery({ url: "https://sb21.net/api/v2/getEvent", method: "GET", body:
      JSON.stringify([{ "8": 1, "7": {} }, { "8": 2, "7": { "777": SECRET } }, { "8": 3 }]) });
    expect(summary?.response.events.map((event) => event.container))
      .toEqual(["ALL_ARRAY_CONTAINER", "MALFORMED", "MISSING"]);
    expect(summary?.membership).toBe("UNPROVEN");
    expect(JSON.stringify(summary)).not.toContain(SECRET);
  });

  it("rejects oversized/invalid JSON and bounds a large native inventory summary", () => {
    const request = { url: "https://sb21.net/api/v2/getEvent", method: "GET" };
    expect(summarizeSbobetDiscovery({ ...request, body: SECRET.repeat(50_000) })?.response.status).toBe("TOO_LARGE");
    expect(summarizeSbobetDiscovery({ ...request, body: `{"token":"${SECRET}"` })?.response.status).toBe("INVALID_JSON");
    const events = Array.from({ length: 500 }, (_, index) => ({ "8": index + 1,
      "7": Object.fromEntries(Array.from({ length: 50 }, (_unused, group) => [String(group), [SECRET]])) }));
    const summary = summarizeSbobetDiscovery({ ...request, body: JSON.stringify(events).replaceAll(SECRET, "x") });
    expect(summary?.response.truncated).toBe(true);
    expect(summary!.response.events.length).toBeLessThanOrEqual(16);
    expect(summary!.response.events.reduce((count, event) => count + event.groups.length, 0)).toBeLessThanOrEqual(64);
    expect(JSON.stringify(summary).length).toBeLessThan(12_000);
  });

  it("formats a bounded ASCII diagnostic while retaining unproven membership and no input secrets", () => {
    const summary = summarizeSbobetDiscovery({ url: `https://sb21.net/api/v2/getEvent?token=${SECRET}`, method: "GET" })!;
    const crowded: SbobetDiscoverySummary = { ...summary,
      queryKeys: ["eventId", "timeRange", "sportId", "leagueId", "marketType", "language", "AUTH_KEY", "OTHER"],
      response: { ...summary.response, status: "INSPECTED", wrapperKeys: ["body", "data", "result", "leagues", "events", SECRET],
        events: [{ eventId: "12345", container: "ALL_ARRAY_CONTAINER", nativeGroupCount: 32,
          groups: Array.from({ length: 32 }, () => ({ groupId: "999999", rowCount: 1_000_000 })) }] } };
    const value = formatSbobetDiscovery(crowded);
    expect(value.length).toBeLessThanOrEqual(440);
    expect(value).toMatch(/^[\x20-\x7e]+$/u);
    expect(value).toContain("member=UNPROVEN");
    expect(value).toContain("method=GET");
    expect(value).not.toContain(SECRET);
    expect(value).not.toContain("12345");
  });
});

interface FakeNodeOptions { text?: string; classes?: string[]; attributes?: string[]; id?: string; odds?: boolean }
function node(options: FakeNodeOptions = {}) {
  const names = options.classes ?? [];
  return {
    textContent: options.text ?? "", id: options.id ?? "",
    classList: { length: names.length, item: (index: number) => names[index] ?? null },
    getAttributeNames: () => options.attributes ?? [],
    closest: () => options.odds ? {} : null,
    get href(): never { throw new Error("href must not be read"); },
    get value(): never { throw new Error("input value must not be read"); },
    get innerHTML(): never { throw new Error("HTML must not be read"); },
    click: (): never => { throw new Error("passive probe clicked a control"); }
  };
}
function runDom(nodes: ReturnType<typeof node>[], clock: () => number = () => 0) {
  let queried = "";
  let fetchCount = 0;
  const read = new Function("document", "performance", "fetch", `return ${SBOBET_PASSIVE_DOM_DISCOVERY_EXPRESSION};`);
  const summary = read({ querySelectorAll: (selector: string) => { queried = selector; return nodes; } },
    { now: clock }, () => { fetchCount += 1; throw new Error("passive probe fetched"); }) as SbobetDomDiscoverySummary;
  return { summary, queried, fetchCount };
}

describe("SBOBET_PASSIVE_DOM_DISCOVERY_EXPRESSION", () => {
  it("reports only public allowlisted label/name/selector shapes and excludes odds More controls", () => {
    const { summary, queried, fetchCount } = runDom([
      node({ text: "Bóng đá", classes: ["sport-type-group-item", SECRET], attributes: ["data-sport-id", SECRET] }),
      node({ text: "More markets (12)", classes: ["more-bet"], attributes: ["aria-expanded"] }),
      node({ text: "More", classes: ["more-bet"], odds: true }),
      node({ text: SECRET, id: "wrapper-match-component-12345", attributes: ["data-event-id"] }),
      node({ text: `Balance ${SECRET}`, id: SECRET, classes: [SECRET], attributes: [SECRET] })
    ]);
    expect(summary).toMatchObject({ kind: "SBOBET_PASSIVE_DOM_DISCOVERY", moreControlCount: 1,
      labels: expect.arrayContaining([{ name: "FOOTBALL", count: 1 }, { name: "MORE_MARKETS", count: 1 }]),
      classes: expect.arrayContaining(["sport-type-group-item", "more-bet"]),
      selectorShapes: expect.arrayContaining(["#wrapper-match-component-{numeric}", "[data-event-id]"]) });
    expect(queried).toContain("button");
    expect(queried).not.toBe("*");
    expect(fetchCount).toBe(0);
    expect(JSON.stringify(summary)).not.toContain(SECRET);
    expect(JSON.stringify(summary)).not.toContain("12345");
  });

  it("bounds huge DOM traversal and the serialized result", () => {
    const { summary, fetchCount } = runDom(Array.from({ length: 20_000 }, () =>
      node({ text: "Today", classes: [SECRET], attributes: ["data-event-id", SECRET] })));
    expect(summary.inspectedNodeCount).toBeLessThanOrEqual(400);
    expect(summary.truncated).toBe(true);
    expect(JSON.stringify(summary).length).toBeLessThan(4_000);
    expect(JSON.stringify(summary)).not.toContain(SECRET);
    expect(fetchCount).toBe(0);
  });

  it("stops at the elapsed-time deadline without scheduling actions or requests", () => {
    let time = 0;
    const { summary, fetchCount } = runDom(Array.from({ length: 100 }, () => node({ text: "More" })),
      () => time += 10);
    expect(summary.inspectedNodeCount).toBeLessThanOrEqual(3);
    expect(summary.truncated).toBe(true);
    expect(fetchCount).toBe(0);
  });

  it("validates page-owned metadata before compact diagnostic formatting", () => {
    const { summary } = runDom([node({ text: "Football" })]);
    const value = formatSbobetDomDiscovery({ ...summary, classes: [SECRET, "more-bet"],
      labels: [{ name: SECRET, count: 1 }, { name: "FOOTBALL", count: 1 }],
      selectorShapes: [SECRET], attributes: [{ name: SECRET, count: 1 }], inspectedNodeCount: SECRET });
    expect(value).toContain("FOOTBALL:1");
    expect(value).not.toContain(SECRET);
    expect(value!.length).toBeLessThanOrEqual(440);
    expect(value).toMatch(/^[\x20-\x7e]+$/u);
    expect(formatSbobetDomDiscovery({ kind: SECRET })).toBeNull();
  });
});
