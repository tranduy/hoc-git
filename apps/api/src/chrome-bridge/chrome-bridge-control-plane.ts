import type { ChromeBridgeControlMessage, ChromeLobbyId } from "@tool-chenh/contracts";
import { chromeBridgeSourceIdentity, type ChromeBridgeAccountKey,
  type ChromeBridgeProviderAccountId } from "./chrome-bridge-account.js";
import type { ProviderAuthorityCoordinator } from "./provider-authority-coordinator.js";
import type { AuthorityCandidateToken, AuthorityIdentity,
  AuthorityObservation } from "./provider-authority-types.js";

export interface BridgeControlSocket {
  readonly readyState: number;
  send(data: string): void;
}

export interface ChromeBridgeControlPlaneOptions {
  readonly activeSourceIds?: () => ReadonlySet<string>;
  readonly authorityCoordinator?: ProviderAuthorityCoordinator;
}

interface AttachedSource {
  readonly sourceId: string;
  readonly lobby: ChromeLobbyId;
  readonly socket: BridgeControlSocket;
}

interface AttachedAuthoritySource extends AttachedSource {
  readonly identity: AuthorityIdentity;
  readonly candidateToken: AuthorityCandidateToken | null;
}

interface AttachedAuthoritySlot {
  active: AttachedAuthoritySource | null;
  candidate: AttachedAuthoritySource | null;
}

export class ChromeBridgeControlPlane {
  readonly #sourcesByAccount = new Map<ChromeBridgeAccountKey, AttachedSource>();
  readonly #authoritySourcesByAccount = new Map<ChromeBridgeProviderAccountId, AttachedAuthoritySlot>();
  #installationSocket: BridgeControlSocket | null = null;
  readonly #activeSourceIds: (() => ReadonlySet<string>) | null;
  readonly #authorityCoordinator: ProviderAuthorityCoordinator | null;

