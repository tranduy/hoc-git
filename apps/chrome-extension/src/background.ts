import type { ChromeLobbyId } from "@tool-chenh/contracts";
import { LocalBridge, type BridgeSocket } from "./local-bridge.js";
import { NetworkObserver, type ObservedSource } from "./network-observer.js";
import { recognizeExpectedLobbyTab, recognizeLobbyTab, shouldPreserveKsportObserver,
  shouldPreserveSabaObserver, type TabDescriptor } from "./lobby-signatures.js";
import { TabRegistry } from "./tab-registry.js";
import { resolveInstallationKey } from "./bridge-key.js";
import { BridgeWakeup } from "./bridge-wakeup.js";
import { WakeTriggers } from "./wake-triggers.js";
import { HEARTBEAT_SCRIPT, injectHeartbeatIntoOpenLobbies } from "./lobby-heartbeat-injection.js";
import { TabBootstrapper } from "./tab-bootstrapper.js";
import { recoverAttachedSource } from "./snapshot-recovery.js";
import { tabsNeedingContentScriptRefresh } from "./extension-update.js";
import { SourceTabKeepAlive } from "./source-tab-keepalive.js";
import { CmdSnapshotPoller } from "./cmd-snapshot-poller.js";
import { SABA_DIRECT_LOBBY_URL, SourceTabRecovery } from "./source-tab-recovery.js";
import { retryImBootstrapRefresh } from "./im-bootstrap-refresh.js";
import { retrySabaBootstrapRefresh } from "./saba-bootstrap-refresh.js";
import { bootstrapCatalogSources, refreshBootstrapCatalogSources } from "./bootstrap-catalog-refresh.js";
import { SabaSnapshotStorage } from "./saba-snapshot-storage.js";
import { SourceLaunchMemory } from "./source-launch-memory.js";
import { extensionLobbyScope, lobbyIsInExtensionScope } from "./extension-lobby-scope.js";
import { runDebuggerEventTask } from "./debugger-event-task.js";
import { ApsportPageRecoveryWatchdog } from "./apsport-page-recovery.js";
import { BtiPageRecoveryWatchdog, btiHardRecoveryAction } from "./bti-page-health.js";
import { CmdPageKeepalive, SourceActivityGuard, parseCmdPageKeepaliveState,
  recoverCmdTab, replaceExactCmdTab } from "./cmd-page-keepalive.js";
import { ProviderPageLeaseCoordinator, isRenewableLobby, parseProviderPageLeaseState,
  renewExactProviderTab, type RenewableLobby } from "./provider-page-lease.js";
import { recoverUnexpectedDebuggerDetach } from "./debugger-detach-recovery.js";
import { reloadAttachedSourceTab } from "./source-tab-reload.js";

declare const __CHROME_BRIDGE_DEFAULT_KEY__: string;
declare const __CHROME_EXTENSION_BUILD_IDENTITY__: string;

const runtimeLobbyScope = extensionLobbyScope(chrome.runtime.getManifest().name);

function lobbyIsAllowed(lobby: ChromeLobbyId): boolean {
  return lobbyIsInExtensionScope(lobby, runtimeLobbyScope);
}

// First, before anything else this module builds. An alarm registered at the
// end of a long initialisation is only as reliable as every constructor ahead
// of it: one throw and the worker keeps being collected with no way back in,
// silently, for as long as the browser stays open.
const wakeTriggers = new WakeTriggers({
  createAlarm: (name, info) => { void chrome.alarms.create(name, info); },
  addAlarmListener: (listener) => chrome.alarms.onAlarm.addListener(listener),
  addMessageListener: (listener) => chrome.runtime.onMessage.addListener((message) => {
    listener(message);
    return false;
  })
});

let bridge: LocalBridge | null = null;
let configureInFlight: Promise<boolean> | null = null;
let restoreInFlight: Promise<void> | null = null;
const legacySourceLaunchUrlsKey = "sourceLaunchUrls";
const cmdPageKeepaliveStorageKey = "cmdPageKeepaliveV1";
const providerPageLeaseStorageKey = "providerPageLeaseV1";
const sourceLaunchMemory = new SourceLaunchMemory();
const bootstrappingSourceTabs = new Set<number>();
const cmdPageActivity = new SourceActivityGuard();

// Earlier versions persisted signed provider launches. Purge that opaque
// legacy value without reading it; this worker rebuilds memory only from open
// recognized tabs, then otherwise relies on browser-session recovery or fails closed.
const legacySourceLaunchUrlsPurge = chrome.storage.session.remove(legacySourceLaunchUrlsKey).catch(() => undefined);

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

