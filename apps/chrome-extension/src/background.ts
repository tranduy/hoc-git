import type { ChromeLobbyId } from "@tool-chenh/contracts";
import { LocalBridge, type BridgeSocket } from "./local-bridge.js";
import { NetworkObserver, type ObservedSource } from "./network-observer.js";
import { recognizeLobbyTab, type TabDescriptor } from "./lobby-signatures.js";
import { TabRegistry } from "./tab-registry.js";
import { resolveInstallationKey } from "./bridge-key.js";
import { BridgeWakeup } from "./bridge-wakeup.js";
import { TabBootstrapper } from "./tab-bootstrapper.js";
import { recoverAttachedSource } from "./snapshot-recovery.js";
import { tabsNeedingContentScriptRefresh } from "./extension-update.js";
import { SourceTabKeepAlive } from "./source-tab-keepalive.js";
import { CmdSnapshotPoller } from "./cmd-snapshot-poller.js";
import { SourceTabRecovery } from "./source-tab-recovery.js";

declare const __CHROME_BRIDGE_DEFAULT_KEY__: string;

let bridge: LocalBridge | null = null;
let configureInFlight: Promise<boolean> | null = null;
let restoreInFlight: Promise<void> | null = null;
const sourceLaunchUrlsKey = "sourceLaunchUrls";

const sourceTabKeepAlive = new SourceTabKeepAlive({
  attach: async (tabId) => chrome.debugger.attach({ tabId }, "1.3"),
  detach: async (tabId) => chrome.debugger.detach({ tabId }),
  sendCommand: async (tabId, method, params) => {
    await chrome.debugger.sendCommand({ tabId }, method, params);
  }
});

const registry = new TabRegistry({
  attach: async (tabId) => sourceTabKeepAlive.attach(tabId),
  detach: async (tabId) => sourceTabKeepAlive.detach(tabId)
}, {
  load: async () => {
    const stored = await chrome.storage.local.get("tabPreferences");
    return stored.tabPreferences && typeof stored.tabPreferences === "object"
      ? stored.tabPreferences as Record<string, unknown>
      : {};
  },
  save: async (preferences) => {
    await chrome.storage.local.set({ tabPreferences: preferences });
  }
});

const observer = new NetworkObserver({
  sendCommand: async (tabId, method, params) => chrome.debugger.sendCommand({ tabId }, method, params),
  recoverImBaseline: async (source) => {
    // Reload only the affected IM tab, and only when deltas prove that the
    // extension has no replayable GetSE base. NetworkObserver rate-limits it.
    await chrome.tabs.reload(source.tabId);
  },
  forward: async (envelope) => {
    if (!bridge) throw new Error("BRIDGE_NOT_CONFIGURED");
    await bridge.enqueue(envelope, envelope.transport === "TAB_STATE" ? "DIAGNOSTIC" : "QUOTE");
  }
});

const snapshotPoller = new CmdSnapshotPoller({
  list: () => registry.list(),
  capture: async (source, hostname) => observer.captureCmdSnapshot(source, hostname),
  maintain: async (source) => observer.maintain(source),
  refreshCatalog: async (source) => observer.refreshCatalog(source)
});
snapshotPoller.start();

const tabBootstrapper = new TabBootstrapper({
  has: async (key) => (await chrome.storage.session.get(key))[key] === true,
  mark: async (key) => { await chrome.storage.session.set({ [key]: true }); },
  reload: async (tabId) => { await chrome.tabs.reload(tabId); }
});

async function attachRecoveredTab(tab: TabDescriptor): Promise<void> {
  await rememberRecognizedUrl(tab);
  const attached = await registry.attachSelected(tab);
  const source: ObservedSource = {
    lobby: attached.lobby,
    tabId: attached.tabId,
    sourceId: `chrome:${attached.lobby}:${attached.tabId}`
  };
  await observer.start(source);
  // A recovered provider launch can be one-time. Reloading it here consumes
  // the restored navigation and can make the provider close the tab again.
  // The current extension worker already owns the observer, so attach it
  // directly and reserve bootstrap reloads for normal startup restoration.
  await sourceTabKeepAlive.pulse(attached.tabId).catch(() => undefined);
}

