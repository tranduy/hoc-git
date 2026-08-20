import { recognizeLobbyTab, type TabDescriptor } from "./lobby-signatures.js";

interface PortalTab extends TabDescriptor {
  readonly windowId?: number | undefined;
  readonly openerTabId?: number | undefined;
}

interface FabetPortalLauncherOptions {
  readonly query: () => Promise<readonly PortalTab[]>;
  readonly update: (tabId: number, url: string, active: boolean) => Promise<PortalTab>;
  readonly focusWindow: (windowId: number) => Promise<void>;
  readonly attachDebugger: (tabId: number) => Promise<void>;
  readonly detachDebugger: (tabId: number) => Promise<void>;
  readonly sendCommand: (tabId: number, method: string, params: Record<string, unknown>) => Promise<unknown>;
  readonly addCreatedListener: (listener: (tab: PortalTab) => void) => void;
  readonly removeCreatedListener: (listener: (tab: PortalTab) => void) => void;
  readonly addUpdatedListener?: (listener: (tabId: number, changeInfo: unknown, tab: PortalTab) => void) => void;
  readonly removeUpdatedListener?: (listener: (tabId: number, changeInfo: unknown, tab: PortalTab) => void) => void;
  readonly attachSource: (tab: TabDescriptor) => Promise<void>;
  readonly get: (tabId: number) => Promise<PortalTab>;
  readonly delay?: (delayMs: number) => Promise<void>;
}

const KSPORT_CONTROL_EXPRESSION = `(() => {
  const normalize = (value) => String(value || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
  for (const close of document.querySelectorAll('#s4-dynamic-popup-modal .icon-close-btn, [class*="modal" i] [class*="close" i]')) {
    if (close.getClientRects().length > 0) close.click();
  }
  const cards = [...document.querySelectorAll('.game-item.lobby')];
  const fallback = [...document.querySelectorAll('[class*="game-item" i], [class*="lobby" i], button, [role="button"]')];
  const candidates = [...new Set([...cards, ...fallback])]
    .filter((node) => /(?:^| )K SPORTS(?: |$)/.test(normalize(node.innerText || node.textContent)));
  for (const card of candidates) {
    const control = card.querySelector('.game-item__play-btn button, button, [role="button"]') || card;
    control.scrollIntoView({ block: 'center', inline: 'center' });
    const rect = control.getBoundingClientRect();
    const style = getComputedStyle(control);
    if (rect.width <= 0 || rect.height <= 0 || style.visibility === 'hidden' || style.display === 'none') continue;
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue;
    control.focus();
    return { x, y };
  }
  return null;
})()`;

export class FabetPortalLauncher {
  readonly #options: FabetPortalLauncherOptions;