const sabaWsSnapshotsStorageKey = "sabaWsSnapshotsV1";
const sabaSnapshotStorage = new SabaSnapshotStorage({
  get: async (key) => chrome.storage.local.get(key),
  set: async (items) => chrome.storage.local.set(items),
  remove: async (key) => chrome.storage.local.remove(key)
}, sabaWsSnapshotsStorageKey);
let observer!: NetworkObserver;
let providerPageLeaseCoordinator!: ProviderPageLeaseCoordinator;
const apsportPageRecovery = new ApsportPageRecoveryWatchdog({
  reload: async (tabId) => {
    const attached = registry.list().find((source) => source.lobby === "TSPORT" && source.tabId === tabId);
    if (attached === undefined) return;
    await providerPageLeaseCoordinator.renewNow({ lobby: "TSPORT",
      sourceId: `chrome:TSPORT:${tabId}`, tabId });
  }
});
const btiPageRecovery = new BtiPageRecoveryWatchdog({
  reload: async ({ sourceId, tabId }) => {
    const attached = registry.list().find((source) => source.lobby === "BTI" &&
      source.tabId === tabId && sourceId === `chrome:BTI:${source.tabId}`);
    if (attached === undefined) return;
    await providerPageLeaseCoordinator.renewNow({ lobby: "BTI", sourceId, tabId });
  }
});
observer = new NetworkObserver({
  sendCommand: async (tabId, method, params, sessionId) => chrome.debugger.sendCommand(
    sessionId === undefined ? { tabId } : { tabId, sessionId }, method, params),
  loadSabaWsSnapshots: (sourceId) => sabaSnapshotStorage.load(sourceId),
  saveSabaWsSnapshots: (snapshots) => sabaSnapshotStorage.save(snapshots),
  clearSabaWsSnapshots: (sourceId) => sabaSnapshotStorage.clear(sourceId),
  onApsportPageHealth: (health) => {
    void apsportPageRecovery.observe(health).catch((error) => {
      console.warn("APSPORT empty-page recovery failed", error);
    });
  },
  onApsportOrphanSocket: async (source) => {
    const attached = registry.list().find((entry) => entry.lobby === "TSPORT" &&
      entry.tabId === source.tabId && source.sourceId === `chrome:TSPORT:${entry.tabId}`);
    if (attached === undefined) return;
    await providerPageLeaseCoordinator.renewNow({ lobby: "TSPORT",
      sourceId: source.sourceId, tabId: source.tabId });
  },
  onBtiPageHealth: (health) => {
    void btiPageRecovery.observe(health).catch((error) => {
      console.warn("BTI auth-page recovery failed", error);
    });
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
    : source.lobby === "TSPORT"
      // APSPORT's all-event detail walk can outlive the four-minute catalog
      // lease. Periodic work must preempt that walk with a fresh bounded roster
      // instead of deduplicating behind it while live socket deltas get rejected.
      ? observer.refreshCatalog(source, { rosterOnly: true })
    : observer.refreshCatalog(source),
  recoverCmdCatalog: async (source) => observer.recoverCmdCatalog(source),
  reportWorkHealth: async (source, health) => observer.emitWorkHealth(source, health),
  log: (message) => console.warn(message)
});
snapshotPoller.start();

async function recoverSourceSnapshot(request: { readonly sourceId: string;
  readonly prematchWindowHours?: number | undefined }): Promise<void> {
  const { sourceId } = request;
  const attached = registry.list().find((entry) => `chrome:${entry.lobby}:${entry.tabId}` === sourceId);
  if (!attached) return;
  // A replacement local API has no baseline while APSPORT's current roster
  // request can fail transiently even though its event socket remains alive.
  // Replay the last completed roster first, preserving its original timestamp,
  // then still request the current roster below. An already-running API cannot
  // mistake the replay for newer provider evidence.
  if (attached.lobby === "TSPORT") {
    await observer.replaySnapshots(sourceId).catch(() => false);
  }
  await recoverAttachedSource(attached, {
    capture: async (source) => observer.captureCmdSnapshot({
      lobby: source.lobby,
      sourceId,
      tabId: source.tabId
    }, source.hostname),
    refresh: async (source) => observer.refreshCatalog({
      lobby: source.lobby, sourceId, tabId: source.tabId
    }, { prematchWindowHours: request.prematchWindowHours ?? 24,
      ...(source.lobby === "TSPORT" ? { rosterOnly: true } : {}) }),
    reload: async (tabId) => chrome.tabs.reload(tabId)
  });
}

const tabBootstrapper = new TabBootstrapper({
  has: async (key) => (await chrome.storage.session.get(key))[key] === true,
  mark: async (key) => { await chrome.storage.session.set({ [key]: true }); },
  reload: async (tabId) => { await chrome.tabs.reload(tabId); }
});

async function attachRecoveredTab(tab: TabDescriptor): Promise<void> {
  const recognized = recognizeLobbyTab(tab);
  if (recognized === null || !lobbyIsAllowed(recognized.lobby)) throw new Error("LOBBY_OUT_OF_SCOPE");
  await rememberRecognizedUrl(tab);
  const attached = await registry.attachSelected(tab);
  await startAttachedSource(attached);
}

async function attachRecoveredTabAsExpected(tab: TabDescriptor, lobby: ChromeLobbyId): Promise<void> {
  const recognized = recognizeExpectedLobbyTab(tab, lobby);
  if (recognized?.lobby !== lobby || !lobbyIsAllowed(lobby)) throw new Error("LOBBY_OUT_OF_SCOPE");
  await rememberRecognizedUrl(tab);
  const attached = await registry.attachBootstrap(tab, lobby);
  await startAttachedSource(attached);
}

async function startAttachedSource(attached: { readonly lobby: ChromeLobbyId; readonly tabId: number }): Promise<void> {
  if (!lobbyIsAllowed(attached.lobby)) throw new Error("LOBBY_OUT_OF_SCOPE");
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
    void retrySabaBootstrapRefresh(
      () => observer.refreshCatalog(source),
      () => observer.hasCompleteSabaBaseline(source.sourceId)
    );
  }
  // A recovered provider launch can be one-time. Reloading it here consumes
  // the restored navigation and can make the provider close the tab again.
  // The current extension worker already owns the observer, so attach it
  // directly and reserve bootstrap reloads for normal startup restoration.
  await sourceTabKeepAlive.pulse(attached.tabId).catch(() => undefined);
}

