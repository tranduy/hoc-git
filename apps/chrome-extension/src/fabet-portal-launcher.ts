import type { ChromeLobbyId } from "@tool-chenh/contracts";
import { isReadyKsportSportsbookTab, recognizeExpectedLobbyTab, recognizeLobbyTab,
  type TabDescriptor } from "./lobby-signatures.js";

interface PortalTab extends TabDescriptor {
  readonly windowId?: number | undefined;
  readonly openerTabId?: number | undefined;
}

interface FabetPortalLauncherOptions {
  readonly query: () => Promise<readonly PortalTab[]>;
  readonly update: (tabId: number, url: string, active: boolean) => Promise<PortalTab>;
  readonly reload?: (tabId: number) => Promise<PortalTab>;
  readonly focusWindow: (windowId: number) => Promise<void>;
  readonly attachDebugger: (tabId: number) => Promise<void>;
  readonly detachDebugger: (tabId: number) => Promise<void>;
  readonly sendCommand: (tabId: number, method: string, params: Record<string, unknown>) => Promise<unknown>;
  readonly addCreatedListener: (listener: (tab: PortalTab) => void) => void;
  readonly removeCreatedListener: (listener: (tab: PortalTab) => void) => void;
  readonly addUpdatedListener?: (listener: (tabId: number, changeInfo: unknown, tab: PortalTab) => void) => void;
  readonly removeUpdatedListener?: (listener: (tabId: number, changeInfo: unknown, tab: PortalTab) => void) => void;
  readonly attachSource: (tab: TabDescriptor, expectedLobby?: ChromeLobbyId) => Promise<void>;
  readonly get: (tabId: number) => Promise<PortalTab>;
  readonly delay?: (delayMs: number) => Promise<void>;
}

function portalControlExpression(label: "K SPORTS" | "C SPORTS"): string {
  return `(() => {
  const normalize = (value) => String(value || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
  for (const close of document.querySelectorAll('#s4-dynamic-popup-modal .icon-close-btn, [class*="modal" i] [class*="close" i]')) {
    if (close.getClientRects().length > 0) close.click();
  }
  const cards = [...document.querySelectorAll('.game-item.lobby')];
  const exactCards = cards.filter((node) => normalize(node.querySelector('.game-item__name')?.textContent) === ${JSON.stringify(label)});
  const fallback = [...document.querySelectorAll('[class*="game-item" i], [class*="lobby" i], button, [role="button"]')]
    .filter((node) => normalize(node.textContent) === ${JSON.stringify(label)})
    .map((node) => node.closest('.game-item.lobby') || node);
  const candidates = [...new Set([...exactCards, ...fallback])];
  for (const card of candidates) {
    const control = card.querySelector('.game-item__play-btn button, button, [role="button"]') || card;
    card.scrollIntoView({ block: 'center', inline: 'center' });
    const rect = control.getBoundingClientRect();
    const style = getComputedStyle(control);
    const ready = rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    const target = ready ? rect : card.getBoundingClientRect();
    if (target.width <= 0 || target.height <= 0) continue;
    const x = target.left + target.width / 2;
    const y = target.top + target.height / 2;
    if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue;
    if (ready) control.focus();
    return { x, y, ready };
  }
  return null;
})()`;
}

const KSPORT_CONTROL_EXPRESSION = portalControlExpression("K SPORTS");
const SABA_CONTROL_EXPRESSION = portalControlExpression("C SPORTS");

// Same native Football card identity used by FabetBrowser's IM reader. The
// esports thumbnail is a distinct product despite sharing the I-Sports label.
const IM_CONTROL_EXPRESSION = `(() => {
  const normalize = value => String(value || '').normalize('NFD').replace(/[\\u0300-\\u036f]/g, '')
    .replace(/đ/gi, 'd').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
  const visible = element => element.getClientRects().length > 0;
  if ([...document.querySelectorAll('button, [role="button"]')].some(element => visible(element) &&
    ['LOGIN', 'DANG NHAP'].includes(normalize(element.textContent)))) return { error: 'FABET_NOT_AUTHENTICATED' };
  const cards = [...document.querySelectorAll('.game-item.lobby')].filter(card => visible(card) &&
    normalize(card.querySelector('.game-item__name')?.textContent) === 'I SPORTS' &&
    !String(card.querySelector('img.game-item__thumb, img')?.getAttribute('src') || '').toLowerCase().includes('betradar_esport'));
  const highlighted = cards.filter(card => card.closest('.sport-categories-container__content-highlight'));
  const candidates = highlighted.length > 0 ? highlighted : cards;
  if (candidates.length > 1) return { error: 'FABET_IM_CONTROL_AMBIGUOUS' };
  const card = candidates[0];
  if (!card) return null;
  const control = card.querySelector('.game-item__play-btn button, button, [role="button"]') || card;
  card.scrollIntoView({ block: 'center', inline: 'center' });
  const rect = control.getBoundingClientRect(), style = getComputedStyle(control);
  const ready = rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  const target = ready ? rect : card.getBoundingClientRect();
  const x = target.left + target.width / 2, y = target.top + target.height / 2;
  if (target.width <= 0 || target.height <= 0 || x < 0 || y < 0 || x > innerWidth || y > innerHeight) return null;
  if (ready) control.focus();
  return { x, y, ready };
})()`;

