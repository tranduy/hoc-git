import type { BrowserContext, Response } from "playwright";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlaywrightBtiBrowserManager } from "./bti-browser-manager.js";

const browser = vi.hoisted(() => ({ launchPersistentContext: vi.fn() }));
vi.mock("playwright", () => ({ chromium: browser }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

function payload(eventId: string) {
  const event = Array<unknown>(34).fill(null);
  event[0] = eventId;
  event[2] = "League";
  event[8] = [["home", { EN: "Alpha" }], ["away", { EN: "Beta" }]];
  event[11] = "2026-09-08T12:00:00Z";
  event[13] = false;
  event[20] = [];
  return { data: [event] };
}

function context(read: () => Promise<unknown>, navigate: () => Promise<void> = async () => undefined) {
  let onResponse!: (response: Response) => void;
  let closed = false;
  const page = {
    on: (_event: string, listener: typeof onResponse) => { onResponse = listener; },
    goto: async () => { await navigate(); onResponse({
      url: () => "https://prod1.fxf1.com/api/eventlist/asia/leagues/v2/1/live/initial",
      status: () => 200
    } as Response); },
    url: () => "https://prod1.fxf1.com/",
    title: async () => "Sportsbook",
    locator: () => ({ first: () => ({ isVisible: async () => true }) }),
    evaluate: read,
    isClosed: () => closed,
    waitForTimeout: async () => undefined
  };
  return {
    pages: () => [page],
    route: async () => undefined,
    close: async () => { closed = true; },
    get closed() { return closed; }
  };
}

const input = { sessionId: "bti-session", launchUrl: "https://prod1.fxf1.com/launch-one" };
const manager = () => new PlaywrightBtiBrowserManager({ profilesRoot: "unused-test-profiles", headless: true });

describe("BTI browser manager lifecycle", () => {
  beforeEach(() => browser.launchPersistentContext.mockReset());

  it("rejects an opening cancelled by close and closes its late browser context", async () => {
    const opening = deferred<BrowserContext>();
    const stale = context(async () => payload("stale"));
    browser.launchPersistentContext.mockReturnValueOnce(opening.promise);
    const source = manager();
    const result = source.readCatalog(input).then(() => "published", () => "cancelled");
    await source.close();
    opening.resolve(stale as unknown as BrowserContext);
    expect(await result).toBe("cancelled");
    expect(stale.closed).toBe(true);

    const current = context(async () => payload("current"));
    browser.launchPersistentContext.mockResolvedValueOnce(current);
    expect((await source.readCatalog(input)).records[0]?.eventId).toBe("current");
    await source.close();
    expect(current.closed).toBe(true);
  });

  it("rejects a catalog response that completes after its generation is closed", async () => {
    const response = deferred<unknown>();
    const reading = deferred<void>();
    browser.launchPersistentContext.mockResolvedValueOnce(context(async () => {
      reading.resolve();
      return response.promise;
    }));
    const source = manager();
    const result = source.readCatalog(input).then(() => "published", () => "cancelled");
    await reading.promise;
    await source.close();
    response.resolve(payload("stale"));
    expect(await result).toBe("cancelled");
  });

  it("closes an already launched context while its navigation is pending", async () => {
    const navigation = deferred<void>();
    const navigating = deferred<void>();
    const stale = context(async () => payload("stale"), async () => {
      navigating.resolve();
      await navigation.promise;
    });
    browser.launchPersistentContext.mockResolvedValueOnce(stale);
    const source = manager();
    const result = source.readCatalog(input).then(() => "published", () => "cancelled");
    await navigating.promise;
    await source.close();
    const closedBeforeNavigationCompleted = stale.closed;
    navigation.resolve();
    expect(await result).toBe("cancelled");
    expect(closedBeforeNavigationCompleted).toBe(true);
  });

  it("keeps same-launch duplicate catalog reads single-flight", async () => {
    const response = deferred<unknown>();
    const reading = deferred<void>();
    let reads = 0;
    browser.launchPersistentContext.mockResolvedValueOnce(context(async () => {
      reads += 1;
      reading.resolve();
      return response.promise;
    }));
    const source = manager();
    const first = source.readCatalog(input);
    await reading.promise;
    const second = source.readCatalog(input);
    response.resolve(payload("shared"));
    expect((await first).records[0]?.eventId).toBe("shared");
    expect(await second).toEqual(await first);
    expect(reads).toBe(1);
    await source.close();
  });

  it("reads a renewed launch independently of an older in-flight read for the same session", async () => {
    const response = deferred<unknown>();
    const reading = deferred<void>();
    browser.launchPersistentContext
      .mockResolvedValueOnce(context(async () => { reading.resolve(); return response.promise; }))
      .mockResolvedValueOnce(context(async () => payload("new-launch")));
    const source = manager();
    const old = source.readCatalog(input);
    await reading.promise;
    const current = source.readCatalog({ ...input, launchUrl: "https://prod1.fxf1.com/launch-two" });
    response.resolve(payload("old-launch"));
    expect((await current).records[0]?.eventId).toBe("new-launch");
    expect((await old).records[0]?.eventId).toBe("old-launch");
    await source.close();
  });

  it.each([
    { name: "event detail", response: { data: [] }, providerEventId: "event-1" },
    { name: "roster", response: { serializedData: [] } }
  ])("accepts a recognized successful empty $name", async ({ response, ...options }) => {
    browser.launchPersistentContext.mockResolvedValueOnce(context(async () => response));
    const source = manager();
    expect(await source.readCatalog({ ...input, ...("providerEventId" in options
      ? { providerEventId: options.providerEventId } : {}) })).toMatchObject({
      records: [], nativeMarketObservations: []
    });
    await source.close();
  });

  it.each([null, {}, { data: [{}] }, { data: [] }, { serializedData: [{}] }])(
    "rejects malformed or wrong-endpoint empty roster payload %j", async (response) => {
      browser.launchPersistentContext.mockResolvedValueOnce(context(async () => response));
      const source = manager();
      await expect(source.readCatalog(input)).rejects.toThrow("BTI_CATALOG_EMPTY");
      await source.close();
    });
});