function rememberRecognizedUrl(tab: TabDescriptor): void {
  sourceLaunchMemory.rememberRecognized(tab);
}

const sourceTabRecovery = new SourceTabRecovery({
  listAttached: () => registry.list(),
  query: async () => chrome.tabs.query({}),
  update: async (tabId, url) => {
    const tab = await chrome.tabs.update(tabId, { url });
    if (!tab) throw new Error("SOURCE_TAB_RECOVERY_FAILED");
    return tab;
  },
  reload: async (tabId, lobby) => reloadAttachedSourceTab(tabId, lobby, {
    reloadDebugTarget: async (attachedTabId) => {
      await observer.resetSabaSocketWorker({ lobby: "SABA", tabId: attachedTabId,
        sourceId: `chrome:SABA:${attachedTabId}` });
      await new Promise<void>((resolve) => setTimeout(resolve, 500));
      await chrome.debugger.sendCommand({ tabId: attachedTabId }, "Page.reload", { ignoreCache: false });
    },
    reloadBrowserTab: async (browserTabId) => { await chrome.tabs.reload(browserTabId); },
    get: async (currentTabId) => chrome.tabs.get(currentTabId)
  }),
  create: async (url, active) => chrome.tabs.create({ url, active }),
  remove: async (tabId) => chrome.tabs.remove(tabId),
  get: async (tabId) => chrome.tabs.get(tabId),
  attach: attachRecoveredTab,
  attachBootstrap: async (tab, lobby) => {
    await attachRecoveredTabAsExpected(tab, lobby);
  },
  beginSourceEpoch: (sourceId) => { observer.beginSourceEpoch(sourceId); },
  onBootstrapStart: (tabId) => {
    bootstrappingSourceTabs.add(tabId);
    setTimeout(() => bootstrappingSourceTabs.delete(tabId), 30_000);
  },
  onBootstrapFailure: (tabId) => { bootstrappingSourceTabs.delete(tabId); },
  validateReady: async (tab, lobby) => {
    if (tab.id === undefined) return false;
    if (lobby === "SABA") return observer.hasCompleteSabaBaseline(`chrome:SABA:${tab.id}`);
    if (lobby !== "KSPORT") return true;
    return observer.ensureCompleteKsportBaseline({ lobby: "KSPORT", tabId: tab.id,
      sourceId: `chrome:KSPORT:${tab.id}` });
  },
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
  loadRemembered: async (lobby) => sourceLaunchMemory.load(lobby),
  // CMD's authenticated sports page uses the existing Chrome cookie session.
  // This canonical entry lets the very first reset recover even when the tab
  // was closed before this extension version had a chance to remember its URL.
  fallbackUrl: (lobby) => lobby === "CMD"
    ? "https://cgnew.fts368.com/BasePage/home.aspx"
    : lobby === "SABA"
      ? SABA_DIRECT_LOBBY_URL
    : null
});