async function rememberRecognizedUrl(tab: TabDescriptor): Promise<void> {
  const recognized = recognizeLobbyTab(tab);
  if (!recognized || !tab.url) return;
  const stored = await chrome.storage.session.get(sourceLaunchUrlsKey);
  const current = stored[sourceLaunchUrlsKey] && typeof stored[sourceLaunchUrlsKey] === "object"
    ? stored[sourceLaunchUrlsKey] as Record<string, unknown>
    : {};
  await chrome.storage.session.set({ [sourceLaunchUrlsKey]: { ...current, [recognized.lobby]: tab.url } });
}

const sourceTabRecovery = new SourceTabRecovery({
  listAttached: () => registry.list(),
  query: async () => chrome.tabs.query({}),
  update: async (tabId, url) => {
    const tab = await chrome.tabs.update(tabId, { url });
    if (!tab) throw new Error("SOURCE_TAB_RECOVERY_FAILED");
    return tab;
  },
  create: async (url, active) => chrome.tabs.create({ url, active }),
  get: async (tabId) => chrome.tabs.get(tabId),
  attach: attachRecoveredTab,
  recentlyClosed: async () => (await chrome.sessions.getRecentlyClosed({ maxResults: 25 })).map((session) => {
    const sessionId = session.tab?.sessionId ?? session.window?.sessionId;
    return {
      ...(sessionId === undefined ? {} : { sessionId }),
      ...(session.tab === undefined ? {} : { tab: session.tab }),
      ...(session.window?.tabs === undefined ? {} : { window: { tabs: session.window.tabs } })
    };
  }),
  restore: async (sessionId) => {
    const restored = await chrome.sessions.restore(sessionId);
    const tabs = [restored.tab, ...(restored.window?.tabs ?? [])].filter((tab): tab is chrome.tabs.Tab => tab !== undefined);
    const tab = tabs.find((candidate) => recognizeLobbyTab(candidate) !== null);
    if (!tab) throw new Error("SOURCE_TAB_RECOVERY_FAILED");
    return tab;
  },
  loadRemembered: async (lobby) => {
    const stored = await chrome.storage.session.get(sourceLaunchUrlsKey);
    const launches = stored[sourceLaunchUrlsKey];
    if (!launches || typeof launches !== "object") return null;
    const url = (launches as Record<string, unknown>)[lobby];
    return typeof url === "string" ? url : null;
  },
  // CMD's authenticated sports page uses the existing Chrome cookie session.
  // This canonical entry lets the very first reset recover even when the tab
  // was closed before this extension version had a chance to remember its URL.
  fallbackUrl: (lobby) => lobby === "CMD"
    ? "https://cgnew.fts368.com/DomainNames/cgnew/home.aspx"
    : null
});

setInterval(() => {
  // Chrome can throttle a short standalone MV3 interval. Reuse this proven
  // heartbeat wake-up so catalog refresh/capture cannot silently stop while
  // tab heartbeats continue to look healthy.
  snapshotPoller.pollNow();
  for (const attached of registry.list()) {
    void sourceTabKeepAlive.pulse(attached.tabId).catch(() => undefined);
    void observer.heartbeat({
      lobby: attached.lobby,
      tabId: attached.tabId,
      sourceId: `chrome:${attached.lobby}:${attached.tabId}`
    }, attached.hostname).catch(() => undefined);
  }
}, 10_000);

async function configureBridge(force = false): Promise<boolean> {
  if (!force && bridge !== null) return true;
  if (configureInFlight !== null) return configureInFlight;
  const operation = configureBridgeOnce().finally(() => {
    if (configureInFlight === operation) configureInFlight = null;
  });
  configureInFlight = operation;
  return operation;
}

