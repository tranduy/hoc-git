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
  state: ChromeBridgeSourceState;
  lastSequence: number;
  lastAcceptedAtMs: number;
  reason: string | null;
  quarantined: boolean;
}

export interface ChromeBridgeRegistryOptions {
  readonly now?: () => number;
  readonly staleAfterMs?: number;
}

export class ChromeBridgeRegistry {
  readonly #now: () => number;
  readonly #staleAfterMs: number;
  readonly #sources = new Map<string, SourceRecord>();
  readonly #listeners = new Set<(envelope: ChromeBridgeEnvelope) => void>();

  constructor(options: ChromeBridgeRegistryOptions = {}) {
    this.#now = options.now ?? Date.now;
    this.#staleAfterMs = options.staleAfterMs ?? 20_000;
  }

  subscribe(listener: (envelope: ChromeBridgeEnvelope) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  ingest(envelope: ChromeBridgeEnvelope): ChromeBridgeControlMessage {
    const existing = this.#sources.get(envelope.sourceId);
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

    const acceptedAtMs = this.#now();
    const record: SourceRecord = existing ?? {
      lobby: envelope.lobby,
      sourceId: envelope.sourceId,
      tabId: envelope.tabId,
      state: "LIVE",
      lastSequence: envelope.sequence,
      lastAcceptedAtMs: acceptedAtMs,
      reason: null,
      quarantined: false
    };
    record.state = "LIVE";
    record.lastSequence = envelope.sequence;
    record.lastAcceptedAtMs = acceptedAtMs;
    record.reason = null;
    this.#sources.set(envelope.sourceId, record);
    for (const listener of this.#listeners) listener(envelope);
    return { version: 1, kind: "ACK", sourceId: envelope.sourceId, sequence: envelope.sequence };
  }

  listSources(): readonly ChromeBridgeSourceSnapshot[] {
    const now = this.#now();
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

function reject(
  envelope: ChromeBridgeEnvelope,
  reason: "DUPLICATE" | "OUT_OF_ORDER" | "SEQUENCE_GAP"
): ChromeBridgeControlMessage {
  return { version: 1, kind: "REJECT", sourceId: envelope.sourceId, sequence: envelope.sequence, reason };
}
