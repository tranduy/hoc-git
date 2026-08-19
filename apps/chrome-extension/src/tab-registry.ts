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

export class TabRegistry {
  readonly #port: DebuggerAttachmentPort;
  readonly #store: TabPreferenceStore | null;
  readonly #attached = new Map<number, AttachedLobbyTab>();
  readonly #preferred = new Map<number, ChromeLobbyId>();

  constructor(port: DebuggerAttachmentPort, store: TabPreferenceStore | null = null) {
    this.#port = port;
    this.#store = store;
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
    for (const tab of tabs) {
      if (!recognizeLobbyTab(tab)) continue;
      try {
        // Chrome assigns a new tab id after a provider redirect or restored
        // session. Adopt every recognized current tab so a stale old id never
        // leaves that provider permanently disconnected.
        await this.attachSelected(tab);
      } catch (error) {
        if (tab.id !== undefined && isExistingDebuggerAttachment(error)) {
          try {
            // An MV3 worker restart clears this in-memory registry while
            // Chrome can retain the extension's debugger attachment. Reclaim
            // that orphaned session instead of leaving every source detached.
            await this.#port.detach(tab.id);
            await this.attachSelected(tab);
            continue;
          } catch {
            // A DevTools-owned target is not ours to reclaim. Continue with
            // the other providers and retry this tab on the next alarm.
          }
        }
        // One tab can temporarily be owned by DevTools or be navigating.
        // Keep restoring the remaining recognized provider tabs; the Chrome
        // alarm will retry this one on the next recovery pass.
      }
    }
    return this.list();
  }

  async #persist(): Promise<void> {
    if (!this.#store) return;
    const preferences: Record<string, ChromeLobbyId> = {};
    for (const [tabId, lobby] of this.#preferred) preferences[String(tabId)] = lobby;
    await this.#store.save(preferences);
  }
}

function isExistingDebuggerAttachment(error: unknown): boolean {
  return error instanceof Error && /another debugger is already attached/iu.test(error.message);
}