async function configureBridgeOnce(): Promise<boolean> {
  const stored = await chrome.storage.local.get("installationKey");
  const bundledKey = typeof __CHROME_BRIDGE_DEFAULT_KEY__ === "string"
    ? __CHROME_BRIDGE_DEFAULT_KEY__
    : "";
  const installationKey = resolveInstallationKey(stored.installationKey, bundledKey);
  if (!stored.installationKey && installationKey) {
    await chrome.storage.local.set({ installationKey });
  }
  bridge?.close();
  bridge = installationKey
    ? new LocalBridge({
      installationKey,
      readinessProbe: async () => {
        try {
          const response = await fetch("http://127.0.0.1:4310/api/health", {
            cache: "no-store",
            signal: AbortSignal.timeout(1_500)
          });
          return response.ok;
        } catch {
          return false;
        }
      },
      socketFactory: (url, protocols) => new WebSocket(url, protocols) as unknown as BridgeSocket,
      onSnapshotRequest: async (sourceId) => {
        const attached = registry.list().find((entry) => `chrome:${entry.lobby}:${entry.tabId}` === sourceId);
        if (!attached) return;
        // Never replay cached response bytes with a new timestamp. A recovery
        // must prove freshness from the current page DOM or from a tab reload.
        await recoverAttachedSource(attached, {
          capture: async (source) => observer.captureCmdSnapshot({
            lobby: source.lobby,
            sourceId,
            tabId: source.tabId
          }, source.hostname),
          reload: async (tabId) => chrome.tabs.reload(tabId)
        });
      },
      onSourceReload: async (sourceId) => {
        const attached = registry.list().find((entry) => `chrome:${entry.lobby}:${entry.tabId}` === sourceId);
        if (attached) await chrome.tabs.reload(attached.tabId);
      },
      onSourceNavigate: async (sourceId, url) => {
        const attached = registry.list().find((entry) => `chrome:${entry.lobby}:${entry.tabId}` === sourceId);
        if (!attached) throw new Error("SOURCE_NOT_ATTACHED");
        const parsed = new URL(url);
        const recognized = recognizeLobbyTab({ id: attached.tabId, url });
        if (parsed.protocol !== "https:" || parsed.username || parsed.password ||
          recognized?.lobby !== attached.lobby) throw new Error("UNTRUSTED_LAUNCH_URL");
        await chrome.tabs.update(attached.tabId, { url });
      },
      onSourceEnsure: async (lobby, url) => sourceTabRecovery.ensure(lobby, url),
      onSourceRestore: async (lobby) => sourceTabRecovery.restore(lobby),
      onFocusSelection: async (request) => {
        const attached = registry.list().find((entry) => `chrome:${entry.lobby}:${entry.tabId}` === request.sourceId);
        if (!attached) throw new Error("SOURCE_NOT_ATTACHED");
        const tab = await chrome.tabs.get(attached.tabId);
        if (tab.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true });
        await chrome.tabs.update(attached.tabId, { active: true });
        const focused = await observer.focusSelection({ lobby: attached.lobby, sourceId: request.sourceId,
          tabId: attached.tabId }, request);
        // Every action always opens the correct attached provider tab. CMD and
        // providers exposing an exact DOM identity also scroll/highlight the
        // selection; an opaque network-only ID remains read-only and unclicked.
        if (!focused && attached.lobby === "CMD") throw new Error("EXACT_SELECTION_NOT_FOUND");
      },
      onCmdHiddenMarketProbe: async (request) => {
        const attached = registry.list().find((entry) => `chrome:${entry.lobby}:${entry.tabId}` === request.sourceId);
        if (!attached || attached.lobby !== "CMD") throw new Error("SOURCE_NOT_ATTACHED");
        await observer.probeCmdHiddenMarkets({ lobby: "CMD", sourceId: request.sourceId,
          tabId: attached.tabId }, { requestId: request.requestId, providerEventId: request.providerEventId });
      }
    })
    : null;
  bridge?.connect();
  return bridge !== null;
}

async function ensureBridgeConnected(): Promise<boolean> {
  if (bridge === null) return configureBridge();
  bridge.connect();
  return true;
}

async function restorePreferredTabs(): Promise<void> {
  if (restoreInFlight !== null) return restoreInFlight;
  const operation = restorePreferredTabsOnce().finally(() => {
    if (restoreInFlight === operation) restoreInFlight = null;
  });
  restoreInFlight = operation;
  return operation;
}

async function restorePreferredTabsOnce(): Promise<void> {
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map(async (tab) => rememberRecognizedUrl(tab)));
  const restored = await registry.restore(tabs);
  for (const attached of restored) {
    const source: ObservedSource = {
      lobby: attached.lobby,
      tabId: attached.tabId,
      sourceId: `chrome:${attached.lobby}:${attached.tabId}`
    };
    await observer.start(source);
    await tabBootstrapper.ensure(attached);
    await sourceTabKeepAlive.pulse(attached.tabId).catch(() => undefined);
  }
}

