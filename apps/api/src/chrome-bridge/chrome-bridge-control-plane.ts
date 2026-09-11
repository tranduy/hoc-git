import { randomUUID } from "node:crypto";
import { FootballCollectionPlanSchema, type FootballCollectionPlan } from "@tool-chenh/contracts";
import type { ChromeBridgeControlMessage, ChromeBridgeEnvelope, ChromeLobbyId } from "@tool-chenh/contracts";
import { chromeBridgeProviderAccountIdForLobby, chromeBridgeSourceIdentity, type ChromeBridgeAccountKey,
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
  readonly apsportPrematchWindowHours?: number;
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

export interface DataRefreshReceipt {
  readonly requested: 1;
  readonly status: "QUEUED";
  readonly requestId: string;
  readonly requestedAtMs: number;
}

export class ChromeBridgeControlPlane {
  readonly #collectionPlans = new Map<string, { sourceId: string; plan: FootballCollectionPlan; socket: BridgeControlSocket }>();
  readonly #manualRefreshes = new Map<string, DataRefreshReceipt>();

  collectionSourceId(lobby: ChromeLobbyId): string | null {
    return this.#attachedSources().find(source => source.lobby === lobby && source.socket.readyState === 1)?.sourceId ?? null;
  }

  setCollectionPlan(sourceId: string, plan: FootballCollectionPlan): number {
    const validated = FootballCollectionPlanSchema.parse(plan);
    if (validated.manualRequestId !== undefined) throw new Error("MANUAL_REQUEST_RESERVED");
    const socket = this.#exactSocket(sourceId);
    const identity = chromeBridgeSourceIdentity(sourceId);
    if (socket?.readyState !== 1 || identity === null) return 0;
    const previous = this.#collectionPlans.get(identity.accountId);
    if (previous?.sourceId === sourceId && validated.revision <= previous.plan.revision) {
      throw new Error("STALE_COLLECTION_PLAN");
    }
    try { socket.send(JSON.stringify({ version: 1, kind: "SET_COLLECTION_PLAN", sourceId, plan: validated })); }
    catch { return 0; }
    this.#collectionPlans.set(identity.accountId, { sourceId, plan: validated, socket });
    return 1;
  }

  refreshSourceData(sourceId: string, nowMs: number): DataRefreshReceipt {
    const socket = this.#exactSocket(sourceId);
    const identity = chromeBridgeSourceIdentity(sourceId);
    if (socket?.readyState !== 1 || identity === null) throw new Error("SOURCE_NOT_ATTACHED");
    const current = this.#collectionPlans.get(identity.accountId);
    if (current?.sourceId !== sourceId) throw new Error("PLAN_NOT_READY");
    const previous = this.#manualRefreshes.get(identity.accountId);
    if (previous !== undefined && nowMs - previous.requestedAtMs < 60_000) return previous;
    const receipt: DataRefreshReceipt = { requested: 1, status: "QUEUED", requestId: randomUUID(), requestedAtMs: nowMs };
    try { socket.send(JSON.stringify({ version: 1, kind: "SET_COLLECTION_PLAN", sourceId,
      plan: { ...current.plan, manualRequestId: receipt.requestId } })); }
    catch { throw new Error("SOURCE_NOT_ATTACHED"); }
    this.#manualRefreshes.set(identity.accountId, receipt);
    return receipt;
  }

  readonly #sourcesByAccount = new Map<ChromeBridgeAccountKey, AttachedSource>();
  readonly #authoritySourcesByAccount = new Map<ChromeBridgeProviderAccountId, AttachedAuthoritySlot>();
  #installationSocket: BridgeControlSocket | null = null;
  readonly #activeSourceIds: (() => ReadonlySet<string>) | null;
  readonly #authorityCoordinator: ProviderAuthorityCoordinator | null;
  readonly #apsportPrematchWindowHours: number | null;

  constructor(options: ChromeBridgeControlPlaneOptions = {}) {
    this.#activeSourceIds = options.activeSourceIds ?? null;
    this.#authorityCoordinator = options.authorityCoordinator ?? null;
    const apsportPrematchWindowHours = options.apsportPrematchWindowHours;
    if (apsportPrematchWindowHours !== undefined && (!Number.isSafeInteger(apsportPrematchWindowHours) ||
      apsportPrematchWindowHours < 1 || apsportPrematchWindowHours > 48)) {
      throw new Error("APSPORT_PREMATCH_WINDOW_HOURS_INVALID");
    }
    this.#apsportPrematchWindowHours = apsportPrematchWindowHours ?? null;
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
    this.#replayCollectionPlan({ sourceId, lobby: identity.lobby, socket });
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
    const control = this.#snapshotControl(candidate.sourceId, candidate.lobby);
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
    this.#pruneInactiveSources();
    const sources = this.#authorityCoordinator === null
      ? [...this.#sourcesByAccount.values()]
      : [...this.#authoritySourcesByAccount.values()]
        .flatMap((slot) => slot.active !== null ? [slot.active] : slot.candidate !== null ? [slot.candidate] : []);
    for (const { sourceId, lobby: attachedLobby, socket } of sources) {
      if (socket.readyState !== 1 || attachedLobby !== lobby) continue;
      const control = this.#snapshotControl(sourceId, attachedLobby);
      socket.send(JSON.stringify(control));
      requested += 1;
    }
    return requested;
  }

  requestSourceSnapshot(sourceId: string): number {
    const socket = this.#exactSocket(sourceId);
    if (socket === undefined || socket.readyState !== 1) return 0;
    const identity = chromeBridgeSourceIdentity(sourceId);
    if (identity === null) return 0;
    const control = this.#snapshotControl(sourceId, identity.lobby);
    socket.send(JSON.stringify(control));
    return 1;
  }

  rejectNetworkBody(envelope: Pick<ChromeBridgeEnvelope, "sourceId" | "sourceEpoch" | "sequence">): number {
    if (this.#authorityCoordinator === null) return 0;
    const source = chromeBridgeSourceIdentity(envelope.sourceId);
    if (source === null) return 0;
    const accountId = chromeBridgeProviderAccountIdForLobby(source.lobby);
    const epoch = envelope.sourceEpoch ?? `legacy:${envelope.sourceId}`;
    // The assembler fault belongs to one exact authority epoch. A delayed
    // rejection must never rotate its replacement or a healthy sibling tab.
    for (const disposition of ["ACTIVE", "CANDIDATE"] as const) {
      const attached = this.#recoveryAuthoritySource(accountId, source.lobby, disposition);
      if (attached?.sourceId !== envelope.sourceId || attached.identity.sourceEpoch !== epoch ||
        attached.socket.readyState !== 1) continue;
      const control: ChromeBridgeControlMessage = { version: 1, kind: "REJECT",
        sourceId: envelope.sourceId, ...(envelope.sourceEpoch === undefined ? {} : { sourceEpoch: envelope.sourceEpoch }),
        sequence: envelope.sequence,
        reason: "NETWORK_BODY_UNAVAILABLE" };
      try { attached.socket.send(JSON.stringify(control)); return 1; }
      catch { return 0; }
    }
    return 0;
  }

  reloadSource(sourceId: string): number {
    if (this.#sendReload(sourceId, this.#exactSocket(sourceId)) === 1) return 1;
    // Re-resolve only after the active attempt. Its synchronous send can close
    // or replace the candidate as a side effect.
    if (this.#sendReload(sourceId, this.#exactCandidateSocket(sourceId)) === 1) return 1;
    return 0;
  }

  reloadRecoverySource(accountId: string, lobby: ChromeLobbyId): number {
    if (this.#authorityCoordinator === null) return 0;
    const expectedAccountId = chromeBridgeProviderAccountIdForLobby(lobby);
    if (accountId !== expectedAccountId) return 0;
    const active = this.#recoveryAuthoritySource(expectedAccountId, lobby, "ACTIVE");
    if (active !== null && this.#sendReload(active.sourceId, active.socket) === 1) return 1;
    // The active send can synchronously retire or replace the candidate. Read
    // coordinator token+identity again before addressing any candidate lane.
    const candidate = this.#recoveryAuthoritySource(expectedAccountId, lobby, "CANDIDATE");
    if (candidate !== null && this.#sendReload(candidate.sourceId, candidate.socket) === 1) return 1;
    return 0;
  }

  recoverySourceKey(accountId: string, lobby: ChromeLobbyId): string | null {
    const expectedAccountId = chromeBridgeProviderAccountIdForLobby(lobby);
    if (accountId !== expectedAccountId || this.#authorityCoordinator === null) return null;
    const source = this.#recoveryAuthoritySource(expectedAccountId, lobby, "ACTIVE") ??
      this.#recoveryAuthoritySource(expectedAccountId, lobby, "CANDIDATE");
    if (source === null || source.socket.readyState !== 1) return null;
    const { sourceId, sourceEpoch, connectionGeneration } = source.identity;
    return JSON.stringify([sourceId, sourceEpoch, connectionGeneration]);
  }

  #recoveryAuthoritySource(accountId: ChromeBridgeProviderAccountId, lobby: ChromeLobbyId,
    disposition: "ACTIVE" | "CANDIDATE"): AttachedAuthoritySource | null {
    if (this.#authorityCoordinator === null) return null;
    this.#reconcileAuthoritySlot(accountId);
    const authority = this.#authorityCoordinator.snapshot(accountId);
    const attached = this.#authoritySourcesByAccount.get(accountId)?.[
      disposition === "ACTIVE" ? "active" : "candidate"
    ] ?? null;
    if (attached === null || attached.lobby !== lobby) return null;
    if (disposition === "ACTIVE") {
      return authority.active !== null && sameAuthorityIdentity(attached.identity, authority.active)
        ? attached : null;
    }
    return authority.candidate !== null && authority.candidateToken !== null &&
      attached.candidateToken === authority.candidateToken &&
      sameAuthorityIdentity(attached.identity, authority.candidate) ? attached : null;
  }

  #sendReload(sourceId: string, socket: BridgeControlSocket | undefined): number {
    if (socket === undefined || socket.readyState !== 1) return 0;
    const control: ChromeBridgeControlMessage = { version: 1, kind: "RELOAD_SOURCE", sourceId };
    try {
      socket.send(JSON.stringify(control));
      return 1;
    } catch {
      return 0;
    }
  }

  #exactCandidateSocket(sourceId: string): BridgeControlSocket | undefined {
    if (this.#authorityCoordinator === null) return undefined;
    const identity = chromeBridgeSourceIdentity(sourceId);
    if (identity === null) return undefined;
    this.#reconcileAuthoritySlot(identity.accountId);
    const authority = this.#authorityCoordinator.snapshot(identity.accountId);
    const candidate = this.#authoritySourcesByAccount.get(identity.accountId)?.candidate;
    if (authority.candidate === null || authority.candidateToken === null || candidate?.sourceId !== sourceId ||
      candidate.candidateToken !== authority.candidateToken ||
      !sameAuthorityIdentity(candidate.identity, authority.candidate)) return undefined;
    return candidate.socket;
  }

  /**
   * Asks the extension worker to restart itself so a freshly built bundle takes
   * effect without a human clicking reload. The whole extension shares one
   * bridge socket, so the request is sent once per distinct socket; the worker
   * ignores an identity matching the bundle it already runs.
   */
  reloadExtension(buildIdentity: string): number {
    const control: ChromeBridgeControlMessage = { version: 1, kind: "RELOAD_EXTENSION", buildIdentity };
    const serialized = JSON.stringify(control);
    const seen = new Set<unknown>();
    let requested = 0;
    for (const { socket } of this.#attachedSources()) {
      if (socket.readyState !== 1 || seen.has(socket)) continue;
      seen.add(socket);
      socket.send(serialized);
      requested += 1;
    }
    return requested;
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
    for (const { sourceId, lobby, socket } of this.#attachedSources()) {
      if (socket.readyState !== 1) continue;
      const control: ChromeBridgeControlMessage = kind === "REQUEST_SNAPSHOT"
        ? this.#snapshotControl(sourceId, lobby)
        : { version: 1, kind, sourceId };
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

  #replayCollectionPlan(source: AttachedSource): void {
    const identity = chromeBridgeSourceIdentity(source.sourceId);
    if (identity === null || source.socket.readyState !== 1) return;
    const current = this.#collectionPlans.get(identity.accountId);
    if (current === undefined || (current.sourceId === source.sourceId && current.socket === source.socket)) return;
    try { source.socket.send(JSON.stringify({ version: 1, kind: "SET_COLLECTION_PLAN",
      sourceId: source.sourceId, plan: current.plan })); }
    catch { return; }
    this.#collectionPlans.set(identity.accountId, { sourceId: source.sourceId, plan: current.plan, socket: source.socket });
  }

  #attachedSources(): readonly AttachedSource[] {
    this.#pruneInactiveSources();
    if (this.#authorityCoordinator !== null) {
      return [...this.#authoritySourcesByAccount.values()]
        .flatMap((slot) => slot.active === null ? [] : [slot.active]);
    }
    return [...this.#sourcesByAccount.values()];
  }

  #snapshotControl(sourceId: string, lobby: ChromeLobbyId): ChromeBridgeControlMessage {
    return { version: 1, kind: "REQUEST_SNAPSHOT", sourceId,
      ...(lobby === "TSPORT" && this.#apsportPrematchWindowHours !== null
        ? { prematchWindowHours: this.#apsportPrematchWindowHours }
        : {}) };
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
    if (active !== null) this.#replayCollectionPlan(active);
    slot.candidate = candidate;
    if (active === null && candidate === null) this.#authoritySourcesByAccount.delete(accountId);
  }
}

function sameAuthorityIdentity(left: AuthorityIdentity, right: AuthorityIdentity): boolean {
  return left.accountId === right.accountId && left.sourceId === right.sourceId &&
    left.sourceEpoch === right.sourceEpoch && left.connectionGeneration === right.connectionGeneration;
}
