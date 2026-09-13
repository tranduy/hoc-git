import type { ChromeLobbyId } from "@tool-chenh/contracts";
import { recognizeExpectedLobbyTab, recognizeLobbyTab, type TabDescriptor } from "./lobby-signatures.js";

interface AttachedSource {
  readonly lobby: ChromeLobbyId;
  readonly tabId: number;
}

interface SourceTabRecoveryOptions {
  readonly canRecover?: (lobby: ChromeLobbyId) => boolean;
  readonly listAttached: () => readonly AttachedSource[];
  readonly query: () => Promise<readonly TabDescriptor[]>;
  readonly update: (tabId: number, url: string) => Promise<TabDescriptor>;
  readonly reset?: (tabId: number, lobby: ChromeLobbyId) => Promise<void>;
  readonly reload?: (tabId: number, lobby: ChromeLobbyId) => Promise<TabDescriptor>;
  readonly create: (url: string, active: boolean) => Promise<TabDescriptor>;
  readonly remove?: (tabId: number) => Promise<void>;
  readonly attach: (tab: TabDescriptor) => Promise<void>;
  readonly attachBootstrap?: (tab: TabDescriptor, lobby: ChromeLobbyId) => Promise<void>;
  readonly launchFromPortal?: (lobby: ChromeLobbyId, sourceMarkerUrl?: string) => Promise<TabDescriptor>;
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
  readonly beginSourceEpoch?: (sourceId: string) => void;
  readonly validateReady?: (tab: TabDescriptor, lobby: ChromeLobbyId, sinceMs?: number) => Promise<boolean>;
  readonly beginBlankHandoff?: (tabId: number, url: string) => Promise<void>;
  readonly completeBlankHandoff?: (tabId: number) => Promise<void>;
}

/**
 * The direct lobby URLs carry no session segment, which is the point: SABA
 * hands out a new cookieless session when one is asked for without it, so
 * this is how a page gets a working subscription back. Reloading the tab's
 * own URL cannot - that URL carries a session already spent, which is why
 * two reload-based remedies on 2026-09-13 left the book frozen.
 *
 * The language stays as written here. Changing a book to English is done by
 * navigating the tab, and the recovery URL is followed only when the tab has
 * lost its document entirely, at which point the language it had is gone too.
 */
export const SABA_DIRECT_LOBBY_URL =
  "https://c0z0oa.bpd3a3fn.com/NewIndex?lang=vn&webskintype=3&scmt=tab02&ssmt=tab02";
export const BTI_DIRECT_LOBBY_URL =
  "https://prod20091.fxf774.com/vi/asian-view/today/B%C3%B3ng-%C4%91%C3%A1?operatorToken=logout";

const directLobbyUrls: Partial<Record<ChromeLobbyId, string>> = {
  SABA: SABA_DIRECT_LOBBY_URL,
  BTI: BTI_DIRECT_LOBBY_URL
};
const SABA_PRE_RELOAD_BASELINE_ATTEMPTS = 60;

export class SourceTabRecovery {
  readonly #options: SourceTabRecoveryOptions;
  #imRestoreInFlight: Promise<void> | null = null;
  constructor(options: SourceTabRecoveryOptions) {
    this.#options = options;
  }

  #assertRecoveryAllowed(lobby: ChromeLobbyId): void {
    if (this.#options.canRecover?.(lobby) === false) throw new Error("SOURCE_REQUEST_BACKOFF");
  }