  constructor(options: ChromeBridgeControlPlaneOptions = {}) {
    this.#activeSourceIds = options.activeSourceIds ?? null;
    this.#authorityCoordinator = options.authorityCoordinator ?? null;
    this.#authorityCoordinator?.subscribe((transition) => {
      this.#reconcileAuthoritySlot(transition.accountId);
    });
  }

  attachInstallation(socket: BridgeControlSocket): void {
    this.#installationSocket = socket;
  }

  attach(sourceId: string, socket: BridgeControlSocket): void {
    this.#pruneInactiveSources();
    const identity = chromeBridgeSourceIdentity(sourceId);
    if (identity === null) return;
    this.#sourcesByAccount.set(identity.accountKey, { sourceId, lobby: identity.lobby, socket });
  }

  attachAuthority(identity: AuthorityIdentity, observation: AuthorityObservation,
    lobby: ChromeLobbyId, socket: BridgeControlSocket): void {
    if (this.#authorityCoordinator === null || observation.disposition === "REJECTED") return;
    const authority = this.#authorityCoordinator.snapshot(identity.accountId);
    const slot = this.#authoritySourcesByAccount.get(identity.accountId) ?? { active: null, candidate: null };
    const attached: AttachedAuthoritySource = { sourceId: identity.sourceId, lobby, socket, identity,
      candidateToken: observation.disposition === "CANDIDATE" ? observation.token : null };
    if (authority.active !== null && sameAuthorityIdentity(authority.active, identity)) {
      slot.active = attached;
    } else if (authority.candidate !== null && sameAuthorityIdentity(authority.candidate, identity) &&
      observation.disposition === "CANDIDATE" && authority.candidateToken === observation.token) {
      slot.candidate = attached;
    } else {
      return;
    }
    this.#authoritySourcesByAccount.set(identity.accountId, slot);
    this.#reconcileAuthoritySlot(identity.accountId);
  }

  requestCandidateSnapshot(token: AuthorityCandidateToken): number {
    if (this.#authorityCoordinator === null) return 0;
    this.#reconcileAuthoritySlot(token.accountId);
    const authority = this.#authorityCoordinator.snapshot(token.accountId);
    const candidate = this.#authoritySourcesByAccount.get(token.accountId)?.candidate;
    if (authority.candidateToken !== token || candidate?.candidateToken !== token || candidate.socket.readyState !== 1) {
      return 0;
    }
    const control: ChromeBridgeControlMessage = { version: 1, kind: "REQUEST_SNAPSHOT",
      sourceId: candidate.sourceId };
    candidate.socket.send(JSON.stringify(control));
    return 1;
  }

  isActiveSource(sourceId: string): boolean {
    return this.#exactSocket(sourceId) !== undefined;
  }

  detach(socket: BridgeControlSocket): void {
    if (this.#installationSocket === socket) this.#installationSocket = null;
    for (const [accountKey, attached] of this.#sourcesByAccount) {
      // Identity guard: a late close from a superseded socket must not remove
      // the newer source now owning the same provider account.
      if (attached.socket === socket) this.#sourcesByAccount.delete(accountKey);
    }
    for (const [accountId, slot] of this.#authoritySourcesByAccount) {
      if (slot.active?.socket === socket) slot.active = null;
      if (slot.candidate?.socket === socket) slot.candidate = null;
      if (slot.active === null && slot.candidate === null) this.#authoritySourcesByAccount.delete(accountId);
    }
  }

  sourceCount(): number {
    this.#pruneInactiveSources();
    if (this.#authorityCoordinator !== null) {
      let count = 0;
      for (const slot of this.#authoritySourcesByAccount.values()) if (slot.active !== null) count += 1;
      return count;
    }
    return this.#sourcesByAccount.size;
  }

  requestAllSnapshots(): number {
    return this.#broadcast("REQUEST_SNAPSHOT");
  }

  requestLobbySnapshot(lobby: ChromeLobbyId): number {
    let requested = 0;
    for (const { sourceId, lobby: attachedLobby, socket } of this.#attachedSources()) {
      if (socket.readyState !== 1 || attachedLobby !== lobby) continue;
      const control: ChromeBridgeControlMessage = { version: 1, kind: "REQUEST_SNAPSHOT", sourceId };
      socket.send(JSON.stringify(control));
      requested += 1;
    }
    return requested;
  }

  requestSourceSnapshot(sourceId: string): number {
    const socket = this.#exactSocket(sourceId);
    if (socket === undefined || socket.readyState !== 1) return 0;
    const control: ChromeBridgeControlMessage = { version: 1, kind: "REQUEST_SNAPSHOT", sourceId };
    socket.send(JSON.stringify(control));
    return 1;
  }

  reloadAllSources(): number {
    return this.#broadcast("RELOAD_SOURCE");
  }

  reloadAllSourcesExcept(excludedLobbies: ReadonlySet<string>): number {
    let requested = 0;
    for (const { sourceId, lobby, socket } of this.#attachedSources()) {
      if (socket.readyState !== 1 || excludedLobbies.has(lobby)) continue;
      const control: ChromeBridgeControlMessage = { version: 1, kind: "RELOAD_SOURCE", sourceId };
      socket.send(JSON.stringify(control));
      requested += 1;
    }
    return requested;
  }

  navigateLobby(lobby: string, url: string): number {
    let requested = 0;
    for (const { sourceId, lobby: attachedLobby, socket } of this.#attachedSources()) {
      if (socket.readyState !== 1 || attachedLobby !== lobby) continue;
      const control: ChromeBridgeControlMessage = { version: 1, kind: "NAVIGATE_SOURCE", sourceId, url };
      socket.send(JSON.stringify(control));
      requested += 1;
    }
    return requested;
  }

  ensureLobby(lobby: ChromeLobbyId, url: string): number {
    const socket = this.#installationSocket;
    if (socket === null || socket.readyState !== 1) return 0;
    const control: ChromeBridgeControlMessage = { version: 1, kind: "ENSURE_SOURCE", lobby, url };
    socket.send(JSON.stringify(control));
    return 1;
  }

  restoreLobby(lobby: ChromeLobbyId): number {
    const socket = this.#installationSocket;
    if (socket === null || socket.readyState !== 1) return 0;
    const control: ChromeBridgeControlMessage = { version: 1, kind: "RESTORE_SOURCE", lobby };
    socket.send(JSON.stringify(control));
    return 1;
  }

  probeCmdHiddenMarkets(sourceId: string, requestId: string, providerEventId: string): boolean {
    if (!sourceId.startsWith("chrome:CMD:")) return false;
    const socket = this.#exactSocket(sourceId);
    if (!socket || socket.readyState !== 1) return false;
    const control: ChromeBridgeControlMessage = { version: 1, kind: "PROBE_CMD_HIDDEN_MARKETS",
      sourceId, requestId, providerEventId };
    socket.send(JSON.stringify(control));
    return true;
  }

  probeSelectionPrice(sourceId: string, input: Omit<Extract<ChromeBridgeControlMessage,
    { readonly kind: "PROBE_SELECTION_PRICE" }>, "version" | "kind" | "sourceId">): boolean {
    const socket = this.#exactSocket(sourceId);
    if (!socket || socket.readyState !== 1) return false;
    const control: ChromeBridgeControlMessage = { version: 1, kind: "PROBE_SELECTION_PRICE", sourceId,
      ...input };
    socket.send(JSON.stringify(control));
    if (sourceId.startsWith("chrome:CMD:") || sourceId.startsWith("chrome:SABA:")) {
      // Installed bundles predating participant identity used a strict schema and
      // silently rejected the expanded command. The two strict shapes are
      // mutually exclusive, so exactly one probe runs during the rollout.
      const { participantA: _participantA, participantB: _participantB, ...legacyInput } = input;
      socket.send(JSON.stringify({ version: 1, kind: "PROBE_SELECTION_PRICE", sourceId, ...legacyInput }));
    }
    return true;
  }

  #broadcast(kind: "REQUEST_SNAPSHOT" | "RELOAD_SOURCE"): number {
    let requested = 0;
    for (const { sourceId, socket } of this.#attachedSources()) {
      if (socket.readyState !== 1) continue;
      const control: ChromeBridgeControlMessage = { version: 1, kind, sourceId };
      socket.send(JSON.stringify(control));
      requested += 1;
    }
    return requested;
  }

  focusSelection(sourceId: string, input: Omit<Extract<ChromeBridgeControlMessage,
    { readonly kind: "FOCUS_SELECTION" }>, "version" | "kind" | "sourceId">): boolean {
    const socket = this.#exactSocket(sourceId);
    if (!socket || socket.readyState !== 1) return false;
    const control: ChromeBridgeControlMessage = { version: 1, kind: "FOCUS_SELECTION", sourceId, ...input };
    socket.send(JSON.stringify(control));
    return true;
  }

  #attachedSources(): readonly AttachedSource[] {
    this.#pruneInactiveSources();
    if (this.#authorityCoordinator !== null) {
      return [...this.#authoritySourcesByAccount.values()]
        .flatMap((slot) => slot.active === null ? [] : [slot.active]);
    }
    return [...this.#sourcesByAccount.values()];
  }

  #exactSocket(sourceId: string): BridgeControlSocket | undefined {
    this.#pruneInactiveSources();
    const identity = chromeBridgeSourceIdentity(sourceId);
    if (identity === null) return undefined;
    if (this.#authorityCoordinator !== null) {
      const attached = this.#authoritySourcesByAccount.get(identity.accountId)?.active;
      return attached?.sourceId === sourceId ? attached.socket : undefined;
    }
    const attached = this.#sourcesByAccount.get(identity.accountKey);
    return attached?.sourceId === sourceId ? attached.socket : undefined;
  }

  #pruneInactiveSources(): void {
    if (this.#authorityCoordinator !== null) {
      for (const accountId of [...this.#authoritySourcesByAccount.keys()]) this.#reconcileAuthoritySlot(accountId);
      return;
    }
    if (this.#activeSourceIds === null) return;
    const active = this.#activeSourceIds();
    for (const [accountKey, attached] of this.#sourcesByAccount) {
      if (!active.has(attached.sourceId)) this.#sourcesByAccount.delete(accountKey);
    }
  }

  #reconcileAuthoritySlot(accountId: ChromeBridgeProviderAccountId): void {
    if (this.#authorityCoordinator === null) return;
    const slot = this.#authoritySourcesByAccount.get(accountId);
    if (slot === undefined) return;
    const authority = this.#authorityCoordinator.snapshot(accountId);
    const attached = [slot.active, slot.candidate]
      .filter((value): value is AttachedAuthoritySource => value !== null);
    const active = attached.find((value) => authority.active !== null &&
      sameAuthorityIdentity(value.identity, authority.active)) ?? null;
    const candidate = attached.find((value) => authority.candidate !== null &&
      sameAuthorityIdentity(value.identity, authority.candidate) &&
      value.candidateToken === authority.candidateToken) ?? null;
    slot.active = active;
    slot.candidate = candidate;
    if (active === null && candidate === null) this.#authoritySourcesByAccount.delete(accountId);
  }
}

function sameAuthorityIdentity(left: AuthorityIdentity, right: AuthorityIdentity): boolean {
  return left.accountId === right.accountId && left.sourceId === right.sourceId &&
    left.sourceEpoch === right.sourceEpoch && left.connectionGeneration === right.connectionGeneration;
}