providerPageLeaseCoordinator = new ProviderPageLeaseCoordinator({
  listAttached: () => registry.list().flatMap((entry) => isRenewableLobby(entry.lobby)
    ? [{ lobby: entry.lobby, sourceId: `chrome:${entry.lobby}:${entry.tabId}`, tabId: entry.tabId }]
    : []),
  isLoading: async (tabId) => (await chrome.tabs.get(tabId)).status === "loading",
  loadState: async () => {
    const stored = await chrome.storage.local.get(providerPageLeaseStorageKey);
    return parseProviderPageLeaseState(stored[providerPageLeaseStorageKey]);
  },
  saveState: async (state) => {
    await chrome.storage.local.set({ [providerPageLeaseStorageKey]: state });
  },
  renew: (source) => renewExactProviderTab(source, {
    isAttached: (candidate) => registry.list().some((entry) => entry.lobby === candidate.lobby &&
      entry.tabId === candidate.tabId && candidate.sourceId === `chrome:${entry.lobby}:${entry.tabId}`),
    get: async (tabId) => chrome.tabs.get(tabId),
    attachBootstrap: (tab, lobby) => attachRecoveredTabAsExpected(tab, lobby),
    beginSourceEpoch: (sourceId) => {
      observer.beginSourceEpoch(sourceId);
      if (sourceId.startsWith("chrome:TSPORT:")) observer.resetApsportRefreshCooldown(sourceId);
    },
    update: async (tabId, url) => {
      const tab = await chrome.tabs.update(tabId, { url });
      if (!tab) throw new Error("PROVIDER_PAGE_RENEWAL_FAILED");
      return tab;
    },
    waitForReady: waitForRenewedProviderTab
  })
});

async function waitForRenewedProviderTab(tabId: number, lobby: RenewableLobby): Promise<TabDescriptor> {
  const deadlineMs = Date.now() + 30_000;
  while (Date.now() < deadlineMs) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === "complete" && recognizeExpectedLobbyTab(tab, lobby)?.lobby === lobby) {
      if (lobby !== "BTI") return tab;
      const health = await observer.probeBtiPageHealth({ lobby: "BTI", tabId,
        sourceId: `chrome:BTI:${tabId}` });
      if (health?.status === "AUTH_ERROR") throw new Error("BTI_PROVIDER_AUTH_FAILED_1008");
      if (health?.status === "HEALTHY") return tab;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("PROVIDER_PAGE_RENEWAL_TIMEOUT");
}

