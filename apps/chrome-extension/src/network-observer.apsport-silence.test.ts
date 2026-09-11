import { describe, expect, it, vi } from "vitest";
import { NetworkObserver } from "./network-observer.js";

const source = { lobby: "TSPORT", sourceId: "chrome:TSPORT:14", tabId: 14 } as const;
const footballUrl = "wss://spws.agenate.com/ln/en/s/1/mg/1/tr/0";

function setup() {
  let now = 0;
  const renew = vi.fn(async (..._args: unknown[]): Promise<void> => undefined);
  const sendCommand = vi.fn(async (..._args: unknown[]): Promise<unknown> => ({}));
  const observer = new NetworkObserver({ sendCommand, forward: vi.fn(async () => undefined),
    onApsportOrphanSocket: renew, now: () => now, monotonicNow: () => now });
  return { observer, renew, sendCommand, at: (value: number) => { now = value; } };
}

describe("APSPORT silent native socket recovery", () => {
  it("restarts the absence grace when a socket opens and closes between maintenance ticks", async () => {
    const { observer, renew, at } = setup();
    await observer.maintain(source);
    at(59_000);
    await observer.handleEvent(source, "Network.webSocketCreated", { requestId: "brief", url: footballUrl });
    at(60_000);
    await observer.handleEvent(source, "Network.webSocketClosed", { requestId: "brief" });
    await observer.maintain(source);
    expect(renew).not.toHaveBeenCalled();
    at(120_000);
    await observer.maintain(source);
    expect(renew).toHaveBeenCalledTimes(1);
  });

  it("uses current ownership while a retired AP roster task is still unwinding", async () => {
    const { observer, renew, sendCommand, at } = setup();
    let release!: (value: unknown) => void;
    sendCommand.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const work = observer.refreshCatalog(source).catch(() => undefined);
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    await observer.maintain(source);
    at(60_000);
    await observer.maintain(source);
    const guard = renew.mock.calls[0]?.[1] as { isCurrent: () => boolean; captureIdentity: () => () => boolean };
    expect(guard.isCurrent()).toBe(true);
    observer.prepareSourceNavigation(source.sourceId);
    expect(guard.isCurrent()).toBe(false);
    const claimed = guard.captureIdentity();
    release({});
    await work;
    expect(claimed()).toBe(true);
  });

  it("recovers complete socket silence after startup grace and paces failed renewals", async () => {
    const { observer, renew, at } = setup();
    await observer.maintain(source);
    at(59_999);
    await observer.maintain(source);
    expect(renew).not.toHaveBeenCalled();
    at(60_000);
    await observer.maintain(source);
    expect(renew).toHaveBeenCalledTimes(1);
    at(89_999);
    await observer.maintain(source);
    expect(renew).toHaveBeenCalledTimes(1);
    at(90_000);
    await observer.maintain(source);
    expect(renew).toHaveBeenCalledTimes(2);
  });

  it("keeps a quiet football socket and ignores unrelated sockets as health evidence", async () => {
    const { observer, renew, at } = setup();
    await observer.handleEvent(source, "Network.webSocketCreated", {
      requestId: "heartbeat", url: "wss://spws.agenate.com/ln/en/lm"
    });
    await observer.maintain(source);
    at(60_000);
    await observer.maintain(source);
    expect(renew).toHaveBeenCalledTimes(1);
    await observer.handleEvent(source, "Network.webSocketCreated", { requestId: "football", url: footballUrl });
    at(300_000);
    await observer.maintain(source);
    expect(renew).toHaveBeenCalledTimes(1);
    await observer.handleEvent(source, "Network.webSocketClosed", { requestId: "football" });
    await observer.maintain(source);
    at(359_999);
    await observer.maintain(source);
    expect(renew).toHaveBeenCalledTimes(1);
    at(360_000);
    await observer.maintain(source);
    expect(renew).toHaveBeenCalledTimes(2);
  });

  it("does not repeat a pending recovery or interrupt replacement navigation grace", async () => {
    const { observer, renew, at } = setup();
    let finish!: () => void;
    renew.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
    await observer.maintain(source);
    at(60_000);
    await observer.maintain(source);
    at(180_000);
    await observer.maintain(source);
    expect(renew).toHaveBeenCalledTimes(1);
    observer.prepareSourceNavigation(source.sourceId);
    finish();
    await Promise.resolve();
    await observer.maintain(source);
    at(239_999);
    await observer.maintain(source);
    expect(renew).toHaveBeenCalledTimes(1);
  });

  it.each(["source", "bridge", "tab"])("cancels a delayed pulse across %s replacement", async kind => {
    const { observer, renew, sendCommand, at } = setup();
    await observer.maintain(source);
    at(60_000);
    let finish!: (value: unknown) => void;
    sendCommand.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = observer.maintain(source);
    if (kind === "source") observer.beginSourceEpoch(source.sourceId);
    if (kind === "bridge") observer.beginBridgeSourceEpoch(source.sourceId);
    if (kind === "tab") observer.releaseTab(source.tabId);
    finish({});
    await pending;
    expect(renew).not.toHaveBeenCalled();
  });

  it("cancels queued recovery when a socket appears or the bridge changes", async () => {
    const { observer, renew, at } = setup();
    await observer.maintain(source);
    at(60_000);
    await observer.maintain(source);
    const guard = renew.mock.calls[0]?.[1] as { isCurrent: () => boolean };
    expect(guard.isCurrent()).toBe(true);
    await observer.handleEvent(source, "Network.webSocketCreated", { requestId: "football", url: footballUrl });
    expect(guard.isCurrent()).toBe(false);
    observer.beginBridgeSourceEpoch(source.sourceId);
    expect(guard.isCurrent()).toBe(false);
  });
});
