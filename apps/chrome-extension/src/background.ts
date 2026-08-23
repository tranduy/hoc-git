import type { ChromeLobbyId } from "@tool-chenh/contracts";
import { LocalBridge, type BridgeSocket } from "./local-bridge.js";
import { NetworkObserver, type ObservedSource } from "./network-observer.js";
import { recognizeLobbyTab, shouldPreserveKsportObserver,
  type TabDescriptor } from "./lobby-signatures.js";
import { TabRegistry } from "./tab-registry.js";
import { resolveInstallationKey } from "./bridge-key.js";
import { BridgeWakeup } from "./bridge-wakeup.js";
import { TabBootstrapper } from "./tab-bootstrapper.js";
import { recoverAttachedSource } from "./snapshot-recovery.js";
import { tabsNeedingContentScriptRefresh } from "./extension-update.js";
import { SourceTabKeepAlive } from "./source-tab-keepalive.js";
import { CmdSnapshotPoller } from "./cmd-snapshot-poller.js";
import { SourceTabRecovery } from "./source-tab-recovery.js";
import { FabetPortalLauncher } from "./fabet-portal-launcher.js";
import { retryImBootstrapRefresh } from "./im-bootstrap-refresh.js";
import { retrySabaBootstrapRefresh } from "./saba-bootstrap-refresh.js";

declare const __CHROME_BRIDGE_DEFAULT_KEY__: string;

let bridge: LocalBridge | null = null;
let configureInFlight: Promise<boolean> | null = null;
let restoreInFlight: Promise<void> | null = null;
const sourceLaunchUrlsKey = "sourceLaunchUrls";
const bootstrappingSourceTabs = new Set<number>();

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
}, {
  closeTab: async (tabId) => chrome.tabs.remove(tabId)
});

const sbobetEventRequestStorageKey = "sbobetEventRequestTemplate";
const sabaWsSnapshotsStorageKey = "sabaWsSnapshotsV1";
const observer = new NetworkObserver({
  sendCommand: async (tabId, method, params, sessionId) => chrome.debugger.sendCommand(
    sessionId === undefined ? { tabId } : { tabId, sessionId }, method, params),
  loadSbobetEventRequest: async () => {
    const value = (await chrome.storage.session.get(sbobetEventRequestStorageKey))[sbobetEventRequestStorageKey];
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const candidate = value as { readonly url?: unknown; readonly headers?: unknown };
    if (typeof candidate.url !== "string" || !candidate.headers || typeof candidate.headers !== "object" ||
      Array.isArray(candidate.headers) || Object.values(candidate.headers).some((item) => typeof item !== "string")) {
      return null;
    }
    return { url: candidate.url, headers: candidate.headers as Readonly<Record<string, string>> };
  },
  saveSbobetEventRequest: async (request) => {
    await chrome.storage.session.set({ [sbobetEventRequestStorageKey]: request });
  },
  loadSabaWsSnapshots: async (sourceId) => {
    const stored = (await chrome.storage.local.get(sabaWsSnapshotsStorageKey))[sabaWsSnapshotsStorageKey];
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) return null;
    const values = stored as Record<string, unknown>;
    return values[sourceId] ?? (values.sourceId === sourceId ? stored : null);
  },
  saveSabaWsSnapshots: async (snapshots) => {
    const stored = (await chrome.storage.local.get(sabaWsSnapshotsStorageKey))[sabaWsSnapshotsStorageKey];
    const values = stored && typeof stored === "object" && !Array.isArray(stored) && !("sourceId" in stored)
      ? stored as Record<string, unknown> : {};
    await chrome.storage.local.set({ [sabaWsSnapshotsStorageKey]: {
      ...values, [snapshots.sourceId]: snapshots
    } });
  },
  clearSabaWsSnapshots: async (sourceId) => {
    const stored = (await chrome.storage.local.get(sabaWsSnapshotsStorageKey))[sabaWsSnapshotsStorageKey];
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) return;
    const values = { ...stored as Record<string, unknown> };
    if (values.sourceId === sourceId) {
      await chrome.storage.local.remove(sabaWsSnapshotsStorageKey);
      return;
    }
    delete values[sourceId];
    await chrome.storage.local.set({ [sabaWsSnapshotsStorageKey]: values });
  },
  recoverImBaseline: async (source) => {
    // Obtain both signed GetSE partitions inside the current authenticated IM
    // page. Reloading changes source state and can discard the first partition.
    await observer.refreshCatalog(source);
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
  pollSabaDomChanges: async (source, hostname) => observer.pollSabaDomChanges(source, hostname),
  // KSPORT's periodic path must not reset a healthy sportsbook socket; only
  // explicit snapshot requests and recovery use the full refreshCatalog.
  refreshCatalog: async (source) => source.lobby === "KSPORT"
    ? observer.maintainKsportFeed(source)
    : observer.refreshCatalog(source)
});
snapshotPoller.start();