new BridgeWakeup({
  createAlarm: (name, info) => { void chrome.alarms.create(name, info); },
  addAlarmListener: (listener) => chrome.alarms.onAlarm.addListener(listener),
  ensureConnected: ensureBridgeConnected,
  ensureAttached: restorePreferredTabs
}).start();

function sourceForTab(tabId: number): ObservedSource | null {
  const attached = registry.list().find((entry) => entry.tabId === tabId);
  return attached
    ? { lobby: attached.lobby, tabId, sourceId: `chrome:${attached.lobby}:${tabId}` }
    : null;
}

chrome.runtime.onInstalled.addListener((details) => {
  void (async () => {
    await configureBridge();
    await restorePreferredTabs();
    for (const tabId of tabsNeedingContentScriptRefresh(details.reason, registry.list())) {
      await chrome.tabs.reload(tabId);
    }
  })().catch(() => undefined);
});
chrome.runtime.onStartup.addListener(() => { void configureBridge(); });
void (async () => {
  await configureBridge();
  await restorePreferredTabs();
})();

chrome.tabs.onRemoved.addListener((tabId) => {
  observer.releaseTab(tabId);
  void registry.handleRemoved(tabId);
});
chrome.debugger.onDetach.addListener((debuggee) => {
  if (debuggee.tabId !== undefined) {
    observer.releaseTab(debuggee.tabId);
    registry.handleDebuggerDetached(debuggee.tabId);
  }
});
chrome.debugger.onEvent.addListener((debuggee, method, params) => {
  if (debuggee.tabId === undefined) return;
  const source = sourceForTab(debuggee.tabId);
  if (source) void observer.handleEvent(source, method, params);
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === "loading") {
    const descriptor = { id: tabId, url: tab.url, title: tab.title };
    void rememberRecognizedUrl(descriptor);
    const source = sourceForTab(tabId);
    if (source && recognizeLobbyTab(descriptor) === null) {
      void observer.stop(source).finally(() => registry.handleNavigation(descriptor));
    } else {
      void registry.handleNavigation(descriptor);
    }
  }
});

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  void (async () => {
    if (!message || typeof message !== "object") return sendResponse({ ok: false });
    const request = message as Record<string, unknown>;
    if (request.kind === "STATUS") {
      const tabs = await chrome.tabs.query({});
      const candidates = tabs.map(recognizeLobbyTab).filter((value) => value !== null);
      return sendResponse({ ok: true, configured: bridge !== null, candidates, attached: registry.list() });
    }
    if (request.kind === "SAVE_KEY" && typeof request.installationKey === "string") {
      await chrome.storage.local.set({ installationKey: request.installationKey.trim() });
      return sendResponse({ ok: await configureBridge(true) });
    }
    if (request.kind === "ATTACH_TAB" && Number.isSafeInteger(request.tabId)) {
      const tab = await chrome.tabs.get(request.tabId as number);
      const attached = await registry.attachSelected(tab);
      const source: ObservedSource = {
        lobby: attached.lobby as ChromeLobbyId,
        tabId: attached.tabId,
        sourceId: `chrome:${attached.lobby}:${attached.tabId}`
      };
      await observer.start(source);
      await tabBootstrapper.ensure(attached);
      return sendResponse({ ok: true, attached });
    }
    if (request.kind === "ATTACH_ALL") {
      const tabs = await chrome.tabs.query({});
      const attached = [];
      for (const tab of tabs) {
        if (recognizeLobbyTab(tab) === null) continue;
        try {
          const entry = await registry.attachSelected(tab);
          await observer.start({
            lobby: entry.lobby as ChromeLobbyId,
            tabId: entry.tabId,
            sourceId: `chrome:${entry.lobby}:${entry.tabId}`
          });
          await tabBootstrapper.ensure(entry);
          attached.push(entry);
        } catch { /* one unavailable tab must not block the other lobbies */ }
      }
      return sendResponse({ ok: true, attached });
    }
    return sendResponse({ ok: false });
  })().catch((error: unknown) => sendResponse({
    ok: false,
    error: error instanceof Error ? error.message.replace(/https?:\/\/\S+/gu, "[URL]") : "UNKNOWN"
  }));
  return true;
});