  async ensure(lobby: ChromeLobbyId, url: string): Promise<void> {
    this.#assertRecoveryAllowed(lobby);
    const recognized = recognizeExpectedLobbyTab({ id: 0, url }, lobby);
    if (recognized?.lobby !== lobby) throw new Error("UNTRUSTED_LAUNCH_URL");
    const launchUrl = lobby === "KSPORT" ? ksportFootballLaunchUrl(url) : url;

    const currentTabs = await this.#options.query();
    const attachedTabIds = new Set(this.#options.listAttached()
      .filter((source) => source.lobby === lobby).map((source) => source.tabId));
    const recognizedTabs = currentTabs.filter((tab) => tab.id !== undefined &&
      isRecoveryTabForLobby(tab, lobby));
    const existing = recognizedTabs.find((tab) => attachedTabIds.has(tab.id!)) ?? recognizedTabs[0];
    if (existing?.id !== undefined) {
      await this.#reuse(existing, lobby, launchUrl, false);
      await this.#removeRecoveryDuplicates(lobby, recognizedTabs, existing.id);
      return;
    }

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
          if (source.lobby === "KSPORT") leakedPortalTabs.add(source.tabId);
        }
        for (const tab of await this.#options.query()) {
          if (tab.id !== undefined && recognizeLobbyTab(tab)?.lobby === "KSPORT") leakedPortalTabs.add(tab.id);
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
    this.#assertRecoveryAllowed(lobby);
    const pending = await this.#options.create("about:blank", lobby === "KSPORT");
    try {
      if (pending.id === undefined) throw new Error("SOURCE_TAB_RECOVERY_FAILED");
      this.#options.onBootstrapStart?.(pending.id);
      // Attach Network/Runtime observers before consuming a one-time launch.
      // BTI can issue its authenticated bootstrap request during the first
      // navigation; attaching after chrome.tabs.create(url) can miss it and
      // leave a heartbeating tab with no decoded catalog.
      await (this.#options.attachBootstrap ?? ((tab) => this.#options.attach(tab)))({ ...pending, url: launchUrl }, lobby);
      this.#assertRecoveryAllowed(lobby);
      const navigated = await this.#options.update(pending.id, launchUrl);
      await this.#waitForLobby(navigated, lobby);
    } catch (error) {
      if (pending.id !== undefined) this.#options.onBootstrapFailure?.(pending.id);
      let keepRecoverableKsportTab = false;
      if (lobby === "KSPORT" && pending.id !== undefined && this.#options.get !== undefined) {
        try {
          // Baseline readiness can legitimately outlive the bounded launch
          // confirmation. Keep an attached, visibly valid sportsbook shell so
          // background recovery can finish; blank, Volta and provider-error
          // tabs still fail the structural readiness check and are removed.
          keepRecoverableKsportTab = isReadyLobbyTab(await this.#options.get(pending.id), lobby);
        } catch { /* a tab that cannot be read is not safe to retain */ }
      }
      if (pending.id !== undefined && !keepRecoverableKsportTab) {
        await this.#options.remove?.(pending.id).catch(() => undefined);
      }
      throw error;
    }
  }

  async restore(lobby: ChromeLobbyId): Promise<void> {
    this.#assertRecoveryAllowed(lobby);
    if (lobby === "IM") {
      if (this.#imRestoreInFlight !== null) return this.#imRestoreInFlight;
      const operation = this.#restoreIm().finally(() => {
        if (this.#imRestoreInFlight === operation) this.#imRestoreInFlight = null;
      });
      this.#imRestoreInFlight = operation;
      return operation;
    }
    const remembered = await this.#options.loadRemembered?.(lobby) ?? null;
    const currentTabs = await this.#options.query();
    const recoveryTabs = currentTabs.filter((tab) => tab.id !== undefined &&
      isRecoveryTabForLobby(tab, lobby));
    const attachedTabIds = new Set(this.#options.listAttached()
      .filter((source) => source.lobby === lobby).map((source) => source.tabId));
    const existing = recoveryTabs.find((tab) => attachedTabIds.has(tab.id!)) ?? recoveryTabs[0];
    const directUrl = directLobbyUrls[lobby];
    if (directUrl !== undefined) {
      if (existing?.id !== undefined) {
        const existingSabaSession = lobby === "SABA" && existing.url !== undefined
          ? sabaExistingSessionRecovery(existing.url) : null;
        // Keep a healthy provider-minted /(S(...))/ path. Dropping that path
        // during a scheduled or hard recovery can leave a visually loaded
        // SABA shell without its Socket.IO catalog. Error documents still use
        // the canonical tokenless entry so the provider can mint a new session.
        await this.#reuse({ ...existing, title: undefined }, lobby,
          existingSabaSession?.url ?? directUrl, existingSabaSession?.reload ?? false,
          existingSabaSession?.reload === true ? directUrl : undefined);
        await this.#removeRecoveryDuplicates(lobby, recoveryTabs, existing.id);
        return;
      }
      await this.ensure(lobby, directUrl);
      return;
    }
    if (existing?.id !== undefined && existing.url !== undefined) {
      await this.#reuse(existing, lobby, existing.url, true);
      await this.#removeRecoveryDuplicates(lobby, recoveryTabs, existing.id);
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
      this.#assertRecoveryAllowed(lobby);
      const restored = await this.#waitForLobby(await this.#options.restore(session.sessionId), lobby);
      await this.#options.attach(restored);
      return;
    }

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

  async #restoreIm(): Promise<void> {
    const tabs = (await this.#options.query()).filter(tab => tab.id !== undefined && isRecoveryTabForLobby(tab, "IM"));
    const attached = new Set(this.#options.listAttached().filter(source => source.lobby === "IM").map(source => source.tabId));
    const existing = tabs.find(tab => attached.has(tab.id!)) ?? tabs[0];
    if (existing !== undefined) {
      await (this.#options.attachBootstrap ?? ((tab) => this.#options.attach(tab)))(existing, "IM");
      if (this.#options.launchFromPortal === undefined ||
        await this.#options.validateReady?.(existing, "IM", Date.now() - 30_000)) return;
    }
    if (this.#options.launchFromPortal === undefined) throw new Error("SOURCE_RESTORE_UNAVAILABLE:IM");
    // Only the native portal can mint the new IM session. Retain existing
    // sources until the replacement actually publishes a fresh GetSE pair.
    const startedAtMs = Date.now();
    const fresh = await this.#options.launchFromPortal("IM");
    try {
      await this.#waitForLobby(fresh, "IM", 240, startedAtMs);
    } catch (error) {
      if (fresh.id !== undefined && !tabs.some(tab => tab.id === fresh.id) &&
        this.#options.get !== undefined && this.#options.remove !== undefined) {
        const current = await this.#options.get(fresh.id).catch(() => null);
        if (current !== null && isRecoveryTabForLobby(current, "IM")) {
          await this.#options.remove(fresh.id).catch(() => undefined);
        }
      }
      throw error;
    }
    if (this.#options.remove !== undefined) {
      await Promise.all(tabs.filter(tab => tab.id !== fresh.id)
        .map(async tab => {
          const current = this.#options.get === undefined ? tab
            : await this.#options.get(tab.id!).catch(() => null);
          if (current !== null && isRecoveryTabForLobby(current, "IM")) {
            await this.#options.remove!(tab.id!).catch(() => undefined);
          }
        }));
    }
  }

  async #reuse(tab: TabDescriptor, lobby: ChromeLobbyId, url: string, reload: boolean,
    deadSessionFallbackUrl?: string): Promise<void> {
    this.#assertRecoveryAllowed(lobby);
    if (tab.id === undefined) throw new Error("SOURCE_TAB_RECOVERY_FAILED");
    this.#options.beginSourceEpoch?.(`chrome:${lobby}:${tab.id}`);
    this.#options.onBootstrapStart?.(tab.id);
    const ownedApsportTab = lobby === "TSPORT" && this.#options.listAttached()
      .some((source) => source.lobby === lobby && source.tabId === tab.id);
    try {
      let attachAfterNavigation = false;
      try {
        await (this.#options.attachBootstrap ?? ((value) => this.#options.attach(value)))({ ...tab, url }, lobby);
      } catch (error) {
        // A dead AP renderer cannot answer Runtime.enable/disable. Requiring
        // that answer before Chrome's tab reload prevents recovery itself.
        // Only the exact owned, unchanged AP tab may take this fallback.
        if (!ownedApsportTab || !(error instanceof Error) || error.message !== "frame-command-timeout" ||
          this.#options.get === undefined) throw error;
        const current = await this.#options.get(tab.id);
        if (current.id !== tab.id || current.url !== tab.url || !isRecoveryTabForLobby(current, lobby) ||
          !this.#options.listAttached().some((source) => source.lobby === lobby && source.tabId === tab.id)) {
          throw new Error("SOURCE_TAB_REPLACED");
        }
        attachAfterNavigation = true;
      }
      if (reload && lobby === "SABA") {
        try {
          // Reattaching the observer starts SABA's lightweight in-page socket
          // recovery. Give that recovery a short window before destroying the
          // document: in production it can restore a complete socket baseline
          // while resetSabaSocketWorker is still preparing the later reload.
          // Reload only when this cheaper same-tab recovery really failed.
          await this.#waitForLobby(tab, lobby, SABA_PRE_RELOAD_BASELINE_ATTEMPTS);
          return;
        } catch { /* no complete baseline yet; continue with the exact-tab reload */ }
      }
      let navigated: TabDescriptor;
      let blankHandoffStarted = false;
      if (deadSessionFallbackUrl !== undefined) {
        // A SABA /(S(...))/ document can remain visually open after its
        // server-side session and Socket.IO catalog have died. Reloading that
        // exact URL only replays the dead session. Once lightweight same-tab
        // recovery fails, enter the public tokenless URL so SABA mints a new
        // session on this same tab.
        // A same-origin SABA worker can survive the document navigation and
        // keep its pre-observer Socket.IO connection. Terminate that exact
        // provider worker before navigating so the replacement page must
        // create a socket after CDP observation has been armed.
        // Persist the intended destination before touching the current page.
        // A Manifest V3 worker can be replaced after the blank commit; the next
        // worker can then finish this exact tab instead of losing the source.
        await this.#options.beginBlankHandoff?.(tab.id, deadSessionFallbackUrl);
        blankHandoffStarted = true;
        await this.#options.reset?.(tab.id, lobby);
        // A same-origin navigation can preserve the old renderer/worker long
        // enough for its replacement Socket.IO connection to publish the
        // dynamic field table before Network observation is re-armed. Park the
        // exact source tab on a cross-document blank page first. This tears
        // down every root-owned and worker-owned connection without creating a
        // duplicate provider tab, then the observer is attached to the blank
        // target before the public SABA entry starts its bootstrap.
        await this.#parkOnBlank(tab.id);
        this.#options.beginSourceEpoch?.(`chrome:${lobby}:${tab.id}`);
        // beginSourceEpoch retires every frame/session binding from the dead
        // document. Re-arm CDP before navigation so the replacement document's
        // first socket and roster requests cannot race past the observer.
        await (this.#options.attachBootstrap ?? ((value) => this.#options.attach(value)))(
          { ...tab, url: deadSessionFallbackUrl }, lobby);
        navigated = await this.#options.update(tab.id, deadSessionFallbackUrl);
      } else {
        this.#assertRecoveryAllowed(lobby);
        navigated = reload && this.#options.reload !== undefined
          ? await this.#options.reload(tab.id, lobby)
          : await this.#options.update(tab.id, url);
      }
      if (attachAfterNavigation) {
        navigated = await this.#waitForApsportDocument(tab.id);
        this.#assertRecoveryAllowed(lobby);
        if (!this.#options.listAttached().some((source) => source.lobby === lobby && source.tabId === tab.id)) {
          throw new Error("SOURCE_TAB_REPLACED");
        }
        await (this.#options.attachBootstrap ?? ((value) => this.#options.attach(value)))(navigated, lobby);
      }
      await this.#waitForLobby(navigated, lobby);
      if (blankHandoffStarted) await this.#options.completeBlankHandoff?.(tab.id);
    } catch (error) {
      this.#options.onBootstrapFailure?.(tab.id);
      throw error;
    }
  }

  async #waitForApsportDocument(tabId: number): Promise<TabDescriptor> {
    const delay = this.#options.delay ?? ((delayMs: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, delayMs)));
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const current = await this.#options.get!(tabId);
      this.#assertRecoveryAllowed("TSPORT");
      if (current.id !== tabId || !isRecoveryTabForLobby(current, "TSPORT") ||
        !this.#options.listAttached().some((source) => source.lobby === "TSPORT" && source.tabId === tabId)) {
        throw new Error("SOURCE_TAB_REPLACED");
      }
      if (current.status === "complete") return current;
      await delay(250);
    }
    throw new Error("SOURCE_TAB_RECOVERY_FAILED");
  }

  async #parkOnBlank(tabId: number): Promise<void> {
    const blankUrl = "about:blank";
    let parked = await this.#options.update(tabId, blankUrl);
    const delay = this.#options.delay ?? ((delayMs: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, delayMs)));
    if (!blankCommitComplete(parked, blankUrl) && this.#options.get !== undefined) {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await delay(50);
        parked = await this.#options.get(tabId);
        if (blankCommitComplete(parked, blankUrl)) break;
      }
    }
    if (!blankCommitComplete(parked, blankUrl)) throw new Error("SOURCE_TAB_BLANK_HANDOFF_FAILED");
    // Give Chrome one task after the about:blank commit to dispose the old
    // document before another navigation is queued on this same tab id.
    await delay(100);
  }

  async #removeRecoveryDuplicates(
    lobby: ChromeLobbyId,
    tabs: readonly TabDescriptor[],
    keepTabId: number
  ): Promise<void> {
    if (lobby !== "SABA" || this.#options.remove === undefined) return;
    await Promise.all(tabs.filter((tab) => tab.id !== undefined && tab.id !== keepTabId)
      .map((tab) => this.#options.remove!(tab.id!).catch(() => undefined)));
  }

  async #waitForLobby(tab: TabDescriptor, lobby: ChromeLobbyId,
    maxAttemptsOverride?: number, sinceMs?: number): Promise<TabDescriptor> {
    if (await this.#isReady(tab, lobby, sinceMs)) return tab;
    if (tab.id === undefined || !this.#options.get) throw new Error("SOURCE_TAB_RECOVERY_FAILED");
    const delay = this.#options.delay ?? ((delayMs: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, delayMs)));
    // KSPORT is only ready after both the live and today STOMP baselines have
    // completed. Switching the sportsbook view to collect the second baseline
    // can legitimately take longer than the generic five-second tab check.
    const maxAttempts = maxAttemptsOverride ?? (lobby === "KSPORT" || lobby === "SABA" ? 240 : 20);
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      await delay(250);
      const current = await this.#options.get(tab.id);
      if (await this.#isReady(current, lobby, sinceMs)) return current;
    }
    throw new Error("SOURCE_TAB_RECOVERY_FAILED");
  }

  async #isReady(tab: TabDescriptor, lobby: ChromeLobbyId, sinceMs?: number): Promise<boolean> {
    if (!isReadyLobbyTab(tab, lobby)) return false;
    return this.#options.validateReady?.(tab, lobby, sinceMs) ?? true;
  }

}

function blankCommitComplete(tab: TabDescriptor, blankUrl: string): boolean {
  return tab.url === blankUrl && (tab.status === undefined || tab.status === "complete");
}

function isRecoveryTabForLobby(tab: TabDescriptor, lobby: ChromeLobbyId): boolean {
  if (recognizeExpectedLobbyTab(tab, lobby)?.lobby === lobby) return true;
  if (lobby !== "SABA" || tab.url === undefined) return false;
  if (isSabaOwnedTab(tab.url)) return true;
  const lobbyUrl = sabaLobbyUrlFromDetail(tab.url);
  return lobbyUrl !== null &&
    recognizeExpectedLobbyTab({ ...tab, url: lobbyUrl }, "SABA")?.lobby === "SABA";
}

function isSabaOwnedTab(value: string): boolean {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return /^c0z0o[a-z0-9]+\.bp[a-z0-9]+\.com$/iu.test(hostname) &&
      !/^c0z0o[a-z0-9]+\.(?:bpb7jrm5|bpf7t7s9)\.com$/iu.test(hostname);
  } catch {
    return false;
  }
}

function sabaLobbyUrlFromDetail(value: string): string | null {
  try {
    const url = new URL(value);
    if (!url.searchParams.get("matchid")?.trim()) return null;
    for (const key of ["matchid", "leaguekey", "scmt", "ssmt"]) url.searchParams.delete(key);
    return url.href;
  } catch {
    return null;
  }
}

function sabaExistingSessionRecovery(value: string): { readonly url: string; readonly reload: boolean } | null {
  try {
    const url = new URL(value);
    if (!isSabaOwnedTab(url.href) || !url.pathname.toLowerCase().endsWith("/newindex")) return null;
    const lobbyUrl = sabaLobbyUrlFromDetail(url.href);
    return lobbyUrl === null ? { url: url.href, reload: true } : { url: lobbyUrl, reload: false };
  } catch {
    return null;
  }
}

function isReadyLobbyTab(tab: TabDescriptor, lobby: ChromeLobbyId): boolean {
  if (recognizeExpectedLobbyTab(tab, lobby)?.lobby !== lobby) return false;
  if (lobby !== "KSPORT") return true;
  const title = tab.title?.trim() ?? "";
  return /sportsbook/iu.test(title) && !/volta|something went wrong/iu.test(title);
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
