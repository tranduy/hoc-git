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

    const attached = this.#options.listAttached().find((source) => source.lobby === lobby);
    if (attached) {
      await this.#options.update(attached.tabId, url);
      return;
    }

    const existing = (await this.#options.query()).find((tab) => recognizeLobbyTab(tab)?.lobby === lobby);
    const pending = existing?.id === undefined
      ? await this.#options.create(url, false)
      : await this.#options.update(existing.id, url);
    const recovered = await this.#waitForLobby(pending, lobby);
    await this.#options.attach(recovered);
  }

  async restore(lobby: ChromeLobbyId): Promise<void> {
    if (this.#options.listAttached().some((source) => source.lobby === lobby)) return;

    const existing = (await this.#options.query()).find((tab) => recognizeLobbyTab(tab)?.lobby === lobby);
    if (existing) {
      await this.#options.attach(existing);
      return;
    }

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
