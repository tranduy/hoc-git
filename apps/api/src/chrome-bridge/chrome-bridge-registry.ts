import type {
  ChromeBridgeControlMessage,
  ChromeBridgeEnvelope,
  ChromeBridgeSourceState,
  ChromeLobbyId
} from "@tool-chenh/contracts";

export interface ChromeBridgeSourceSnapshot {
  readonly lobby: ChromeLobbyId;
  readonly sourceId: string;
  readonly tabId: number;
  readonly state: ChromeBridgeSourceState;
  readonly lastSequence: number;
  readonly lastAcceptedAtMs: number;
  readonly reason: string | null;
}

interface SourceRecord extends ChromeBridgeSourceSnapshot {
  readonly accountKey: BridgeAccountKey;
  readonly connectionGeneration: number;
  state: ChromeBridgeSourceState;
  lastSequence: number;
  lastAcceptedAtMs: number;
  reason: string | null;
  quarantined: boolean;
  connection: object | null;
}

type BridgeAccountKey = "CMD" | "IM" | "SABA" | "SBOBET" | "APSPORT" | "BTI";

interface CanonicalEpochIdentity {
  readonly kind: "CANONICAL";
  readonly lineage: string;
  readonly generation: number;
}

interface LegacyEpochIdentity {
  readonly kind: "LEGACY";
}

type EpochIdentity = CanonicalEpochIdentity | LegacyEpochIdentity;

interface AccountSourceOwner {
  readonly connectionGeneration: number;
  readonly sourceId: string;
  readonly sourceEpoch: string | null;
  readonly identity: EpochIdentity;
  active: boolean;
}

type OwnerAdmission = { readonly kind: "CURRENT" | "REPLACEMENT";
  readonly accountKey: BridgeAccountKey; readonly owner: AccountSourceOwner };

export interface ChromeBridgeRegistryOptions {
  readonly now?: () => number;
  readonly staleAfterMs?: number;
  readonly retireAfterMs?: number;
}

export interface ChromeBridgeIngestContext {
  readonly connectionGeneration: number;
}

export class ChromeBridgeRegistry {
  readonly #now: () => number;
  readonly #staleAfterMs: number;
  readonly #retireAfterMs: number;
  readonly #sources = new Map<string, SourceRecord>();
  readonly #accountOwners = new Map<BridgeAccountKey, AccountSourceOwner>();
  readonly #listeners = new Set<(envelope: ChromeBridgeEnvelope, context: ChromeBridgeIngestContext) => void>();
  readonly #connectionGenerations = new WeakMap<object, number>();
  #latestConnectionGeneration = 0;

  constructor(options: ChromeBridgeRegistryOptions = {}) {
    this.#now = options.now ?? Date.now;
    this.#staleAfterMs = options.staleAfterMs ?? 20_000;
    this.#retireAfterMs = options.retireAfterMs ?? 300_000;
  }