async function recoverSourceSnapshot(sourceId: string, beginEpoch: boolean): Promise<void> {
  const attached = registry.list().find((entry) => `chrome:${entry.lobby}:${entry.tabId}` === sourceId);
  if (!attached) return;
  if (beginEpoch) observer.beginSourceEpoch(sourceId);
  // Never replay cached response bytes with a new timestamp. A recovery must
  // prove freshness from the current page without consuming a launch URL.
  await recoverAttachedSource(attached, {
    capture: async (source) => observer.captureCmdSnapshot({
      lobby: source.lobby,
      sourceId,
      tabId: source.tabId
    }, source.hostname),
    refresh: async (source) => source.lobby === "TSPORT"
      ? observer.captureCmdSnapshot({ lobby: source.lobby, sourceId, tabId: source.tabId }, source.hostname)
      : observer.refreshCatalog({ lobby: source.lobby, sourceId, tabId: source.tabId }),
    reload: async (tabId) => chrome.tabs.reload(tabId)
  });
}

const tabBootstrapper = new TabBootstrapper({
  has: async (key) => (await chrome.storage.session.get(key))[key] === true,
  mark: async (key) => { await chrome.storage.session.set({ [key]: true }); },
  reload: async (tabId) => { await chrome.tabs.reload(tabId); }
});

async function attachRecoveredTab(tab: TabDescriptor): Promise<void> {
  await rememberRecognizedUrl(tab);
  const attached = await registry.attachSelected(tab);
  await startAttachedSource(attached);
}

