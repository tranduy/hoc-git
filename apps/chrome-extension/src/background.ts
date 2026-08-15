import type { ChromeLobbyId } from "@tool-chenh/contracts";
import { LocalBridge, type BridgeSocket } from "./local-bridge.js";
import { NetworkObserver, type ObservedSource } from "./network-observer.js";
import { recognizeLobbyTab } from "./lobby-signatures.js";
import { TabRegistry } from "./tab-registry.js";
import { resolveInstallationKey } from "./bridge-key.js";

declare const __CHROME_BRIDGE_DEFAULT_KEY__: string;

let bridge: LocalBridge | null = null;

const registry = new TabRegistry({
  attach: async (tabId) => {
    await chrome.debugger.attach({ tabId }, "1.3");
  },
  detach: async (tabId) => {
    await chrome.debugger.detach({ tabId });
  }
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
  forward: async (envelope) => {
    if (!bridge) throw new Error("BRIDGE_NOT_CONFIGURED");
    bridge.enqueue(envelope, envelope.transport === "TAB_STATE" ? "DIAGNOSTIC" : "QUOTE");
  }
});

async function configureBridge(): Promise<boolean> {
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
      socketFactory: (url, protocols) => new WebSocket(url, protocols) as unknown as BridgeSocket
    })
    : null;
  bridge?.connect();
  return bridge !== null;
}

function sourceForTab(tabId: number): ObservedSource | null {
  const attached = registry.list().find((entry) => entry.tabId === tabId);
  return attached
    ? { lobby: attached.lobby, tabId, sourceId: `chrome:${attached.lobby}:${tabId}` }
    : null;
}

chrome.runtime.onInstalled.addListener(() => { void configureBridge(); });
chrome.runtime.onStartup.addListener(() => { void configureBridge(); });
void (async () => {
  await configureBridge();
  const restored = await registry.restore(await chrome.tabs.query({}));
  for (const attached of restored) {
    await observer.start({
      lobby: attached.lobby,
      tabId: attached.tabId,
      sourceId: `chrome:${attached.lobby}:${attached.tabId}`
    });
  }
})();

chrome.debugger.onEvent.addListener((debuggee, method, params) => {
  if (debuggee.tabId === undefined) return;
  const source = sourceForTab(debuggee.tabId);
  if (source) void observer.handleEvent(source, method, params);
});

chrome.debugger.onDetach.addListener((debuggee) => {
  if (debuggee.tabId !== undefined) registry.handleDebuggerDetached(debuggee.tabId);
});
chrome.tabs.onRemoved.addListener((tabId) => { void registry.handleRemoved(tabId); });
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === "loading") {
    void registry.handleNavigation({ id: tabId, url: tab.url, title: tab.title });
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
      return sendResponse({ ok: await configureBridge() });
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
