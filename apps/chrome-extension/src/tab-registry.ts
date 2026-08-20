import { ChromeLobbyIdSchema, type ChromeLobbyId } from "@tool-chenh/contracts";
import { recognizeLobbyTab, type TabDescriptor } from "./lobby-signatures.js";

export interface DebuggerAttachmentPort {
  attach(tabId: number): Promise<void>;
  detach(tabId: number): Promise<void>;
}

export interface AttachedLobbyTab {
  readonly lobby: ChromeLobbyId;
  readonly tabId: number;
  readonly hostname: string;
  readonly state: "ATTACHED" | "LIVE" | "STALE" | "ERROR";
}

export interface TabPreferenceStore {
  load(): Promise<Record<string, unknown>>;
  save(preferences: Record<string, ChromeLobbyId>): Promise<void>;
}

export interface TabRegistryLifecyclePort {
  closeTab(tabId: number): Promise<void>;
}

export class TabRegistry {
  readonly #port: DebuggerAttachmentPort;
  readonly #store: TabPreferenceStore | null;
  readonly #lifecycle: TabRegistryLifecyclePort | null;
  readonly #attached = new Map<number, AttachedLobbyTab>();
  readonly #preferred = new Map<number, ChromeLobbyId>();

  constructor(port: DebuggerAttachmentPort, store: TabPreferenceStore | null = null,
    lifecycle: TabRegistryLifecyclePort | null = null) {
    this.#port = port;
    this.#store = store;
    this.#lifecycle = lifecycle;
  }

  list(): readonly AttachedLobbyTab[] {
    return [...this.#attached.values()];
  }

  async attachSelected(tab: TabDescriptor): Promise<AttachedLobbyTab> {
    const candidate = recognizeLobbyTab(tab);
    if (!candidate) throw new Error("TAB_NOT_RECOGNIZED");
    this.#preferred.set(candidate.tabId, candidate.lobby);
    await this.#persist();
    const existing = this.#attached.get(candidate.tabId);
    if (existing?.lobby === candidate.lobby) return existing;
    if (existing) await this.#port.detach(candidate.tabId);
    await this.#port.attach(candidate.tabId);
    const attached: AttachedLobbyTab = {
      lobby: candidate.lobby,
      tabId: candidate.tabId,
      hostname: candidate.hostname,
      state: "ATTACHED"
    };
    this.#attached.set(candidate.tabId, attached);
    return attached;
  }

  async handleNavigation(tab: TabDescriptor): Promise<void> {
    if (!Number.isSafeInteger(tab.id) || tab.id === undefined) return;
    const candidate = recognizeLobbyTab(tab);
    const existing = this.#attached.get(tab.id);
    if (!candidate) {
      if (existing) {
        await this.#port.detach(tab.id);
        this.#attached.delete(tab.id);
      }
      return;
    }
    if (!this.#preferred.has(tab.id) || this.#preferred.get(tab.id) !== candidate.lobby) return;
    if (!existing) await this.attachSelected(tab);
  }

  async handleRemoved(tabId: number): Promise<void> {
    if (this.#attached.has(tabId)) {
      try {
        await this.#port.detach(tabId);
      } catch {
        // Chrome may already have detached a closed tab.
      }
    }
    this.#attached.delete(tabId);
    this.#preferred.delete(tabId);
    await this.#persist();
  }

  handleDebuggerDetached(tabId: number): void {
    this.#attached.delete(tabId);
  }

  async restore(tabs: readonly TabDescriptor[]): Promise<readonly AttachedLobbyTab[]> {
    if (this.#store) {
      const stored = await this.#store.load();
      for (const [tabIdText, lobbyValue] of Object.entries(stored)) {
        const tabId = Number(tabIdText);
        const parsedLobby = ChromeLobbyIdSchema.safeParse(lobbyValue);
        if (Number.isSafeInteger(tabId) && tabId >= 0 && parsedLobby.success) {
          this.#preferred.set(tabId, parsedLobby.data);
        }
      }
    }
    const byLobby = new Map<ChromeLobbyId, TabDescriptor[]>();
    for (const tab of tabs) {
      const recognized = recognizeLobbyTab(tab);
      if (recognized === null) continue;
      const candidates = byLobby.get(recognized.lobby) ?? [];
      candidates.push(tab);
      byLobby.set(recognized.lobby, candidates);
    }
    for (const [lobby, candidates] of byLobby) {
      candidates.sort((left, right) => {
        const leftPreferred = left.id !== undefined && this.#preferred.get(left.id) === lobby ? 1 : 0;
        const rightPreferred = right.id !== undefined && this.#preferred.get(right.id) === lobby ? 1 : 0;
        return tabRestoreQuality(lobby, right) - tabRestoreQuality(lobby, left) ||
          rightPreferred - leftPreferred || (right.id ?? -1) - (left.id ?? -1);
      });
      let activeTabId: number | null = null;
      for (const tab of candidates) {
        try {
          await this.attachSelected(tab);
          activeTabId = tab.id ?? null;
          break;
        } catch (error) {
          if (tab.id !== undefined && isExistingDebuggerAttachment(error)) {
            try {
              // An MV3 worker restart clears this in-memory registry while
              // Chrome can retain the extension's debugger attachment. Reclaim
              // that orphaned session instead of leaving every source detached.
              await this.#port.detach(tab.id);
              await this.attachSelected(tab);
              activeTabId = tab.id;
              break;
            } catch {
              // A DevTools-owned target is not ours to reclaim. Try the next
              // current tab for this lobby before leaving the source offline.
            }
          }
        }
      }
      if (activeTabId === null) continue;
      for (const duplicate of candidates) {
        if (duplicate.id === undefined || duplicate.id === activeTabId) continue;
        this.#attached.delete(duplicate.id);
        this.#preferred.delete(duplicate.id);
        await this.#lifecycle?.closeTab(duplicate.id).catch(() => undefined);
      }
    }
    await this.#persist();
    return this.list();
  }

  async #persist(): Promise<void> {
    if (!this.#store) return;
    const preferences: Record<string, ChromeLobbyId> = {};
    for (const [tabId, lobby] of this.#preferred) preferences[String(tabId)] = lobby;
    await this.#store.save(preferences);
  }
}

function tabRestoreQuality(lobby: ChromeLobbyId, tab: TabDescriptor): number {
  if (lobby !== "KSPORT") return 0;
  const title = tab.title?.trim() ?? "";
  if (/sportsbook/iu.test(title)) return 2;
  if (/something went wrong/iu.test(title) || /^zenandfe\.com(?:\/|\?|$)/iu.test(title)) return -1;
  return 0;
}

function isExistingDebuggerAttachment(error: unknown): boolean {
  return error instanceof Error && /another debugger is already attached/iu.test(error.message);
}
