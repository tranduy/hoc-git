import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NetworkObserver } from "./network-observer.js";

const START = 1_800_000_000_000;
describe("BTI catalog refresh through real observer", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(START); });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
  it("forwards detail completed after the first roster on the next refresh of the same generation", async () => {
    const forwarded: any[] = [];
    const root = { dataset: {} };
    const league = Array(13).fill(null);
    const event = Array(34).fill(null);
    event[0] = "e1"; event[5] = false;
    league[12] = [event];
    let release!: () => void;
    const fetcher = async (url: string) => url.startsWith("/api/eventpage")
      ? { ok: true, text: () => new Promise<string>((resolve) => { release = () => resolve('{"data":[]}'); }) }
      : { ok: true, text: async () => JSON.stringify({ serializedData: url.includes("prematch") ? [league] : [] }) };
    const observer = new NetworkObserver({ now: () => Date.now(), monotonicNow: () => Date.now() - START,
      forward: async (envelope) => { forwarded.push(envelope); },
      sendCommand: async (_tab, method, params) => {
        if (method === "Page.getFrameTree") return { frameTree: { frame: { id: "top", loaderId: "doc" } } };
        if (method !== "Runtime.evaluate" || typeof params?.expression !== "string") return {};
        const run = new Function("document", "location", "fetch", "localStorage", `return ${params.expression}`);
        const value = await run({ documentElement: root },
          { pathname: "/sports", hostname: "bti.test", origin: "https://bti.test" }, fetcher, { getItem: () => null });
        return { result: { value } };
      } });
    const source = { lobby: "BTI", sourceId: "chrome:BTI:1", tabId: 1 } as const;
    await observer.refreshCatalog(source);
    const initial = forwarded.filter((row) => row.transport === "HTTP_RESPONSE");
    expect(initial).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(500);
    release();
    await vi.advanceTimersByTimeAsync(2_500);
    await observer.refreshCatalog(source);
    const detail = forwarded.find((row) => row.request.pathnameClass.startsWith("/api/eventpage"));
    expect(detail).toBeDefined();
    expect(detail.request.streamId).toBe(initial[0].request.streamId);
    expect(JSON.parse(detail.payload.body)).toEqual({ data: [], fieldlineBtiDetails: [{ eventId: "e1",
      generation: initial[0].request.streamId, requestedAtMs: START, observedAtMs: START + 500 }] });
  });
});
