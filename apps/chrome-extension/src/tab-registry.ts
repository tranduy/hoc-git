import { ChromeLobbyIdSchema, type ChromeLobbyId } from "@tool-chenh/contracts";
import { recognizeExpectedLobbyTab, recognizeLobbyTab, type TabDescriptor } from "./lobby-signatures.js";

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
  readonly #attachInFlight = new Map<number, Promise<AttachedLobbyTab>>();
  readonly #removedDuringAttach = new Set<number>();

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
    return this.#attachCandidate(candidate);
  }

  async attachBootstrap(tab: TabDescriptor, lobby: ChromeLobbyId): Promise<AttachedLobbyTab> {
    const candidate = recognizeExpectedLobbyTab(tab, lobby);
    if (candidate?.lobby !== lobby) throw new Error("TAB_NOT_RECOGNIZED");
    return this.#attachCandidate(candidate);
  }

  async #attachCandidate(candidate: NonNullable<ReturnType<typeof recognizeLobbyTab>>): Promise<AttachedLobbyTab> {
    const current = this.#attachInFlight.get(candidate.tabId);
    if (current !== undefined) return current;
    // A tab id is not reused while the browser is running. Clear an earlier
    // tombstone only when a new, explicit descriptor starts a fresh attach;
    // handleRemoved can then mark this exact in-flight generation again.
    this.#removedDuringAttach.delete(candidate.tabId);
    const operation = this.#attachCandidateOnce(candidate).finally(() => {
      if (this.#attachInFlight.get(candidate.tabId) === operation) {
        this.#attachInFlight.delete(candidate.tabId);
      }
    });
    this.#attachInFlight.set(candidate.tabId, operation);
    return operation;
  }

  async #attachCandidateOnce(candidate: NonNullable<ReturnType<typeof recognizeLobbyTab>>): Promise<AttachedLobbyTab> {
    this.#preferred.set(candidate.tabId, candidate.lobby);
    await this.#persist();
    const existing = this.#attached.get(candidate.tabId);
    if (existing?.lobby === candidate.lobby) return existing;
    if (existing) await this.#port.detach(candidate.tabId);
    try {
      await this.#port.attach(candidate.tabId);
    } catch (attachError) {
      try {
        // MV3 restarts can leave Chrome holding this extension's prior debugger
        // session after the in-memory registry has vanished. Detach succeeds
        // only for a session owned by this extension; DevTools/another
        // extension therefore fail closed and retain their target.
        await this.#port.detach(candidate.tabId);
      } catch {
        throw attachError;
      }
      await this.#port.attach(candidate.tabId);
    }
    if (this.#removedDuringAttach.has(candidate.tabId)) {
      await this.#port.detach(candidate.tabId).catch(() => undefined);
      throw new Error("TAB_REMOVED_DURING_ATTACH");
    }
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
    if (!this.#preferred.has(tab.id)) {
      this.#preferred.set(tab.id, candidate.lobby);
      await this.#persist();
    }
    if (this.#preferred.get(tab.id) !== candidate.lobby) return;
    if (!existing) await this.attachSelected(tab);
  }

  async handleRemoved(tabId: number): Promise<void> {
    // Popup launch tabs can close after debugger.attach starts but before the
    // registry commits the source. Keep a tombstone across that await so the
    // completed attachment cannot resurrect a tab Chrome already removed.
    this.#removedDuringAttach.add(tabId);
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
        } catch {
          // A DevTools-owned target is not ours to reclaim. Try the next
          // current tab for this lobby before leaving the source offline.
        }
      }
      if (activeTabId === null) continue;
      const activeHostname = recognizeLobbyTab(
        candidates.find((tab) => tab.id === activeTabId) ?? {})?.hostname ?? null;
      for (const duplicate of candidates) {
        if (duplicate.id === undefined || duplicate.id === activeTabId) continue;
        this.#attached.delete(duplicate.id);
        this.#preferred.delete(duplicate.id);
        // Two tabs on the same host are one book opened twice, and the spare is
        // safe to close. Two tabs whose hosts merely resolve to the same lobby
        // label are not: SABA's host pattern is a superset of SBOBET's, so a
        // rotated SBOBET domain reads as SABA and the "duplicate" closed here
        // is a different, authenticated book that nothing will reopen. Leaving
        // it open costs one idle tab; closing it costs that book for hours.
        if (activeHostname === null ||
          recognizeLobbyTab(duplicate)?.hostname !== activeHostname) continue;
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
