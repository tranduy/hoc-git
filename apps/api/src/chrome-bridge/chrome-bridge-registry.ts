import type {
  ChromeBridgeControlMessage,
  ChromeBridgeEnvelope,
  ChromeBridgeSourceState,
  ChromeLobbyId
} from "@tool-chenh/contracts";
import {
  CHROME_BRIDGE_PROVIDER_ACCOUNT_IDS,
  chromeBridgeProviderAccountIdForLobby,
  type ChromeBridgeProviderAccountId
} from "./chrome-bridge-account.js";
import { ProviderAuthorityCoordinator } from "./provider-authority-coordinator.js";
import type { AuthorityIdentity, AuthorityObservation } from "./provider-authority-types.js";
import type { EnvelopeRejectReason } from "../diagnostics/pipeline-telemetry.js";

const MAX_LISTENERS = 8;

export interface ChromeBridgeSourceSnapshot {
  readonly lobby: ChromeLobbyId;
  readonly sourceId: string;
  readonly tabId: number;
  readonly state: ChromeBridgeSourceState;
  readonly lastSequence: number;
  readonly lastAcceptedAtMs: number;
  readonly reason: string | null;
  readonly authorityDisposition?: "ACTIVE" | "CANDIDATE";
}

interface SourceRecord extends ChromeBridgeSourceSnapshot {
  readonly identity: AuthorityIdentity;
  readonly connectionGeneration: number;
  state: ChromeBridgeSourceState;
  lastSequence: number;
  lastAcceptedAtMs: number;
  reason: string | null;
  quarantined: boolean;
  connection: object | null;
  authorityDisposition: "ACTIVE" | "CANDIDATE";
}

interface AccountTransportSlot {
  active: SourceRecord | null;
  candidate: SourceRecord | null;
  retiredActiveTransportIdentity: AuthorityIdentity | null;
}

export interface ChromeBridgeRegistryOptions {
  readonly now?: () => number;
  readonly staleAfterMs?: number;
  readonly retireAfterMs?: number;
  readonly authorityCoordinator?: ProviderAuthorityCoordinator;
  readonly onRejected?: (accountId: ChromeBridgeProviderAccountId, reason: EnvelopeRejectReason) => void;
}

export interface ChromeBridgeIngestContext {
  readonly connectionGeneration: number;
  readonly authorityIdentity: AuthorityIdentity;
  readonly authorityObservation: AuthorityObservation;
}

export interface ChromeBridgeIngestResult {
  readonly control: ChromeBridgeControlMessage;
  readonly context: ChromeBridgeIngestContext | null;
}

export class ChromeBridgeRegistry {
  readonly #now: () => number;
  readonly #staleAfterMs: number;
  readonly #retireAfterMs: number;
  readonly #authorityCoordinator: ProviderAuthorityCoordinator;
  readonly #onRejected: ((accountId: ChromeBridgeProviderAccountId, reason: EnvelopeRejectReason) => void) | null;
  readonly #slots: ReadonlyMap<ChromeBridgeProviderAccountId, AccountTransportSlot>;
  readonly #listeners = new Set<(envelope: ChromeBridgeEnvelope, context: ChromeBridgeIngestContext) => void>();
  readonly #connectionGenerations = new WeakMap<object, number>();
  readonly #revokedConnections = new WeakSet<object>();
  readonly #implicitConnection = {};
  #latestConnectionGeneration = 0;