async function waitForFreshCmdBaseline(tabId: number, recoveryStartedAtMs: number): Promise<boolean> {
  const deadlineMs = Date.now() + 30_000;
  const source: ObservedSource = { lobby: "CMD", tabId, sourceId: `chrome:CMD:${tabId}` };
  while (Date.now() < deadlineMs) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === "complete" && recognizeExpectedLobbyTab(tab, "CMD")?.lobby === "CMD") {
        await observer.recoverCmdCatalog(source);
        if (observer.hasCompleteCmdBaselineSince(source.sourceId, recoveryStartedAtMs)) return true;
      }
    } catch {
      // A crashed renderer can keep its tab entry while its target is absent.
      // The bounded caller will replace it if no full baseline is observed.
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

const cmdPageKeepalive = new CmdPageKeepalive({
  listAttached: () => registry.list().flatMap((entry) => entry.lobby === "CMD"
    ? [{ lobby: "CMD" as const, sourceId: `chrome:CMD:${entry.tabId}`, tabId: entry.tabId }]
    : []),
  isBusy: (sourceId) => cmdPageActivity.isBusy(sourceId),
  tryRunExclusive: (sourceId, operation) => cmdPageActivity.tryRunExclusive(sourceId, operation),
  runExclusive: (sourceId, operation) => cmdPageActivity.runExclusive(sourceId, operation),
  isLoading: async (tabId) => (await chrome.tabs.get(tabId)).status === "loading",
  loadState: async () => {
    const stored = await chrome.storage.local.get(cmdPageKeepaliveStorageKey);
    return parseCmdPageKeepaliveState(stored[cmdPageKeepaliveStorageKey]);
  },
  saveState: async (state) => {
    await chrome.storage.local.set({ [cmdPageKeepaliveStorageKey]: state });
  },
  reload: (source) => {
    const recoveryStartedAtMs = Date.now();
    const isExactAttached = (candidate: typeof source): boolean => registry.list().some((entry) =>
      entry.lobby === "CMD" && entry.tabId === candidate.tabId &&
      candidate.sourceId === `chrome:CMD:${entry.tabId}`);
    return recoverCmdTab(source, {
      isAttached: isExactAttached,
      get: async (tabId) => chrome.tabs.get(tabId),
      isExpected: (tab) => recognizeExpectedLobbyTab(tab, "CMD")?.lobby === "CMD",
      attachBootstrap: (tab) => attachRecoveredTabAsExpected(tab, "CMD"),
      reload: async (tabId, url) => {
        if (url === undefined) await chrome.tabs.reload(tabId);
        else await chrome.tabs.update(tabId, { url });
      },
      replace: (failedTabId) => replaceExactCmdTab(source, {
        // A reload can briefly detach the dead target before replacement. It
        // remains safe to remove only while no different CMD source took over.
        isAttached: (candidate) => {
          const attachedCmd = registry.list().filter((entry) => entry.lobby === "CMD");
          return attachedCmd.length === 0 || attachedCmd.some((entry) => entry.tabId === candidate.tabId &&
            candidate.sourceId === `chrome:CMD:${entry.tabId}`);
        },
        get: async (tabId) => chrome.tabs.get(tabId),
        isExpected: (tab) => recognizeExpectedLobbyTab(tab, "CMD")?.lobby === "CMD",
        remove: async (tabId) => {
          const staleSource = sourceForTab(tabId);
          if (staleSource !== null) bridge?.releaseSource(staleSource.sourceId);
          await chrome.tabs.remove(tabId);
          observer.releaseTab(tabId);
          await registry.handleRemoved(tabId);
        },
        create: async (url, active) => chrome.tabs.create({ url, active }),
        attachBootstrap: (tab) => attachRecoveredTabAsExpected(tab, "CMD"),
        update: async (tabId, url) => {
          const tab = await chrome.tabs.update(tabId, { url });
          if (!tab) throw new Error("CMD_SOURCE_RECOVERY_FAILED");
          return tab;
        }
      }),
      waitForFreshBaseline: (tabId) => waitForFreshCmdBaseline(tabId, recoveryStartedAtMs)
    });
  }
});

setInterval(() => {
  // Chrome can throttle a short standalone MV3 interval. Reuse this proven
  // heartbeat wake-up so catalog refresh/capture cannot silently stop while
  // tab heartbeats continue to look healthy.
  snapshotPoller.pollNow();
  void cmdPageKeepalive.tick().catch(() => undefined).then(() => providerPageLeaseCoordinator.tick());
  for (const attached of registry.list()) {
    void sourceTabKeepAlive.pulse(attached.tabId).catch(() => undefined);
    void observer.heartbeat({
      lobby: attached.lobby,
      tabId: attached.tabId,
      sourceId: `chrome:${attached.lobby}:${attached.tabId}`
    }, attached.hostname).catch(() => undefined);
  }
}, 10_000);

async function refreshBootstrapCatalogs(): Promise<void> {
  await refreshBootstrapCatalogSources(bootstrapCatalogSources(registry.list()),
    (source) => observer.refreshCatalog(source,
      source.lobby === "TSPORT" ? { rosterOnly: true } : {}));
}

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
      //
      // Asking the page for a current baseline is not that replay, and some
      // books need it: a fresh API process starts with no catalog while the
      // worker, the tab and the provider socket all stay alive, so a book that
      // publishes its full list only when the page bootstraps is never sent one
      // again. Measured 2026-08-27: after an API restart SABA fell from 86
      // events with 19 upcoming to 68 with 4, and stayed there - its whole
      // pre-match list gone, which is most of what another book can be
      // compared against.
      onOpen: () => {
        // A new loopback API process needs one current APSPORT baseline even
        // when the provider's normal one-minute cooldown has not elapsed. Once
        // that first request starts, the observer coalesces recovery retries and
        // the normal poller onto the same generation.
        for (const attached of registry.list()) {
          if (attached.lobby === "TSPORT") {
            observer.resetApsportRefreshCooldown(`chrome:${attached.lobby}:${attached.tabId}`);
          }
        }
        void refreshBootstrapCatalogs();
      },
      onSnapshotRequest: async (request) => recoverSourceSnapshot(request),
      onSourceResync: async (sourceId) => {
        observer.beginBridgeSourceEpoch(sourceId);
        await recoverSourceSnapshot({ sourceId, prematchWindowHours: 24 });
      },
      ...(typeof __CHROME_EXTENSION_BUILD_IDENTITY__ === "string" &&
        __CHROME_EXTENSION_BUILD_IDENTITY__.length > 0
        ? { buildIdentity: __CHROME_EXTENSION_BUILD_IDENTITY__ }
        : {}),
      // Restarts this service worker only. Provider tabs keep their session and
      // are neither navigated nor closed, which is exactly what a manual
      // "reload extension" does, so a deployment no longer needs a human.
      onExtensionReload: () => { chrome.runtime.reload(); },
      onSourceReload: async (sourceId) => {
        const attached = registry.list().find((entry) => `chrome:${entry.lobby}:${entry.tabId}` === sourceId);
        if (attached) {
          if (attached.lobby === "CMD") {
            await cmdPageKeepalive.reloadNow({ lobby: "CMD", sourceId, tabId: attached.tabId });
          } else if (attached.lobby === "BTI") {
            const source: ObservedSource = { lobby: "BTI", sourceId, tabId: attached.tabId };
            const health = await observer.probeBtiPageHealth(source).catch(() => null);
            if (btiHardRecoveryAction(health) === "RENEW") {
              await providerPageLeaseCoordinator.renewNow({ lobby: "BTI", sourceId, tabId: attached.tabId });
            } else {
              // A healthy authenticated page already has everything needed to
              // rebuild its roster. Reloading it on every backend recovery
              // request rotates the source epoch before hidden-detail capture
              // can finish, so keep recovery inside the current document.
              await observer.refreshCatalog(source).catch(() => undefined);
            }
          } else if (attached.lobby === "IM") {
            // IM is the only provider whose public-looking URL cannot recreate
            // an authenticated page. A hard recovery must preserve this exact
            // tab and session, rebuild the observer epoch, and issue fresh
            // signed GetSE requests from inside the already-authenticated page.
            const source: ObservedSource = { lobby: "IM", sourceId, tabId: attached.tabId };
            observer.beginSourceEpoch(sourceId);
            await observer.refreshCatalog(source).catch(() => undefined);
            await retryImBootstrapRefresh(() => observer.refreshCatalog(source));
          } else if (isRenewableLobby(attached.lobby)) {
            await providerPageLeaseCoordinator.renewNow({ lobby: attached.lobby, sourceId,
              tabId: attached.tabId });
          } else {
            await chrome.tabs.reload(attached.tabId);
          }
        }
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
      onSourceEnsure: async (lobby, url) => {
        if (!lobbyIsAllowed(lobby)) return;
        if (lobby === "BTI") {
          const attached = registry.list().find((entry) => entry.lobby === "BTI");
          if (attached !== undefined) {
            const source: ObservedSource = { lobby: "BTI", tabId: attached.tabId,
              sourceId: `chrome:BTI:${attached.tabId}` };
            const health = await observer.probeBtiPageHealth(source).catch(() => null);
            if (btiHardRecoveryAction(health) === "REFRESH") {
              await observer.refreshCatalog(source).catch(() => undefined);
              return;
            }
          }
        }
        await sourceTabRecovery.ensure(lobby, url);
      },
      onSourceRestore: async (lobby) => {
        if (!lobbyIsAllowed(lobby)) return;
        if (lobby === "CMD") {
          const attached = registry.list().find((entry) => entry.lobby === "CMD");
          if (attached !== undefined) {
            await cmdPageKeepalive.reloadNow({
              lobby: "CMD", sourceId: `chrome:CMD:${attached.tabId}`, tabId: attached.tabId
            });
            return;
          }
        }
        if (lobby === "BTI") {
          const attached = registry.list().find((entry) => entry.lobby === "BTI");
          if (attached !== undefined) {
            const source: ObservedSource = { lobby: "BTI", tabId: attached.tabId,
              sourceId: `chrome:BTI:${attached.tabId}` };
            const health = await observer.probeBtiPageHealth(source).catch(() => null);
            if (btiHardRecoveryAction(health) === "REFRESH") {
              await observer.refreshCatalog(source).catch(() => undefined);
              return;
            }
          }
        }
        await sourceTabRecovery.restore(lobby);
        if (lobby === "CMD") await cmdPageKeepalive.markCompleted();
      },
      onFocusSelection: async (request) => {
        const attached = registry.list().find((entry) => `chrome:${entry.lobby}:${entry.tabId}` === request.sourceId);
        if (!attached) throw new Error("SOURCE_NOT_ATTACHED");
        const operation = async (): Promise<void> => {
          const tab = await chrome.tabs.get(attached.tabId);
          if (tab.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true });
          await chrome.tabs.update(attached.tabId, { active: true });
          const focused = await observer.focusSelection({ lobby: attached.lobby, sourceId: request.sourceId,
            tabId: attached.tabId }, request);
          // Every action always opens the correct attached provider tab. CMD and
          // providers exposing an exact DOM identity also scroll/highlight the
          // selection; an opaque network-only ID remains read-only and unclicked.
          if (!focused && attached.lobby === "CMD") throw new Error("EXACT_SELECTION_NOT_FOUND");
        };
        await (attached.lobby === "CMD" ? cmdPageActivity.run(request.sourceId, operation) : operation());
      },
      onSelectionPriceProbe: async (request) => {
        const attached = registry.list().find((entry) => `chrome:${entry.lobby}:${entry.tabId}` === request.sourceId);
        if (!attached) throw new Error("SOURCE_NOT_ATTACHED");
        const operation = () => observer.probeSelectionPrice({ lobby: attached.lobby, sourceId: request.sourceId,
          tabId: attached.tabId }, request);
        await (attached.lobby === "CMD" ? cmdPageActivity.run(request.sourceId, operation) : operation());
      },
      onCmdHiddenMarketProbe: async (request) => {
        const attached = registry.list().find((entry) => `chrome:${entry.lobby}:${entry.tabId}` === request.sourceId);
        if (!attached || attached.lobby !== "CMD") throw new Error("SOURCE_NOT_ATTACHED");
        await cmdPageActivity.run(request.sourceId, () => observer.probeCmdHiddenMarkets({
          lobby: "CMD", sourceId: request.sourceId, tabId: attached.tabId
        }, { requestId: request.requestId, providerEventId: request.providerEventId }));
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
  await legacySourceLaunchUrlsPurge;
  const tabs = (await chrome.tabs.query({})).filter((tab) => {
    const recognized = recognizeLobbyTab(tab);
    return recognized !== null && lobbyIsAllowed(recognized.lobby);
  });
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
    try {
      await observer.start(source);
      await tabBootstrapper.ensure(attached);
      await sourceTabKeepAlive.pulse(attached.tabId).catch(() => undefined);
      sourceIds.push(source.sourceId);
    } catch { /* one unavailable tab must not block the other preferred lobbies */ }
  }
  return sourceIds;
}

