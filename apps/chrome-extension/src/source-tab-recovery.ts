import type { ChromeLobbyId } from "@tool-chenh/contracts";
import { recognizeExpectedLobbyTab, recognizeLobbyTab, type TabDescriptor } from "./lobby-signatures.js";

interface AttachedSource {
  readonly lobby: ChromeLobbyId;
  readonly tabId: number;
}

interface SourceTabRecoveryOptions {
  readonly listAttached: () => readonly AttachedSource[];
  readonly query: () => Promise<readonly TabDescriptor[]>;
  readonly update: (tabId: number, url: string) => Promise<TabDescriptor>;
  readonly create: (url: string, active: boolean) => Promise<TabDescriptor>;
  readonly remove?: (tabId: number) => Promise<void>;
  readonly attach: (tab: TabDescriptor) => Promise<void>;
  readonly attachBootstrap?: (tab: TabDescriptor, lobby: ChromeLobbyId) => Promise<void>;
  readonly launchFromPortal?: (lobby: ChromeLobbyId, sourceMarkerUrl: string) => Promise<TabDescriptor>;
  readonly usePortalLaunch?: boolean;
  readonly recentlyClosed?: () => Promise<readonly {
    readonly sessionId?: string;
    readonly tab?: TabDescriptor;
    readonly window?: { readonly tabs?: readonly TabDescriptor[] };
  }[]>;
  readonly restore?: (sessionId: string) => Promise<TabDescriptor>;
  readonly loadRemembered?: (lobby: ChromeLobbyId) => Promise<string | null>;
  readonly fallbackUrl?: (lobby: ChromeLobbyId) => string | null;
  readonly get?: (tabId: number) => Promise<TabDescriptor>;
  readonly delay?: (delayMs: number) => Promise<void>;
  readonly onBootstrapStart?: (tabId: number) => void;
  readonly onBootstrapFailure?: (tabId: number) => void;
  readonly validateReady?: (tab: TabDescriptor, lobby: ChromeLobbyId) => Promise<boolean>;
}

export class SourceTabRecovery {
  readonly #options: SourceTabRecoveryOptions;
  constructor(options: SourceTabRecoveryOptions) {
    this.#options = options;
  }

