import { describe, expect, it, vi } from "vitest";
import { NetworkObserver } from "./network-observer.js";

const START = 1_788_880_000_000;
const source = { lobby: "IM", sourceId: "chrome:IM:8", tabId: 8 } as const;
const pair = () => [1, 2].map(market => ({ market, body: '{"StatusCode":100,"sel":[]}' }));
async function harness() {
  let now = START;
  let value: Record<string, unknown> = { status: "catalog-requested", responses: pair(),
    coverage: { rosterAtMs: START + 1, rosterFailures: 0 } };
  const forward = vi.fn(async (_message: unknown) => undefined);
  const sendCommand = vi.fn(async (_tab: number, method: string) => {
    if (method === "Page.getFrameTree") return { frameTree: { frame: {
      id: "im-main", loaderId: "doc-1", url: "https://imsports.directsb.net/" } } };
    if (method === "Runtime.evaluate") { now += 1; return { result: { value } }; }
    return {};
  });
  const observer = new NetworkObserver({ sendCommand, forward, now: () => now });
  await observer.handleEvent(source, "Runtime.executionContextCreated", { context: {
    id: 81, auxData: { frameId: "im-main", isDefault: true } } });
  return { observer, forward, setValue: (next: Record<string, unknown>) => { value = next; } };
}

describe("IM current native pair readiness", () => {
  it("accepts only a fresh current pair and retires it on source reset and detach", async () => {
    const h = await harness();
    expect(h.observer.hasCompleteImBaselineSince(source.sourceId, START)).toBe(false);
    await h.observer.refreshCatalog(source);
    expect(h.observer.hasCompleteImBaselineSince(source.sourceId, START)).toBe(true);
    expect(h.observer.hasCompleteImBaselineSince(source.sourceId, START + 2)).toBe(false);
    h.observer.beginSourceEpoch(source.sourceId);
    expect(h.observer.hasCompleteImBaselineSince(source.sourceId, START)).toBe(false);
    h.setValue({ status: "catalog-requested", responses: pair(), coverage: { rosterAtMs: START + 2, rosterFailures: 0 } });
    await h.observer.refreshCatalog(source);
    expect(h.observer.hasCompleteImBaselineSince(source.sourceId, START + 2)).toBe(true);
    h.observer.releaseTab(source.tabId);
    expect(h.observer.hasCompleteImBaselineSince(source.sourceId, START)).toBe(false);
  });

  it.each([
    { status: "request-failed", responses: pair(), coverage: { rosterAtMs: START + 1, rosterFailures: 1 } },
    { status: "catalog-requested", responses: pair(), coverage: { rosterAtMs: START - 1, rosterFailures: 0 } },
    { status: "catalog-requested", responses: pair().slice(0, 1), coverage: { rosterAtMs: START + 1, rosterFailures: 0 } },
    { status: "catalog-requested", responses: [pair()[0], { market: 2, body: '{"StatusCode":500,"sel":[]}' }],
      coverage: { rosterAtMs: START + 1, rosterFailures: 0 } }
  ])("rejects failed, cached, incomplete or native-error results %#", async value => {
    const h = await harness(); h.setValue(value);
    await h.observer.refreshCatalog(source);
    expect(h.observer.hasCompleteImBaselineSince(source.sourceId, START)).toBe(false);
  });

  it("retires readiness when its verified main-world context is destroyed", async () => {
    const h = await harness(); await h.observer.refreshCatalog(source);
    expect(h.observer.hasCompleteImBaselineSince(source.sourceId, START)).toBe(true);
    await h.observer.handleEvent(source, "Runtime.executionContextDestroyed", { executionContextId: 81 });
    expect(h.observer.hasCompleteImBaselineSince(source.sourceId, START)).toBe(false);
  });
});