const bridgeWakeup = new BridgeWakeup({
  attachWake: (handler) => wakeTriggers.attach(handler),
  reconcileTabs: reconcilePreferredTabs,
  ensureConnected: ensureBridgeConnected,
  // No bridge object means the worker restarted and its configure never
  // completed. That is the case the watchdog exists for, so it reports the
  // largest possible age rather than a sentinel that reads as "just contacted".
  bridgeContactAgeMs: () => bridge?.serverContactAgeMs() ?? Number.POSITIVE_INFINITY,
  // Clearing the in-flight configure first is the point: a hung configure would
  // otherwise hand every caller the same never-settling promise forever.
  rebuildBridge: async () => {
    configureInFlight = null;
    await configureBridge(true);
  },
  ensureAttached: reattachPreferredTabs,
  pollNow: (sourceIds) => {
    snapshotPoller.pollNow(sourceIds);
    void cmdPageKeepalive.tick();
  }
});
bridgeWakeup.start();

function sourceForTab(tabId: number): ObservedSource | null {
  const attached = registry.list().find((entry) => entry.tabId === tabId);
  return attached
    ? { lobby: attached.lobby, tabId, sourceId: `chrome:${attached.lobby}:${tabId}` }
    : null;
}

// Lobby tabs open before this version arrived carry no heartbeat, and a
// deployment is not allowed to navigate them into having one. Injecting the
// script leaves the authenticated page exactly as it is.
async function installLobbyHeartbeat(): Promise<void> {
  await injectHeartbeatIntoOpenLobbies({
    listTabs: async () => (await chrome.tabs.query({})).filter((tab) => {
      const recognized = recognizeLobbyTab(tab);
      return recognized !== null && lobbyIsAllowed(recognized.lobby);
    }),
    inject: async (tabId) => {
      await chrome.scripting.executeScript({ target: { tabId }, files: [HEARTBEAT_SCRIPT] });
    }
  });
}