export class FabetPortalLauncher {
  readonly #options: FabetPortalLauncherOptions;

  constructor(options: FabetPortalLauncherOptions) { this.#options = options; }

  /** Launch a new native IM session; the caller must confirm a fresh GetSE pair. */
  async launchIm(signal?: AbortSignal): Promise<TabDescriptor> {
    const check = (): void => { if (signal?.aborted) throw new Error("FABET_IM_LAUNCH_CANCELLED"); };
    const delay = this.#options.delay ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
    check();
    const initialTabs = await this.#options.query();
    check();
    const initial = new Map(initialTabs.flatMap(tab => tab.id === undefined ? [] : [[tab.id, tab] as const]));
    const portal = initialTabs.find(isFabetPortalTab);
    if (portal?.id === undefined || !portal.url) throw new Error("FABET_PORTAL_TAB_UNAVAILABLE");
    const portalId = portal.id, lobbyUrl = new URL("/lobby-the-thao?type=livesports", portal.url).href;
    // An already-open football lobby retains its authenticated document.
    const focused = portal.url === lobbyUrl ? portal : await this.#options.update(portalId, lobbyUrl, true);
    check();
    if (focused.windowId !== undefined) await this.#options.focusWindow(focused.windowId);
    check();
    await this.#options.attachDebugger(portalId);
    let portalDebuggerAttached = true;
    const descendants = new Set([portalId]), candidates = new Set<number>();
    let armed = false;
    const onCreated = (tab: PortalTab): void => {
      if (!armed || signal?.aborted || tab.id === undefined || initial.has(tab.id) ||
        tab.openerTabId === undefined || !descendants.has(tab.openerTabId)) return;
      descendants.add(tab.id); candidates.add(tab.id);
    };
    const onUpdated = (_id: number, _info: unknown, tab: PortalTab): void => {
      if (!armed || signal?.aborted || tab.id === undefined || !tab.url) return;
      const before = initial.get(tab.id);
      if (before?.url === tab.url) return;
      const opener = tab.openerTabId ?? before?.openerTabId;
      if (tab.id !== portalId && !descendants.has(tab.id) &&
        (opener === undefined || !descendants.has(opener))) return;
      descendants.add(tab.id); candidates.add(tab.id);
    };
    this.#options.addCreatedListener(onCreated);
    this.#options.addUpdatedListener?.(onUpdated);
    try {
      check();
      await this.#options.sendCommand(portalId, "Runtime.enable", {});
      check();
      await this.#options.sendCommand(portalId, "Page.bringToFront", {});
      let clicked = false;
      for (let attempt = 0; attempt < 40 && !clicked; attempt++) {
        check();
        const current = await this.#options.get(portalId);
        check();
        if (!current.url || new URL(current.url).origin !== new URL(lobbyUrl).origin) throw new Error("FABET_IM_PORTAL_CHANGED");
        const response = await this.#options.sendCommand(portalId, "Runtime.evaluate", {
          expression: IM_CONTROL_EXPRESSION, returnByValue: true, awaitPromise: false
        });
        check();
        const value = (response as { result?: { value?: { error?: unknown } } } | null)?.result?.value;
        if (value?.error === "FABET_NOT_AUTHENTICATED" || value?.error === "FABET_IM_CONTROL_AMBIGUOUS") throw new Error(value.error);
        const point = evaluationPoint(response);
        if (point !== null) {
          await this.#options.sendCommand(portalId, "Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
          check();
          if (point.ready) {
            armed = true;
            await this.#options.sendCommand(portalId, "Input.dispatchMouseEvent", {
              type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1
            });
            check();
            await this.#options.sendCommand(portalId, "Input.dispatchMouseEvent", {
              type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1
            });
            check(); clicked = true;
          }
        }
        if (!clicked) await delay(250);
      }
      if (!clicked) throw new Error("FABET_IM_CONTROL_UNAVAILABLE");
      for (let attempt = 0; attempt < 60; attempt++) {
        check();
        for (const id of [...candidates].reverse()) {
          const tab = await this.#options.get(id).catch(() => null);
          check();
          if (!tab?.url) continue;
          let url: URL;
          try { url = new URL(tab.url); } catch { continue; }
          if (url.protocol !== "https:" || url.hostname !== "imsports.directsb.net" || url.username || url.password) continue;
          if (id === portalId) {
            await this.#options.detachDebugger(portalId);
            portalDebuggerAttached = false;
            check();
          }
          await this.#options.attachSource(tab, "IM");
          check();
          return tab;
        }
        await delay(250);
      }
      throw new Error("FABET_IM_POPUP_UNAVAILABLE");
    } finally {
      armed = false;
      this.#options.removeCreatedListener(onCreated);
      this.#options.removeUpdatedListener?.(onUpdated);
      if (portalDebuggerAttached) await this.#options.detachDebugger(portalId).catch(() => undefined);
    }
  }

  async launchSaba(sourceMarkerUrl?: string): Promise<TabDescriptor> {
    if (sourceMarkerUrl !== undefined &&
      recognizeExpectedLobbyTab({ id: 0, url: sourceMarkerUrl }, "SABA")?.lobby !== "SABA") {
      throw new Error("UNTRUSTED_LAUNCH_URL");
    }
    const initialTabs = await this.#options.query();
    const initialTabIds = new Set(initialTabs.flatMap((tab) => tab.id === undefined ? [] : [tab.id]));
    const initialUrls = new Map(initialTabs.flatMap((tab) =>
      tab.id === undefined || tab.url === undefined ? [] : [[tab.id, tab.url] as const]));
    const portal = initialTabs.find(isFabetPortalTab);
    if (portal?.id === undefined || !portal.url) throw new Error("FABET_PORTAL_TAB_UNAVAILABLE");
    const lobbyUrl = new URL("/lobby-the-thao?type=livesports", portal.url).href;
    const focused = this.#options.reload !== undefined && new URL(portal.url).href === lobbyUrl
      ? await this.#options.reload(portal.id)
      : await this.#options.update(portal.id, lobbyUrl, true);
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
      if (tab.id === undefined || recognizeExpectedLobbyTab(tab, "SABA")?.lobby !== "SABA") return;
      const initialUrl = initialUrls.get(tab.id);
      if (initialUrl !== undefined && tab.url === initialUrl) return;
      registerSource(tab);
    };
    this.#options.addCreatedListener(onCreated);
    this.#options.addUpdatedListener?.(onUpdated);
    try {
      await this.#options.sendCommand(portal.id, "Runtime.enable", {});
      let lastError: unknown = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await this.#clickPortalControl(portal.id, SABA_CONTROL_EXPRESSION,
          "FABET_SABA_CONTROL_UNAVAILABLE");
        try {
          return await this.#waitForSabaDescendant(descendants, initialTabIds);
        } catch (error) {
          lastError = error;
        }
      }
      throw lastError ?? new Error("FABET_SABA_POPUP_UNAVAILABLE");
    } finally {
      this.#options.removeCreatedListener(onCreated);
      this.#options.removeUpdatedListener?.(onUpdated);
      await this.#options.detachDebugger(portal.id).catch(() => undefined);
    }
  }

  async launchKsport(sourceMarkerUrl: string): Promise<TabDescriptor> {
    if (recognizeLobbyTab({ id: 0, url: sourceMarkerUrl })?.lobby !== "KSPORT") {
      throw new Error("UNTRUSTED_LAUNCH_URL");
    }
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
      let lastError: unknown = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await this.#clickKsportControl(portal.id);
        try {
          const source = await this.#waitForStableKsportDescendant(descendants, initialTabIds);
          if (source.id === undefined) throw new Error("FABET_KSPORT_POPUP_UNAVAILABLE");
          // Consume the freshly issued one-time launch only after Fabet has
          // created a stable child. This preserves the provider opener/session
          // chain; navigating an unrelated standalone tab yields one snapshot
          // and then the K-Sports shell closes itself.
          return await this.#options.update(source.id, ksportFootballLaunchUrl(sourceMarkerUrl), false);
        } catch (error) {
          lastError = error;
        }
      }
      throw lastError ?? new Error("FABET_KSPORT_POPUP_UNAVAILABLE");
    } finally {
      this.#options.removeCreatedListener(onCreated);
      this.#options.removeUpdatedListener?.(onUpdated);
      await this.#options.detachDebugger(portal.id).catch(() => undefined);
    }
  }

  async #clickKsportControl(tabId: number): Promise<void> {
    return this.#clickPortalControl(tabId, KSPORT_CONTROL_EXPRESSION,
      "FABET_KSPORT_CONTROL_UNAVAILABLE");
  }

  async #clickPortalControl(tabId: number, expression: string, failureCode: string): Promise<void> {
    const delay = this.#options.delay ?? ((delayMs: number) => new Promise<void>((resolve) => setTimeout(resolve, delayMs)));
    await this.#options.sendCommand(tabId, "Page.bringToFront", {});
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const response = await this.#options.sendCommand(tabId, "Runtime.evaluate", {
        expression, returnByValue: true, awaitPromise: false
      });
      const point = evaluationPoint(response);
      if (point !== null) {
        await this.#options.sendCommand(tabId, "Input.dispatchMouseEvent", {
          type: "mouseMoved", x: point.x, y: point.y
        });
        if (!point.ready) {
          await delay(150);
          continue;
        }
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
    throw new Error(failureCode);
  }

  async #waitForSabaDescendant(
    descendants: readonly PortalTab[], initialTabIds: ReadonlySet<number>
  ): Promise<PortalTab> {
    const delay = this.#options.delay ?? ((delayMs: number) => new Promise<void>((resolve) => setTimeout(resolve, delayMs)));
    const attachedTabIds = new Set<number>();
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const queried = await this.#options.query().catch(() => []);
      const candidates = [...descendants, ...queried.filter((tab) =>
        tab.id !== undefined && !initialTabIds.has(tab.id) &&
        recognizeExpectedLobbyTab(tab, "SABA")?.lobby === "SABA")];
      const latest = candidates.sort((left, right) => (left.id ?? -1) - (right.id ?? -1)).at(-1);
      let current: PortalTab | null = null;
      if (latest?.id !== undefined) current = await this.#options.get(latest.id).catch(() => null);
      if (current !== null && recognizeExpectedLobbyTab(current, "SABA")?.lobby === "SABA") {
        if (current.id !== undefined && !attachedTabIds.has(current.id)) {
          await this.#options.attachSource(current, "SABA");
          attachedTabIds.add(current.id);
        }
        return current;
      }
      await delay(250);
    }
    throw new Error("FABET_SABA_POPUP_UNAVAILABLE");
  }

  async #waitForStableKsportDescendant(
    descendants: readonly PortalTab[], initialTabIds: ReadonlySet<number>
  ): Promise<PortalTab> {
    const delay = this.#options.delay ?? ((delayMs: number) => new Promise<void>((resolve) => setTimeout(resolve, delayMs)));
    let stableTabId: number | null = null;
    let stablePolls = 0;
    const attachedTabIds = new Set<number>();
    // K-Sports can show a valid Sportsbook shell for ~3 seconds and then hand
    // off to a second child tab. Eight polls accepted that disposable shell,
    // removed the popup listeners, and left the final child unattached. Keep
    // the bounded handoff window open until the same tab survives five seconds.
    for (let attempt = 0; attempt < 60; attempt += 1) {
      // Provider popups created with `noopener` have no openerTabId. Discover
      // them by bounded before/after tab identity as well as the opener chain.
      const queried = await this.#options.query().catch(() => []);
      const candidates = [...descendants, ...queried.filter((tab) =>
        tab.id !== undefined && !initialTabIds.has(tab.id) && recognizeLobbyTab(tab)?.lobby === "KSPORT")];
      const latest = candidates.sort((left, right) => (left.id ?? -1) - (right.id ?? -1)).at(-1);
      let current: PortalTab | null = null;
      if (latest?.id !== undefined) current = await this.#options.get(latest.id).catch(() => null);
      if (current !== null && isReadyKsportSportsbookTab(current)) {
        if (current.id !== undefined && !attachedTabIds.has(current.id)) {
          // A zenandfe root tab can host Volta as well as K-Sports. Attach only
          // after the product identifies itself as Sportsbook; the observer can
          // recover a light baseline after attachment without reloading it.
          await this.#options.attachSource(current);
          attachedTabIds.add(current.id);
        }
        if (stableTabId === current.id) stablePolls++;
        else { stableTabId = current.id ?? null; stablePolls = 1; }
        if (stablePolls >= 20) {
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

function ksportFootballLaunchUrl(sourceMarkerUrl: string): string {
  const url = new URL(sourceMarkerUrl);
  url.searchParams.set("sportId", "1");
  url.searchParams.set("lng", "vi");
  url.searchParams.set("t", String(Date.now()));
  return url.href;
}

function evaluationPoint(value: unknown): { readonly x: number; readonly y: number; readonly ready: boolean } | null {
  if (typeof value !== "object" || value === null) return null;
  const result = (value as Record<string, unknown>).result;
  if (typeof result !== "object" || result === null) return null;
  const point = (result as Record<string, unknown>).value;
  if (typeof point !== "object" || point === null) return null;
  const x = (point as Record<string, unknown>).x;
  const y = (point as Record<string, unknown>).y;
  const ready = (point as Record<string, unknown>).ready;
  return typeof x === "number" && Number.isFinite(x) && typeof y === "number" && Number.isFinite(y)
    && typeof ready === "boolean" ? { x, y, ready } : null;
}