  constructor(options: ChromeBridgeRegistryOptions = {}) {
    this.#now = options.now ?? Date.now;
    this.#staleAfterMs = options.staleAfterMs ?? 20_000;
    this.#retireAfterMs = options.retireAfterMs ?? 300_000;
    this.#authorityCoordinator = options.authorityCoordinator ?? new ProviderAuthorityCoordinator();
    this.#onRejected = options.onRejected ?? null;
    this.#slots = new Map(CHROME_BRIDGE_PROVIDER_ACCOUNT_IDS.map((accountId) => [accountId, {
      active: null,
      candidate: null,
      retiredActiveTransportIdentity: null
    }]));
    this.#authorityCoordinator.subscribe((transition) => this.#reconcile(transition.accountId));
  }

  get authorityCoordinator(): ProviderAuthorityCoordinator {
    return this.#authorityCoordinator;
  }

  subscribe(listener: (envelope: ChromeBridgeEnvelope, context: ChromeBridgeIngestContext) => void): () => void {
    if (this.#listeners.size >= MAX_LISTENERS) throw new Error("CHROME_BRIDGE_LISTENER_LIMIT");
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  registerConnection(connection: object): void {
    this.#connectionGeneration(connection);
  }

  releaseConnection(connection: object): void {
    this.#revokedConnections.add(connection);
    for (const [accountId, slot] of this.#slots) {
      if (slot.candidate?.connection === connection) {
        this.#authorityCoordinator.release(slot.candidate.identity);
        slot.candidate = null;
      }
      if (slot.active?.connection === connection) {
        slot.retiredActiveTransportIdentity = slot.active.identity;
        this.#authorityCoordinator.release(slot.active.identity);
        slot.active = null;
      }
      this.#reconcile(accountId);
    }
  }

  ingest(envelope: ChromeBridgeEnvelope, connection: object | null = null): ChromeBridgeControlMessage {
    return this.ingestDetailed(envelope, connection).control;
  }

  ingestDetailed(envelope: ChromeBridgeEnvelope, connection: object | null = null,
    beforeDelivery?: (context: ChromeBridgeIngestContext) => void): ChromeBridgeIngestResult {
    const acceptedAtMs = this.#now();
    this.#retireSources(acceptedAtMs);
    const actualConnection = connection ?? this.#implicitConnection;
    if (this.#revokedConnections.has(actualConnection)) {
      return { control: reject(envelope, "OUT_OF_ORDER"), context: null };
    }
    const connectionGeneration = this.#connectionGeneration(actualConnection);
    const accountId = chromeBridgeProviderAccountIdForLobby(envelope.lobby);
    const sourceEpoch = normalizedSourceEpoch(envelope);
    if (sourceEpoch === null) {
      this.#onRejected?.(accountId, "RETIRED_EPOCH");
      return { control: reject(envelope, "OUT_OF_ORDER"), context: null };
    }
    const identity: AuthorityIdentity = Object.freeze({ accountId, sourceId: envelope.sourceId,
      sourceEpoch, connectionGeneration });

    if (envelope.request.replayed === true) {
      return { control: ack(envelope), context: null };
    }

    const observation = this.#authorityCoordinator.observe(identity,
      envelope.transport === "TAB_STATE" || envelope.transport === "WS_STATE" ? "TRANSPORT" : "CANDIDATE_DATA");
    if (observation.disposition === "REJECTED") {
      this.#onRejected?.(accountId, "RETIRED_EPOCH");
      return { control: reject(envelope, "OUT_OF_ORDER"), context: null };
    }
    const slot = this.#slot(accountId);
    if (slot.retiredActiveTransportIdentity !== null &&
      sameIdentity(slot.retiredActiveTransportIdentity, identity)) {
      this.#onRejected?.(accountId, "RETIRED_EPOCH");
      return { control: reject(envelope, "OUT_OF_ORDER"), context: null };
    }
    this.#reconcile(accountId);
    const role = observation.disposition;
    let record = role === "ACTIVE" ? slot.active : slot.candidate;
    if (record !== null && !sameIdentity(record.identity, identity)) record = null;
    if (record?.quarantined === true) {
      return { control: reject(envelope, "OUT_OF_ORDER"), context: null };
    }
    if (record !== null) {
      if (envelope.sequence === record.lastSequence) {
        return { control: reject(envelope, "DUPLICATE"), context: null };
      }
      if (envelope.sequence < record.lastSequence) {
        return { control: reject(envelope, "OUT_OF_ORDER"), context: null };
      }
      if (envelope.sequence !== record.lastSequence + 1) {
        record.state = "ERROR";
        record.reason = "SEQUENCE_GAP";
        record.quarantined = true;
        this.#onRejected?.(accountId, "SEQUENCE_GAP");
        return { control: reject(envelope, "SEQUENCE_GAP"), context: null };
      }
    }

    const retained: SourceRecord = record ?? {
      identity,
      connectionGeneration,
      lobby: envelope.lobby,
      sourceId: envelope.sourceId,
      tabId: envelope.tabId,
      state: "LIVE",
      lastSequence: envelope.sequence,
      lastAcceptedAtMs: acceptedAtMs,
      reason: null,
      quarantined: false,
      connection,
      authorityDisposition: role
    };
    retained.state = "LIVE";
    retained.lastSequence = envelope.sequence;
    retained.lastAcceptedAtMs = acceptedAtMs;
    retained.reason = null;
    retained.authorityDisposition = role;
    if (connection !== null) retained.connection = connection;
    if (role === "ACTIVE") slot.active = retained;
    else slot.candidate = retained;

    const context: ChromeBridgeIngestContext = {
      connectionGeneration,
      authorityIdentity: identity,
      authorityObservation: observation
    };
    // Control ownership must be attached before a one-envelope HTTP baseline
    // can promote from inside a data-plane listener and publish externally.
    beforeDelivery?.(context);
    for (const listener of this.#listeners) listener(envelope, context);
    this.#reconcile(accountId);
    return { control: ack(envelope), context };
  }

  listSources(): readonly ChromeBridgeSourceSnapshot[] {
    const now = this.#now();
    this.#retireSources(now);
    const sources: ChromeBridgeSourceSnapshot[] = [];
    for (const accountId of CHROME_BRIDGE_PROVIDER_ACCOUNT_IDS) {
      const slot = this.#slot(accountId);
      if (slot.active !== null) sources.push(this.#snapshot(slot.active, now));
      if (slot.candidate !== null) sources.push(this.#snapshot(slot.candidate, now));
    }
    return sources;
  }

  listActiveSources(): readonly ChromeBridgeSourceSnapshot[] {
    const now = this.#now();
    this.#retireSources(now);
    const sources: ChromeBridgeSourceSnapshot[] = [];
    for (const accountId of CHROME_BRIDGE_PROVIDER_ACCOUNT_IDS) {
      const active = this.#slot(accountId).active;
      if (active !== null) sources.push(this.#snapshot(active, now));
    }
    return sources;
  }

  #connectionGeneration(connection: object): number {
    const existing = this.#connectionGenerations.get(connection);
    if (existing !== undefined) return existing;
    const generation = ++this.#latestConnectionGeneration;
    this.#connectionGenerations.set(connection, generation);
    return generation;
  }

  #retireSources(now: number): void {
    for (const [accountId, slot] of this.#slots) {
      if (slot.candidate !== null && now - slot.candidate.lastAcceptedAtMs > this.#retireAfterMs) {
        if (slot.candidate.connection !== null) this.#revokedConnections.add(slot.candidate.connection);
        this.#authorityCoordinator.release(slot.candidate.identity);
        slot.candidate = null;
      }
      if (slot.active !== null && now - slot.active.lastAcceptedAtMs > this.#retireAfterMs) {
        if (slot.active.connection !== null) this.#revokedConnections.add(slot.active.connection);
        slot.retiredActiveTransportIdentity = slot.active.identity;
        this.#authorityCoordinator.release(slot.active.identity);
        slot.active = null;
      }
      this.#reconcile(accountId);
    }
  }

  #reconcile(accountId: ChromeBridgeProviderAccountId): void {
    const slot = this.#slot(accountId);
    const authority = this.#authorityCoordinator.snapshot(accountId);
    const records = [slot.active, slot.candidate].filter((record): record is SourceRecord => record !== null);
    const active = records.find((record) => authority.active !== null && sameIdentity(record.identity, authority.active)) ?? null;
    const candidate = records.find((record) => authority.candidate !== null &&
      sameIdentity(record.identity, authority.candidate)) ?? null;
    if (active !== null) {
      active.authorityDisposition = "ACTIVE";
      if (slot.retiredActiveTransportIdentity === null ||
        !sameIdentity(slot.retiredActiveTransportIdentity, active.identity)) {
        slot.retiredActiveTransportIdentity = null;
      }
    }
    if (candidate !== null) candidate.authorityDisposition = "CANDIDATE";
    slot.active = active;
    slot.candidate = candidate;
  }

  #snapshot(source: SourceRecord, now: number): ChromeBridgeSourceSnapshot {
    return {
      lobby: source.lobby,
      sourceId: source.sourceId,
      tabId: source.tabId,
      state: !source.quarantined && now - source.lastAcceptedAtMs > this.#staleAfterMs ? "STALE" : source.state,
      lastSequence: source.lastSequence,
      lastAcceptedAtMs: source.lastAcceptedAtMs,
      reason: source.reason,
      authorityDisposition: source.authorityDisposition
    };
  }

  #slot(accountId: ChromeBridgeProviderAccountId): AccountTransportSlot {
    return this.#slots.get(accountId)!;
  }
}

function normalizedSourceEpoch(envelope: ChromeBridgeEnvelope): string | null {
  if (envelope.sourceEpoch === undefined) return `legacy:${envelope.sourceId}`;
  const match = /^(.+):(0|[1-9]\d*)$/u.exec(envelope.sourceEpoch);
  if (match === null || !Number.isSafeInteger(Number(match[2]))) return null;
  return envelope.sourceEpoch;
}

function sameIdentity(left: AuthorityIdentity, right: AuthorityIdentity): boolean {
  return left.accountId === right.accountId && left.sourceId === right.sourceId &&
    left.sourceEpoch === right.sourceEpoch && left.connectionGeneration === right.connectionGeneration;
}

function ack(envelope: ChromeBridgeEnvelope): ChromeBridgeControlMessage {
  return { version: 1, kind: "ACK", sourceId: envelope.sourceId, sequence: envelope.sequence };
}

function reject(
  envelope: ChromeBridgeEnvelope,
  reason: "DUPLICATE" | "OUT_OF_ORDER" | "SEQUENCE_GAP"
): ChromeBridgeControlMessage {
  return { version: 1, kind: "REJECT", sourceId: envelope.sourceId, sequence: envelope.sequence, reason };
}