chrome.runtime.onInstalled.addListener((details) => {
  void (async () => {
    await installLobbyHeartbeat().catch(() => undefined);
    await bridgeWakeup.wakeNow();
    for (const tabId of tabsNeedingContentScriptRefresh(details.reason, registry.list())) {
      await chrome.tabs.reload(tabId);
    }
  })().catch(() => undefined);
});
chrome.runtime.onStartup.addListener(() => {
  void installLobbyHeartbeat().catch(() => undefined);
  void bridgeWakeup.wakeNow();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  bootstrappingSourceTabs.delete(tabId);
  const source = sourceForTab(tabId);
  if (source !== null) bridge?.releaseSource(source.sourceId);
  observer.releaseTab(tabId);
  void registry.handleRemoved(tabId);
});
chrome.debugger.onDetach.addListener((debuggee, reason) => {
  if (debuggee.tabId !== undefined) {
    const source = sourceForTab(debuggee.tabId);
    if (source !== null) {
      observer.prepareDebuggerReattach(debuggee.tabId);
      registry.handleDebuggerDetached(debuggee.tabId);
      void recoverUnexpectedDebuggerDetach({
        tabId: debuggee.tabId,
        lobby: source.lobby,
        reason,
        get: async (tabId) => chrome.tabs.get(tabId),
        attach: attachRecoveredTabAsExpected
      }).then((recovered) => {
        if (!recovered) observer.releaseTab(debuggee.tabId!);
      });
    } else {
      observer.releaseTab(debuggee.tabId);
      registry.handleDebuggerDetached(debuggee.tabId);
    }
  }
});
chrome.debugger.onEvent.addListener((debuggee, method, params) => {
  if (debuggee.tabId === undefined) return;
  const source = sourceForTab(debuggee.tabId);
  if (source) runDebuggerEventTask(observer.handleEvent(source, method, params, debuggee.sessionId),
    (error) => console.warn("Fieldline debugger event failed",
      error instanceof Error ? error.name : "UNKNOWN"));
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === "loading") {
    const descriptor = { id: tabId, url: tab.url, title: tab.title };
    const recognized = recognizeLobbyTab(descriptor);
    if (recognized !== null && !lobbyIsAllowed(recognized.lobby)) return;
    // Reset attaches the debugger while the replacement tab is still blank so
    // no one-time provider bootstrap response can be missed. Chrome may emit a
    // delayed about:blank loading event after that attachment; it is an
    // intermediate state, not a navigation away from the provider.
    if (bootstrappingSourceTabs.has(tabId) && recognized === null) return;
    void rememberRecognizedUrl(descriptor);
    const source = sourceForTab(tabId);
    // The KSPORT sportsbook lives in a child target. Its outer one-time shell
    // can replace its own URL/title after the real live+today baseline is
    // already flowing. Do not tear down the child CDP observer on that shell
    // transition; a genuine unbaselined Volta/error tab is still rejected.
    if (source !== null && recognized === null &&
      (shouldPreserveKsportObserver(source.lobby, observer.hasCompleteKsportBaseline(source.sourceId)) ||
        shouldPreserveSabaObserver(source.lobby, descriptor))) return;
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
      const candidates = tabs.map(recognizeLobbyTab)
        .filter((value) => value !== null && lobbyIsAllowed(value.lobby));
      return sendResponse({ ok: true, configured: bridge !== null, candidates, attached: registry.list() });
    }
    if (request.kind === "SAVE_KEY" && typeof request.installationKey === "string") {
      await chrome.storage.local.set({ installationKey: request.installationKey.trim() });
      return sendResponse({ ok: await configureBridge(true) });
    }
    if (request.kind === "ATTACH_TAB" && Number.isSafeInteger(request.tabId)) {
      const tab = await chrome.tabs.get(request.tabId as number);
      const recognized = recognizeLobbyTab(tab);
      if (recognized === null || !lobbyIsAllowed(recognized.lobby)) {
        return sendResponse({ ok: false, reason: "LOBBY_OUT_OF_SCOPE" });
      }
      rememberRecognizedUrl(tab);
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
      const url = sourceLaunchMemory.load("KSPORT");
      if (url === null) return sendResponse({ ok: false, reason: "KSPORT_LAUNCH_UNAVAILABLE" });
      await sourceTabRecovery.ensure("KSPORT", url);
      return sendResponse({ ok: true });
    }
    if (request.kind === "ATTACH_ALL") {
      const tabs = await chrome.tabs.query({});
      const attached = [];
      for (const tab of tabs) {
        const recognized = recognizeLobbyTab(tab);
        if (recognized === null || !lobbyIsAllowed(recognized.lobby)) continue;
        try {
          rememberRecognizedUrl(tab);
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
