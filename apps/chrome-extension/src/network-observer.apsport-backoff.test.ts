import { describe, expect, it, vi } from "vitest";
import { NetworkObserver } from "./network-observer.js";
import type { ApsportCatalogPageRequest, ApsportCatalogPageResponse, CollectApsportCatalogOptions } from "./apsport-catalog-refresh.js";

const source = { lobby: "TSPORT", sourceId: "chrome:TSPORT:7", tabId: 7 } as const;
const input: ApsportCatalogPageRequest = { kind: "EVENTS", mode: 2,
  url: "https://pacific.agenate.com/be-ui/pac/api/v3/events", body: { si: 1, mno: 2 } };
async function harness() {
  let now = 1_800_000_000_000;
  let respond = async (): Promise<ApsportCatalogPageResponse> => ({ status: 503, data: null, retryAfterMs: 3_600_000 });
  const physical = vi.fn(async () => respond());
  const collect = vi.fn(async (_options: CollectApsportCatalogOptions) => undefined);
  const observer = new NetworkObserver({ now: () => now, observerSessionId: "backoff-test",
    forward: async () => undefined, collectApsportCatalog: collect,
    sendCommand: async (_tab, method, params) => method === "Runtime.evaluate" &&
      String(params?.expression).includes("response.headers.get('retry-after')")
      ? { result: { value: await physical() } } : {} });
  await observer.start(source);
  const initialize = async (revision: number) => {
    await observer.setCollectionPlan(source, { revision, events: [] });
    await observer.handleEvent(source, "Runtime.executionContextCreated", {
      context: { id: 91, auxData: { frameId: "ap-app", isDefault: true } } });
    await observer.handleEvent(source, "Network.requestWillBeSent", {
      requestId: `native-${revision}`, type: "Fetch", frameId: "ap-app", loaderId: `loader-${revision}`,
      request: { method: "POST", url: input.url, headers: { "Content-Type": "application/json" },
        postData: JSON.stringify(input.body) } });
    await observer.refreshCatalog(source);
    const options = collect.mock.calls.at(-1)![0];
    expect(options.maxAttempts).toBe(1);
    return options.request;
  };
  const request = await initialize(1);
  return { observer, physical, request, initialize, collect, time: (value: number) => { now = value; },
    respond: (value: typeof respond) => { respond = value; } };
}

describe("APSPORT scheduled provider backoff", () => {
  it.each([429, 503])("keeps every request paused for the full HTTP %s deadline", async status => {
    const h = await harness();
    h.respond(async () => ({ status, data: null, retryAfterMs: 3_600_000 }));
    expect((await h.request(input)).status).toBe(status);
    h.time(1_800_000_000_000 + 3_600_000 - 1);
    expect((await h.request(input)).status).toBe(429);
    expect(h.physical).toHaveBeenCalledOnce();
    h.time(1_800_000_000_000 + 3_600_000);
    await h.request(input);
    expect(h.physical).toHaveBeenCalledTimes(2);
    h.observer.beginSourceEpoch(source.sourceId);
  });

  it("does not stamp a new roster attempt during a known provider cooldown", async () => {
    const h = await harness();
    await h.request(input);
    h.time(1_800_000_000_000 + 3_600_000 - 1);
    await h.observer.refreshCatalog(source);
    expect(h.collect).toHaveBeenCalledOnce();
    h.time(1_800_000_000_000 + 3_600_000);
    await h.observer.refreshCatalog(source);
    expect(h.collect).toHaveBeenCalledTimes(2);
    h.observer.beginSourceEpoch(source.sourceId);
  });

  it("does not let a retired request stamp backoff into the new source epoch", async () => {
    const h = await harness();
    let finish!: (value: ApsportCatalogPageResponse) => void;
    h.respond(() => new Promise(resolve => { finish = resolve; }));
    const old = h.request(input);
    await vi.waitFor(() => expect(h.physical).toHaveBeenCalledOnce());
    h.observer.beginSourceEpoch(source.sourceId);
    finish({ status: 503, data: null, retryAfterMs: 3_600_000 });
    expect(await old).toMatchObject({ status: 0 });
    h.respond(async () => ({ status: 200, data: [] }));
    const fresh = await h.initialize(2);
    expect((await fresh(input)).status).toBe(200);
    expect(h.physical).toHaveBeenCalledTimes(2);
    h.observer.beginSourceEpoch(source.sourceId);
  });
});