  subscribe(listener: (envelope: ChromeBridgeEnvelope, context: ChromeBridgeIngestContext) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  releaseConnection(connection: object): void {
    for (const [sourceId, source] of this.#sources) {
      if (source.connection !== connection) continue;
      this.#sources.delete(sourceId);
      const owner = this.#accountOwners.get(source.accountKey);
      if (owner !== undefined && owner.connectionGeneration === source.connectionGeneration &&
        owner.sourceId === source.sourceId) owner.active = false;
    }
  }

  ingest(envelope: ChromeBridgeEnvelope, connection: object | null = null): ChromeBridgeControlMessage {
    const acceptedAtMs = this.#now();
    this.#retireSources(acceptedAtMs);
    const connectionGeneration = this.#connectionGeneration(connection);
    if (connectionGeneration < this.#latestConnectionGeneration) return reject(envelope, "OUT_OF_ORDER");
    const admission = this.#admitOwner(envelope, connectionGeneration);
    if (admission === null) return reject(envelope, "OUT_OF_ORDER");
    let existing = admission.kind === "CURRENT" ? this.#sources.get(envelope.sourceId) : undefined;
    if (existing?.quarantined) return reject(envelope, "OUT_OF_ORDER");
    if (existing) {
      if (envelope.sequence === existing.lastSequence) return reject(envelope, "DUPLICATE");
      if (envelope.sequence < existing.lastSequence) return reject(envelope, "OUT_OF_ORDER");
      if (envelope.sequence !== existing.lastSequence + 1) {
        existing.state = "ERROR";
        existing.reason = "SEQUENCE_GAP";
        existing.quarantined = true;
        return reject(envelope, "SEQUENCE_GAP");
      }
    }

    if (admission.kind === "REPLACEMENT") {
      const prior = this.#accountOwners.get(admission.accountKey);
      if (prior !== undefined) this.#sources.delete(prior.sourceId);
      this.#accountOwners.set(admission.accountKey, admission.owner);
    }
    const record: SourceRecord = existing ?? {
      accountKey: admission.accountKey,
      connectionGeneration,
      lobby: envelope.lobby,
      sourceId: envelope.sourceId,
      tabId: envelope.tabId,
      state: "LIVE",
      lastSequence: envelope.sequence,
      lastAcceptedAtMs: acceptedAtMs,
      reason: null,
      quarantined: false,
      connection
    };
    record.state = "LIVE";
    record.lastSequence = envelope.sequence;
    record.lastAcceptedAtMs = acceptedAtMs;
    record.reason = null;
    if (connection !== null) record.connection = connection;
    admission.owner.active = true;
    this.#sources.set(envelope.sourceId, record);
    for (const listener of this.#listeners) listener(envelope, { connectionGeneration });
    return { version: 1, kind: "ACK", sourceId: envelope.sourceId, sequence: envelope.sequence };
  }

  #connectionGeneration(connection: object | null): number {
    if (connection === null) return 0;
    const existing = this.#connectionGenerations.get(connection);
    if (existing !== undefined) return existing;
    // The authenticated extension bridge is a single logical publisher. A
    // replacement connection advances this scalar permanently, so an older
    // socket cannot reclaim any source even after its per-source record moves.
    const generation = this.#latestConnectionGeneration + 1;
    this.#connectionGenerations.set(connection, generation);
    this.#latestConnectionGeneration = generation;
    return generation;
  }

  #admitOwner(envelope: ChromeBridgeEnvelope, connectionGeneration: number): OwnerAdmission | null {
    const accountKey = accountKeyForLobby(envelope.lobby);
    const identity = envelopeEpochIdentity(envelope.sourceEpoch);
    if (identity === null) return null;
    const owner = this.#accountOwners.get(accountKey);
    const proposed = (): AccountSourceOwner => ({ connectionGeneration, sourceId: envelope.sourceId,
      sourceEpoch: envelope.sourceEpoch ?? null, identity, active: true });
    if (owner === undefined) return { kind: "REPLACEMENT", accountKey, owner: proposed() };
    if (connectionGeneration < owner.connectionGeneration) return null;
    const sameSourceEpoch = owner.sourceId === envelope.sourceId &&
      owner.sourceEpoch === (envelope.sourceEpoch ?? null);
    if (sameSourceEpoch) {
      if (connectionGeneration === owner.connectionGeneration) {
        return owner.active ? { kind: "CURRENT", accountKey, owner } : null;
      }
      return { kind: "REPLACEMENT", accountKey, owner: proposed() };
    }
    if (owner.identity.kind === "CANONICAL" && identity.kind === "CANONICAL" &&
      owner.identity.lineage === identity.lineage && identity.generation <= owner.identity.generation) return null;
    if (connectionGeneration > owner.connectionGeneration) {
      return { kind: "REPLACEMENT", accountKey, owner: proposed() };
    }
    if (owner.identity.kind === "CANONICAL" && identity.kind === "CANONICAL" &&
      owner.identity.lineage === identity.lineage && identity.generation > owner.identity.generation) {
      return { kind: "REPLACEMENT", accountKey, owner: proposed() };
    }
    return null;
  }

  #retireSources(now: number): void {
    for (const [sourceId, source] of this.#sources) {
      if (now - source.lastAcceptedAtMs <= this.#retireAfterMs) continue;
      this.#sources.delete(sourceId);
      const owner = this.#accountOwners.get(source.accountKey);
      if (owner !== undefined && owner.connectionGeneration === source.connectionGeneration &&
        owner.sourceId === source.sourceId) owner.active = false;
    }
  }

  listSources(): readonly ChromeBridgeSourceSnapshot[] {
    const now = this.#now();
    this.#retireSources(now);
    return [...this.#sources.values()].map((source) => ({
      lobby: source.lobby,
      sourceId: source.sourceId,
      tabId: source.tabId,
      state: !source.quarantined && now - source.lastAcceptedAtMs > this.#staleAfterMs ? "STALE" : source.state,
      lastSequence: source.lastSequence,
      lastAcceptedAtMs: source.lastAcceptedAtMs,
      reason: source.reason
    }));
  }
}

function accountKeyForLobby(lobby: ChromeLobbyId): BridgeAccountKey {
  return lobby === "KSPORT" || lobby === "SBO" ? "SBOBET"
    : lobby === "TSPORT" ? "APSPORT" : lobby;
}

function envelopeEpochIdentity(sourceEpoch: string | undefined): EpochIdentity | null {
  if (sourceEpoch === undefined) return { kind: "LEGACY" };
  const match = /^(.+):(0|[1-9]\d*)$/u.exec(sourceEpoch);
  if (match === null) return null;
  const generation = Number(match[2]);
  return Number.isSafeInteger(generation)
    ? { kind: "CANONICAL", lineage: match[1]!, generation }
    : null;
}

function reject(
  envelope: ChromeBridgeEnvelope,
  reason: "DUPLICATE" | "OUT_OF_ORDER" | "SEQUENCE_GAP"
): ChromeBridgeControlMessage {
  return { version: 1, kind: "REJECT", sourceId: envelope.sourceId, sequence: envelope.sequence, reason };
}