  async ensure(lobby: ChromeLobbyId, url: string): Promise<void> {
    const recognized = recognizeExpectedLobbyTab({ id: 0, url }, lobby);
    if (recognized?.lobby !== lobby) throw new Error("UNTRUSTED_LAUNCH_URL");
    if (lobby === "KSPORT" && !hasKsportToken(url)) {
      throw new Error("FABET_KSPORT_TOKEN_UNAVAILABLE");
    }
    const launchUrl = lobby === "KSPORT" ? ksportFootballLaunchUrl(url) : url;

    const currentTabs = await this.#options.query();
    const oldTabIds = new Set<number>();
    for (const source of this.#options.listAttached()) {
      if (source.lobby === lobby) oldTabIds.add(source.tabId);
    }
    for (const tab of currentTabs) {
      if (tab.id !== undefined && recognizeLobbyTab(tab)?.lobby === lobby) oldTabIds.add(tab.id);
    }
    if (oldTabIds.size > 0 && this.#options.remove === undefined) {
      throw new Error("SOURCE_TAB_CLEANUP_UNAVAILABLE");
    }

    // A hard reset must release every old provider renderer before allocating
    // its replacement. This keeps repeated resets from accumulating Chrome
    // processes and prevents old/new feeds from publishing concurrently.
    await Promise.all([...oldTabIds].map(async (tabId) => this.#options.remove!(tabId)));
    if (lobby === "KSPORT" && this.#options.usePortalLaunch !== false &&
      this.#options.launchFromPortal !== undefined) {
      // K-Sports launches a short-lived bootstrap tab that can close itself
      // and hand off to a child sportsbook. Let the signed-in Fabet portal
      // create and follow that popup chain instead of navigating a standalone
      // extension-created tab that dies shortly after its first snapshot.
      try {
        await this.#waitForLobby(await this.#options.launchFromPortal(lobby, launchUrl), lobby);
        return;
      } catch (error) {
        if (!(error instanceof Error) || !isRecoverableKsportPortalFailure(error.message)) throw error;
        const leakedPortalTabs = new Set<number>();
        for (const source of this.#options.listAttached()) {
          if (source.lobby === "KSPORT" && !oldTabIds.has(source.tabId)) leakedPortalTabs.add(source.tabId);
        }
        for (const tab of await this.#options.query()) {
          if (tab.id !== undefined && !oldTabIds.has(tab.id) &&
            recognizeLobbyTab(tab)?.lobby === "KSPORT") leakedPortalTabs.add(tab.id);
        }
        if (leakedPortalTabs.size > 0 && this.#options.remove === undefined) {
          throw new Error("SOURCE_TAB_CLEANUP_UNAVAILABLE");
        }
        await Promise.all([...leakedPortalTabs].map((tabId) =>
          this.#options.remove!(tabId).catch(() => undefined)));
        // Fabet login/launcher capture runs in the API's isolated browser. A
        // signed-in portal tab therefore need not exist in user Chrome. The
        // freshly captured token URL is still safe to consume directly below.
      }
    }
    // KSPORT defers its sportsbook child target when launched in a background
    // tab on some Chrome builds. Make only this explicitly requested direct
    // launch active so its live/today baseline starts immediately.
    const pending = await this.#options.create("about:blank", lobby === "KSPORT");
    try {
      if (pending.id === undefined) throw new Error("SOURCE_TAB_RECOVERY_FAILED");
      this.#options.onBootstrapStart?.(pending.id);
      // Attach Network/Runtime observers before consuming a one-time launch.
      // BTI can issue its authenticated bootstrap request during the first
      // navigation; attaching after chrome.tabs.create(url) can miss it and
      // leave a heartbeating tab with no decoded catalog.
      await (this.#options.attachBootstrap ?? ((tab) => this.#options.attach(tab)))({ ...pending, url: launchUrl }, lobby);
      const navigated = await this.#options.update(pending.id, launchUrl);
      await this.#waitForLobby(navigated, lobby);
    } catch (error) {
      if (pending.id !== undefined) this.#options.onBootstrapFailure?.(pending.id);
      if (pending.id !== undefined) await this.#options.remove?.(pending.id).catch(() => undefined);
      throw error;
    }
  }

  async restore(lobby: ChromeLobbyId): Promise<void> {
    const currentTabs = await this.#options.query();
    const existing = currentTabs.find((tab) => recognizeLobbyTab(tab)?.lobby === lobby);
    if (existing) {
      await this.ensure(lobby, existing.url!);
      return;
    }
    if (this.#options.listAttached().some((source) => source.lobby === lobby)) return;

    const recentlyClosed = await this.#options.recentlyClosed?.() ?? [];
    for (const session of recentlyClosed) {
      // Restoring a Chrome window revives every tab in that session, including
      // tabs unrelated to this provider. Only a single-tab session is safe to
      // recover; window sessions must fall through to the exact remembered or
      // canonical provider launch below.
      if (session.window !== undefined || recognizeLobbyTab(session.tab ?? {})?.lobby !== lobby ||
        !session.sessionId || !this.#options.restore) continue;
      const restored = await this.#waitForLobby(await this.#options.restore(session.sessionId), lobby);
      await this.#options.attach(restored);
      return;
    }

    const remembered = await this.#options.loadRemembered?.(lobby) ?? null;
    if (remembered !== null) {
      await this.ensure(lobby, remembered);
      return;
    }
    const fallback = this.#options.fallbackUrl?.(lobby) ?? null;
    if (fallback !== null) {
      await this.ensure(lobby, fallback);
      return;
    }
    throw new Error(`SOURCE_RESTORE_UNAVAILABLE:${lobby}`);
  }

  async #waitForLobby(tab: TabDescriptor, lobby: ChromeLobbyId): Promise<TabDescriptor> {
    if (await this.#isReady(tab, lobby)) return tab;
    if (tab.id === undefined || !this.#options.get) throw new Error("SOURCE_TAB_RECOVERY_FAILED");
    const delay = this.#options.delay ?? ((delayMs: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, delayMs)));
    // KSPORT is only ready after both the live and today STOMP baselines have
    // completed. Switching the sportsbook view to collect the second baseline
    // can legitimately take longer than the generic five-second tab check.
    const maxAttempts = lobby === "KSPORT" ? 240 : 20;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      await delay(250);
      const current = await this.#options.get(tab.id);
      if (await this.#isReady(current, lobby)) return current;
    }
    throw new Error("SOURCE_TAB_RECOVERY_FAILED");
  }

  async #isReady(tab: TabDescriptor, lobby: ChromeLobbyId): Promise<boolean> {
    if (!isReadyLobbyTab(tab, lobby)) return false;
    return this.#options.validateReady?.(tab, lobby) ?? true;
  }

}

function isReadyLobbyTab(tab: TabDescriptor, lobby: ChromeLobbyId): boolean {
  if (recognizeExpectedLobbyTab(tab, lobby)?.lobby !== lobby) return false;
  if (lobby !== "KSPORT") return true;
  const title = tab.title?.trim() ?? "";
  return /sportsbook/iu.test(title) && !/volta|something went wrong/iu.test(title);
}

function hasKsportToken(value: string): boolean {
  try {
    return Boolean(new URL(value).searchParams.get("token")?.trim());
  } catch {
    return false;
  }
}

function ksportFootballLaunchUrl(value: string): string {
  const url = new URL(value);
  url.searchParams.set("sportId", "1");
  url.searchParams.set("lng", "vi");
  url.searchParams.set("t", String(Date.now()));
  return url.href;
}

function isRecoverableKsportPortalFailure(reason: string): boolean {
  return reason === "FABET_PORTAL_TAB_UNAVAILABLE" ||
    reason === "FABET_KSPORT_POPUP_UNAVAILABLE" ||
    reason === "FABET_KSPORT_CONTROL_UNAVAILABLE";
}