  constructor(options: FabetPortalLauncherOptions) { this.#options = options; }

  async launchKsport(_sourceMarkerUrl: string): Promise<TabDescriptor> {
    const initialTabs = await this.#options.query();
    const initialTabIds = new Set(initialTabs.flatMap((tab) => tab.id === undefined ? [] : [tab.id]));
    const portal = initialTabs.find(isFabetPortalTab);
    if (portal?.id === undefined || !portal.url) throw new Error("FABET_PORTAL_TAB_UNAVAILABLE");
    const lobbyUrl = new URL("/lobby-the-thao?type=livesports", portal.url).href;
    const focused = await this.#options.update(portal.id, lobbyUrl, true);
    if (focused.windowId !== undefined) await this.#options.focusWindow(focused.windowId);

    await this.#options.attachDebugger(portal.id);
    const descendants: PortalTab[] = [];
    const descendantIds = new Set<number>([portal.id]);
    const registerSource = (tab: PortalTab): void => {
      if (tab.id === undefined || descendantIds.has(tab.id)) return;
      descendantIds.add(tab.id);
      descendants.push(tab);
    };
    const onCreated = (tab: PortalTab): void => {
      if (tab.id === undefined || tab.openerTabId === undefined ||
        !descendantIds.has(tab.openerTabId) || descendantIds.has(tab.id)) return;
      registerSource(tab);
    };
    const onUpdated = (_tabId: number, _changeInfo: unknown, tab: PortalTab): void => {
      // Some K-Sports builds reuse a named blank child instead of creating a
      // new popup. During this bounded Reset window, adopt it as soon as its
      // final provider hostname appears so the observer still sees page load.
      if (recognizeLobbyTab(tab)?.lobby === "KSPORT") registerSource(tab);
    };
    this.#options.addCreatedListener(onCreated);
    this.#options.addUpdatedListener?.(onUpdated);
    try {
      await this.#options.sendCommand(portal.id, "Runtime.enable", {});
      await this.#clickKsportControl(portal.id);
      const stable = await this.#waitForStableKsportDescendant(descendants, initialTabIds);
      await this.#options.attachSource(stable);
      return stable;
    } finally {
      this.#options.removeCreatedListener(onCreated);
      this.#options.removeUpdatedListener?.(onUpdated);
      await this.#options.detachDebugger(portal.id).catch(() => undefined);
    }
  }

  async #clickKsportControl(tabId: number): Promise<void> {
    const delay = this.#options.delay ?? ((delayMs: number) => new Promise<void>((resolve) => setTimeout(resolve, delayMs)));
    await this.#options.sendCommand(tabId, "Page.bringToFront", {});
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const response = await this.#options.sendCommand(tabId, "Runtime.evaluate", {
        expression: KSPORT_CONTROL_EXPRESSION, returnByValue: true, awaitPromise: false
      });
      const point = evaluationPoint(response);
      if (point !== null) {
        await this.#options.sendCommand(tabId, "Input.dispatchMouseEvent", {
          type: "mouseMoved", x: point.x, y: point.y
        });
        await this.#options.sendCommand(tabId, "Input.dispatchMouseEvent", {
          type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1
        });
        await delay(50);
        await this.#options.sendCommand(tabId, "Input.dispatchMouseEvent", {
          type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1
        });
        return;
      }
      await delay(250);
    }
    throw new Error("FABET_KSPORT_CONTROL_UNAVAILABLE");
  }

  async #waitForStableKsportDescendant(
    descendants: readonly PortalTab[], initialTabIds: ReadonlySet<number>
  ): Promise<PortalTab> {
    const delay = this.#options.delay ?? ((delayMs: number) => new Promise<void>((resolve) => setTimeout(resolve, delayMs)));
    let stableTabId: number | null = null;
    let stablePolls = 0;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      // Provider popups created with `noopener` have no openerTabId. Discover
      // them by bounded before/after tab identity as well as the opener chain.
      const queried = await this.#options.query().catch(() => []);
      const candidates = [...descendants, ...queried.filter((tab) =>
        tab.id !== undefined && !initialTabIds.has(tab.id) && recognizeLobbyTab(tab)?.lobby === "KSPORT")];
      const latest = candidates.sort((left, right) => (left.id ?? -1) - (right.id ?? -1)).at(-1);
      let current: PortalTab | null = null;
      if (latest?.id !== undefined) current = await this.#options.get(latest.id).catch(() => null);
      if (current !== null && recognizeLobbyTab(current)?.lobby === "KSPORT") {
        if (stableTabId === current.id) stablePolls++;
        else { stableTabId = current.id ?? null; stablePolls = 1; }
        if (stablePolls >= 8) {
          return current;
        }
      } else {
        stableTabId = null;
        stablePolls = 0;
      }
      await delay(250);
    }
    throw new Error("FABET_KSPORT_POPUP_UNAVAILABLE");
  }
}

function isFabetPortalTab(tab: PortalTab): boolean {
  if (tab.id === undefined || !tab.url) return false;
  try {
    const url = new URL(tab.url);
    return url.protocol === "https:" && /(?:^|\.)fabet\.[a-z0-9.-]+$/iu.test(url.hostname);
  } catch { return false; }
}

function evaluationPoint(value: unknown): { readonly x: number; readonly y: number } | null {
  if (typeof value !== "object" || value === null) return null;
  const result = (value as Record<string, unknown>).result;
  if (typeof result !== "object" || result === null) return null;
  const point = (result as Record<string, unknown>).value;
  if (typeof point !== "object" || point === null) return null;
  const x = (point as Record<string, unknown>).x;
  const y = (point as Record<string, unknown>).y;
  return typeof x === "number" && Number.isFinite(x) && typeof y === "number" && Number.isFinite(y)
    ? { x, y } : null;
}