async function startAttachedSource(attached: { readonly lobby: ChromeLobbyId; readonly tabId: number }): Promise<void> {
  const source: ObservedSource = {
    lobby: attached.lobby,
    tabId: attached.tabId,
    sourceId: `chrome:${attached.lobby}:${attached.tabId}`
  };
  await observer.start(source);
  if (source.lobby === "IM") {
    // The authenticated IM page can need several seconds before both signed
    // GetSE partitions become callable. Retry in-page capture during this
    // bounded bootstrap window; never navigate or reload the provider tab.
    void retryImBootstrapRefresh(() => observer.refreshCatalog(source));
  }
  if (source.lobby === "SABA") {
    // A Manifest V3 worker can restart while SABA's Socket.IO connection and
    // provider tab stay alive. CDP then misses the original socket creation
    // and baseline frames. Retry a same-tab lightweight baseline request while
    // the owning main-world/OOPIF contexts finish attaching; never reload the tab.
    void retrySabaBootstrapRefresh(() => observer.refreshCatalog(source));
  }
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

const fabetPortalLauncher = new FabetPortalLauncher({
  query: async () => chrome.tabs.query({}),
  update: async (tabId, url, active) => {
    const tab = await chrome.tabs.update(tabId, { url, active });
    if (!tab) throw new Error("FABET_PORTAL_TAB_UNAVAILABLE");
    return tab;
  },
  focusWindow: async (windowId) => { await chrome.windows.update(windowId, { focused: true }); },
  attachDebugger: async (tabId) => chrome.debugger.attach({ tabId }, "1.3"),
  detachDebugger: async (tabId) => chrome.debugger.detach({ tabId }),
  sendCommand: async (tabId, method, params) => chrome.debugger.sendCommand({ tabId }, method, params),
  addCreatedListener: (listener) => chrome.tabs.onCreated.addListener(listener),
  removeCreatedListener: (listener) => chrome.tabs.onCreated.removeListener(listener),
  addUpdatedListener: (listener) => chrome.tabs.onUpdated.addListener(listener),
  removeUpdatedListener: (listener) => chrome.tabs.onUpdated.removeListener(listener),
  attachSource: attachRecoveredTab,
  get: async (tabId) => chrome.tabs.get(tabId)
});

const sourceTabRecovery = new SourceTabRecovery({
  listAttached: () => registry.list(),
  query: async () => chrome.tabs.query({}),
  update: async (tabId, url) => {
    const tab = await chrome.tabs.update(tabId, { url });
    if (!tab) throw new Error("SOURCE_TAB_RECOVERY_FAILED");
    return tab;
  },
  create: async (url, active) => chrome.tabs.create({ url, active }),
  remove: async (tabId) => chrome.tabs.remove(tabId),
  get: async (tabId) => chrome.tabs.get(tabId),
  attach: attachRecoveredTab,
  attachBootstrap: async (tab, lobby) => {
    const attached = await registry.attachBootstrap(tab, lobby);
    await startAttachedSource(attached);
  },
  onBootstrapStart: (tabId) => {
    bootstrappingSourceTabs.add(tabId);
    setTimeout(() => bootstrappingSourceTabs.delete(tabId), 30_000);
  },
  onBootstrapFailure: (tabId) => { bootstrappingSourceTabs.delete(tabId); },
  validateReady: async (tab, lobby) => {
    if (lobby !== "KSPORT") return true;
    if (tab.id === undefined) return false;
    return observer.ensureCompleteKsportBaseline({ lobby: "KSPORT", tabId: tab.id,
      sourceId: `chrome:KSPORT:${tab.id}` });
  },
  launchFromPortal: async (lobby, sourceMarkerUrl) => {
    if (lobby !== "KSPORT") throw new Error("FABET_PORTAL_LAUNCH_UNSUPPORTED");
    return fabetPortalLauncher.launchKsport(sourceMarkerUrl);
  },
  // The operator supplied a working signed KSPORT launch directly. Consume
  // that URL in the provider tab; do not route this reset through Fabet or a
  // Cloudflare/login bootstrap first.
  usePortalLaunch: false,
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
      // A fresh API process can legitimately spend tens of seconds parsing
      // the first large provider baselines. Do not mistake that bootstrap for
      // a dead socket and replay the same work in a reconnect loop.
      livenessTimeoutMs: 120_000,
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
      // A reconnect must resume from new page traffic. Replaying every cached
      // provider payload floods a fresh API process with stale multi-megabyte
      // baselines and can exhaust its heap before live frames are accepted.
      onOpen: () => undefined,
      onSnapshotRequest: async (sourceId) => recoverSourceSnapshot(sourceId, false),
      onSourceResync: async (sourceId) => recoverSourceSnapshot(sourceId, true),
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
      onSelectionPriceProbe: async (request) => {
        const attached = registry.list().find((entry) => `chrome:${entry.lobby}:${entry.tabId}` === request.sourceId);
        if (!attached) throw new Error("SOURCE_NOT_ATTACHED");
        await observer.probeSelectionPrice({ lobby: attached.lobby, sourceId: request.sourceId,
          tabId: attached.tabId }, request);
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
  await reconcilePreferredTabs();
  await reattachPreferredTabs();
}

async function reconcilePreferredTabs(): Promise<void> {
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map(async (tab) => rememberRecognizedUrl(tab)));
  await registry.restore(tabs);
}

async function reattachPreferredTabs(): Promise<readonly string[]> {
  const sourceIds: string[] = [];
  for (const attached of registry.list()) {
    const source: ObservedSource = {
      lobby: attached.lobby,
      tabId: attached.tabId,
      sourceId: `chrome:${attached.lobby}:${attached.tabId}`
    };
    await observer.start(source);
    await tabBootstrapper.ensure(attached);
    await sourceTabKeepAlive.pulse(attached.tabId).catch(() => undefined);
    sourceIds.push(source.sourceId);
  }
  return sourceIds;
}

const bridgeWakeup = new BridgeWakeup({
  createAlarm: (name, info) => { void chrome.alarms.create(name, info); },
  addAlarmListener: (listener) => chrome.alarms.onAlarm.addListener(listener),
  reconcileTabs: reconcilePreferredTabs,
  ensureConnected: ensureBridgeConnected,
  ensureAttached: reattachPreferredTabs,
  pollNow: (sourceIds) => snapshotPoller.pollNow(sourceIds)
});
bridgeWakeup.start();

function sourceForTab(tabId: number): ObservedSource | null {
  const attached = registry.list().find((entry) => entry.tabId === tabId);
  return attached
    ? { lobby: attached.lobby, tabId, sourceId: `chrome:${attached.lobby}:${tabId}` }
    : null;
}

chrome.runtime.onInstalled.addListener((details) => {
  void (async () => {
    await bridgeWakeup.wakeNow();
    for (const tabId of tabsNeedingContentScriptRefresh(details.reason, registry.list())) {
      await chrome.tabs.reload(tabId);
    }
  })().catch(() => undefined);
});
chrome.runtime.onStartup.addListener(() => { void bridgeWakeup.wakeNow(); });

chrome.tabs.onRemoved.addListener((tabId) => {
  bootstrappingSourceTabs.delete(tabId);
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
  if (source) void observer.handleEvent(source, method, params, debuggee.sessionId);
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === "loading") {
    const descriptor = { id: tabId, url: tab.url, title: tab.title };
    const recognized = recognizeLobbyTab(descriptor);
    // Reset attaches the debugger while the replacement tab is still blank so
    // no one-time provider bootstrap response can be missed. Chrome may emit a
    // delayed about:blank loading event after that attachment; it is an
    // intermediate state, not a navigation away from the provider.
    if (bootstrappingSourceTabs.has(tabId) && recognized === null) return;
    if (recognized !== null) bootstrappingSourceTabs.delete(tabId);
    void rememberRecognizedUrl(descriptor);
    const source = sourceForTab(tabId);
    // The KSPORT sportsbook lives in a child target. Its outer one-time shell
    // can replace its own URL/title after the real live+today baseline is
    // already flowing. Do not tear down the child CDP observer on that shell
    // transition; a genuine unbaselined Volta/error tab is still rejected.
    if (source !== null && recognized === null && shouldPreserveKsportObserver(source.lobby,
      observer.hasCompleteKsportBaseline(source.sourceId))) return;
    if (source && recognized === null) {
      void observer.stop(source).finally(() => registry.handleNavigation(descriptor));
    } else {
      void registry.handleNavigation(descriptor).then(async () => {
        const recovered = sourceForTab(tabId);
        if (recovered !== null) await observer.start(recovered);
      });
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
    if (request.kind === "ENSURE_KSPORT") {
      const stored = await chrome.storage.session.get(sourceLaunchUrlsKey);
      const launches = stored[sourceLaunchUrlsKey];
      const url = launches && typeof launches === "object"
        ? (launches as Record<string, unknown>).KSPORT : null;
      if (typeof url !== "string") return sendResponse({ ok: false, reason: "KSPORT_LAUNCH_UNAVAILABLE" });
      await sourceTabRecovery.ensure("KSPORT", url);
      return sendResponse({ ok: true });
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
