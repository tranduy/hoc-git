import type { ChromeLobbyId } from "@tool-chenh/contracts";
import { recognizeLobbyTab, type TabDescriptor } from "./lobby-signatures.js";

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
}

export class SourceTabRecovery {
  readonly #options: SourceTabRecoveryOptions;

  constructor(options: SourceTabRecoveryOptions) {
    this.#options = options;
  }

  async ensure(lobby: ChromeLobbyId, url: string): Promise<void> {
    const recognized = recognizeLobbyTab({ id: 0, url });
    if (recognized?.lobby !== lobby) throw new Error("UNTRUSTED_LAUNCH_URL");

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

    const pending = await this.#options.create(url, false);
    try {
      const recovered = await this.#waitForLobby(pending, lobby);
      await this.#options.attach(recovered);
    } catch (error) {
      if (pending.id !== undefined) await this.#options.remove?.(pending.id).catch(() => undefined);
      throw error;
    }
    if (pending.id !== undefined) oldTabIds.delete(pending.id);
    await Promise.all([...oldTabIds].map(async (tabId) => {
      await this.#options.remove?.(tabId);
    }));
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
      const tabs = [session.tab, ...(session.window?.tabs ?? [])]
        .filter((tab): tab is TabDescriptor => tab !== undefined);
      if (!tabs.some((tab) => recognizeLobbyTab(tab)?.lobby === lobby) || !session.sessionId || !this.#options.restore) continue;
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
    if (recognizeLobbyTab(tab)?.lobby === lobby) return tab;
    if (tab.id === undefined || !this.#options.get) throw new Error("SOURCE_TAB_RECOVERY_FAILED");
    const delay = this.#options.delay ?? ((delayMs: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, delayMs)));
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await delay(250);
      const current = await this.#options.get(tab.id);
      if (recognizeLobbyTab(current)?.lobby === lobby) return current;
    }
    throw new Error("SOURCE_TAB_RECOVERY_FAILED");
  }
}
