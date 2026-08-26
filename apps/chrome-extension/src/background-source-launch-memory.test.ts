import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type UpdatedListener = (tabId: number, changeInfo: Record<string, unknown>,
  tab: Record<string, unknown>) => void;
type MessageListener = (message: unknown, sender: unknown,
  sendResponse: (response: unknown) => void) => boolean;

function chromeEvent<T>() {
  const listeners: T[] = [];
  return {
    listeners,
    api: { addListener: (listener: T) => { listeners.push(listener); } }
  };
}

function createChromeHarness(signedUrl: string) {
  const updated = chromeEvent<UpdatedListener>();
  const messages = chromeEvent<MessageListener>();
  const storage = {
    local: {
      get: vi.fn(async () => ({})),
      set: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined)
    },
    session: {
      get: vi.fn(async () => ({})),
      set: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined)
    }
  };
  const api = {
    alarms: {
      create: vi.fn(),
      onAlarm: chromeEvent<(alarm: { readonly name: string }) => void>().api
    },
    debugger: {
      attach: vi.fn(async () => undefined),
      detach: vi.fn(async () => undefined),
      sendCommand: vi.fn(async () => ({})),
      onDetach: chromeEvent<(debuggee: { readonly tabId?: number }) => void>().api,
      onEvent: chromeEvent<(debuggee: { readonly tabId?: number }, method: string, params: unknown,
        sessionId?: string) => void>().api
    },
    runtime: {
      onInstalled: chromeEvent<(details: { readonly reason: string }) => void>().api,
      onStartup: chromeEvent<() => void>().api,
      onMessage: messages.api
    },
    sessions: {
      getRecentlyClosed: vi.fn(async () => []),
      restore: vi.fn(async () => ({}))
    },
    storage,
    tabs: {
      create: vi.fn(async (details: { readonly url?: string }) => ({ id: 8, url: details.url })),
      get: vi.fn(async (tabId: number) => ({ id: tabId, url: signedUrl, title: "Sportsbook" })),
      query: vi.fn(async () => [{ id: 7, url: signedUrl, title: "Sportsbook" }]),
      reload: vi.fn(async () => undefined),
      remove: vi.fn(async () => undefined),
      update: vi.fn(async (tabId: number, details: { readonly url?: string }) => ({
        id: tabId, url: details.url, title: "Sportsbook"
      })),
      onCreated: { ...chromeEvent<(tab: Record<string, unknown>) => void>().api,
        removeListener: vi.fn() },
      onRemoved: chromeEvent<(tabId: number) => void>().api,
      onUpdated: { ...updated.api, removeListener: vi.fn() }
    },
    windows: { update: vi.fn(async () => undefined) }
  };
  return { api, messages, storage };
}

async function settleWorkerStart(storage: ReturnType<typeof createChromeHarness>["storage"]): Promise<void> {
  await vi.advanceTimersByTimeAsync(25);
  expect(storage.session.remove).toHaveBeenCalledWith("sourceLaunchUrls");
  expect(storage.local.get).toHaveBeenCalledWith("installationKey");
}

function serializedStorageCalls(storage: ReturnType<typeof createChromeHarness>["storage"]): string {
  return JSON.stringify([
    storage.local.get.mock.calls,
    storage.local.set.mock.calls,
    storage.local.remove.mock.calls,
    storage.session.get.mock.calls,
    storage.session.set.mock.calls,
    storage.session.remove.mock.calls
  ]);
}

function mockNetworkObserver(start = vi.fn(async (_source: { readonly tabId: number }) => undefined)) {
  class NetworkObserver {
    beginSourceEpoch = vi.fn();
    captureCmdSnapshot = vi.fn(async () => undefined);
    ensureCompleteKsportBaseline = vi.fn(async () => true);
    focusSelection = vi.fn(async () => true);
    handleEvent = vi.fn(async () => undefined);
    hasCompleteKsportBaseline = vi.fn(() => true);
    hasCompleteSabaBaseline = vi.fn(() => true);
    heartbeat = vi.fn(async () => undefined);
    maintain = vi.fn(async () => undefined);
    maintainKsportFeed = vi.fn(async () => undefined);
    pollSabaDomChanges = vi.fn(async () => undefined);
    probeCmdHiddenMarkets = vi.fn(async () => undefined);
    probeSelectionPrice = vi.fn(async () => undefined);
    recoverCmdCatalog = vi.fn(async () => undefined);
    refreshCatalog = vi.fn(async () => undefined);
    releaseTab = vi.fn();
    start = start;
    stop = vi.fn(async () => undefined);
  }
  vi.doMock("./network-observer.js", () => ({ NetworkObserver }));
  return start;
}

describe("background source launch memory", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.doUnmock("./network-observer.js");
    vi.resetModules();
  });

  it("purges the legacy launch key without reading it and recovers KSPORT from current-worker memory", async () => {
    const signedUrl = "https://zenandfe.com/sportsbook?token=one-time-secret";
    const harness = createChromeHarness(signedUrl);
    vi.stubGlobal("chrome", harness.api);
    mockNetworkObserver();

    await import("./background.js");
    await settleWorkerStart(harness.storage);

    expect(harness.storage.session.remove).toHaveBeenCalledTimes(1);
    expect(harness.storage.session.remove).toHaveBeenCalledWith("sourceLaunchUrls");
    expect(harness.storage.session.get).not.toHaveBeenCalled();
    expect(harness.storage.session.set).not.toHaveBeenCalled();
    expect(serializedStorageCalls(harness.storage)).not.toContain(signedUrl);

    harness.storage.local.get.mockClear();
    harness.storage.local.set.mockClear();
    harness.storage.local.remove.mockClear();
    harness.storage.session.get.mockClear();
    harness.storage.session.set.mockClear();
    harness.storage.session.remove.mockClear();
    const response = new Promise<unknown>((resolve) => {
      const listener = harness.messages.listeners[0];
      expect(listener).toBeDefined();
      expect(listener!({ kind: "ENSURE_KSPORT" }, {}, resolve)).toBe(true);
    });

    await expect(response).resolves.toEqual({ ok: true });

    expect(harness.api.tabs.update).toHaveBeenCalledWith(8, {
      url: expect.stringContaining("token=one-time-secret")
    });
    expect(harness.storage.session.get).not.toHaveBeenCalled();
    expect(harness.storage.session.set).not.toHaveBeenCalled();
    expect(harness.storage.session.remove).not.toHaveBeenCalled();
    expect(serializedStorageCalls(harness.storage)).not.toContain(signedUrl);
  });

  it("continues reattaching preferred tabs after one observer startup fails", async () => {
    const harness = createChromeHarness("https://imsports.directsb.net/live");
    harness.api.tabs.query.mockResolvedValue([
      { id: 7, url: "https://imsports.directsb.net/live", title: "IM" },
      { id: 8, url: "https://prod20091.fxf774.com/vi/asian-view/today", title: "BTI" }
    ]);
    vi.stubGlobal("chrome", harness.api);
    const start = mockNetworkObserver(vi.fn(async (source: { readonly tabId: number }) => {
      if (source.tabId === 7) throw new Error("frame-command-timeout");
    }));

    await import("./background.js");
    await vi.advanceTimersByTimeAsync(25);

    expect(start.mock.calls.map(([source]) => source.tabId)).toEqual([7, 8]);
  });
});
