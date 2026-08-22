import {
  ChromeBridgeControlMessageSchema,
  type ChromeBridgeEnvelope,
  type ChromeBridgeControlMessage
} from "@tool-chenh/contracts";

const LOOPBACK_URL = "ws://127.0.0.1:4310/api/chrome-bridge";

export interface BridgeSocket {
  readyState: number;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  send(data: string): void;
  close(): void;
}

interface QueueEntry {
  readonly envelope: ChromeBridgeEnvelope;
  readonly serialized: string;
  readonly bytes: number;
  readonly priority: "QUOTE" | "DIAGNOSTIC";
  readonly insertedAt: number;
  sentGeneration: number | null;
}

export interface LocalBridgeOptions {
  readonly socketFactory: (url: string, protocols: string[]) => BridgeSocket;
  readonly readinessProbe?: () => boolean | Promise<boolean>;
  readonly installationKey: string;
  readonly maxQueueBytes?: number;
  readonly now?: () => number;
  readonly livenessTimeoutMs?: number;
  readonly setTimer?: (callback: () => void, delayMs: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
  readonly onOpen?: () => void | Promise<void>;
  readonly onSnapshotRequest?: (sourceId: string) => void | Promise<void>;
  readonly onSourceReload?: (sourceId: string) => void | Promise<void>;
  readonly onSourceNavigate?: (sourceId: string, url: string) => void | Promise<void>;
  readonly onSourceEnsure?: (lobby: ChromeBridgeEnvelope["lobby"], url: string) => void | Promise<void>;
  readonly onSourceRestore?: (lobby: ChromeBridgeEnvelope["lobby"]) => void | Promise<void>;
  readonly onFocusSelection?: (request: Omit<Extract<ChromeBridgeControlMessage,
    { readonly kind: "FOCUS_SELECTION" }>, "version" | "kind">) => void | Promise<void>;
  readonly onSelectionPriceProbe?: (request: Omit<Extract<ChromeBridgeControlMessage,
    { readonly kind: "PROBE_SELECTION_PRICE" }>, "version" | "kind">) => void | Promise<void>;
  readonly onCmdHiddenMarketProbe?: (request: Omit<Extract<ChromeBridgeControlMessage,
    { readonly kind: "PROBE_CMD_HIDDEN_MARKETS" }>, "version" | "kind">) => void | Promise<void>;
}

export class LocalBridge {
  readonly #socketFactory: LocalBridgeOptions["socketFactory"];
  readonly #readinessProbe: NonNullable<LocalBridgeOptions["readinessProbe"]>;
  readonly #installationKey: string;
  readonly #maxQueueBytes: number;
  readonly #now: () => number;
  readonly #livenessTimeoutMs: number;
  readonly #setTimer: (callback: () => void, delayMs: number) => unknown;
  readonly #clearTimer: (handle: unknown) => void;
  readonly #onOpen: () => void | Promise<void>;
  readonly #onSnapshotRequest: (sourceId: string) => void | Promise<void>;
  readonly #onSourceReload: (sourceId: string) => void | Promise<void>;
  readonly #onSourceNavigate: NonNullable<LocalBridgeOptions["onSourceNavigate"]>;
  readonly #onSourceEnsure: NonNullable<LocalBridgeOptions["onSourceEnsure"]>;
  readonly #onSourceRestore: NonNullable<LocalBridgeOptions["onSourceRestore"]>;
  readonly #onFocusSelection: NonNullable<LocalBridgeOptions["onFocusSelection"]>;
  readonly #onSelectionPriceProbe: NonNullable<LocalBridgeOptions["onSelectionPriceProbe"]>;
  readonly #onCmdHiddenMarketProbe: NonNullable<LocalBridgeOptions["onCmdHiddenMarketProbe"]>;
  readonly #queue: QueueEntry[] = [];
  #socket: BridgeSocket | null = null;
  #timer: unknown = null;
  #generation = 0;
  #reconnectAttempts = 0;
  #insertCounter = 0;
  #probeInFlight = false;
  #connectToken = 0;
  #sourceRecoveryTail: Promise<void> | null = null;
  #snapshotRecoveryTail: Promise<void> | null = null;
  #lastServerContactAtMs = 0;

  constructor(options: LocalBridgeOptions) {
    if (!options.installationKey.trim()) throw new Error("INSTALLATION_KEY_REQUIRED");
    this.#socketFactory = options.socketFactory;
    this.#readinessProbe = options.readinessProbe ?? (() => true);
    this.#installationKey = options.installationKey;
    this.#maxQueueBytes = options.maxQueueBytes ?? 16 * 1024 * 1024;
    this.#now = options.now ?? Date.now;
    this.#livenessTimeoutMs = options.livenessTimeoutMs ?? 25_000;
    if (!Number.isFinite(this.#livenessTimeoutMs) || this.#livenessTimeoutMs < 1_000) {
      throw new Error("BRIDGE_LIVENESS_TIMEOUT_INVALID");
    }
    this.#setTimer = options.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.#clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
    this.#onOpen = options.onOpen ?? (() => undefined);
    this.#onSnapshotRequest = options.onSnapshotRequest ?? (() => undefined);
    this.#onSourceReload = options.onSourceReload ?? (() => undefined);
    this.#onSourceNavigate = options.onSourceNavigate ?? (() => undefined);
    this.#onSourceEnsure = options.onSourceEnsure ?? (() => undefined);
    this.#onSourceRestore = options.onSourceRestore ?? (() => undefined);
    this.#onFocusSelection = options.onFocusSelection ?? (() => undefined);
    this.#onSelectionPriceProbe = options.onSelectionPriceProbe ?? (() => undefined);
    this.#onCmdHiddenMarketProbe = options.onCmdHiddenMarketProbe ?? (() => undefined);
  }

  get queueBytes(): number {
    return this.#queue.reduce((total, entry) => total + entry.bytes, 0);
  }

  pendingSequences(): number[] {
    return this.#ordered().map((entry) => entry.envelope.sequence);
  }

  async enqueue(envelope: ChromeBridgeEnvelope, priority: QueueEntry["priority"] = "QUOTE"): Promise<void> {
    const serialized = JSON.stringify(envelope);
    const entry: QueueEntry = {
      envelope,
      serialized,
      bytes: new TextEncoder().encode(serialized).byteLength,
      priority,
      insertedAt: this.#insertCounter++,
      sentGeneration: null
    };
    if (entry.bytes > this.#maxQueueBytes) throw new Error("BRIDGE_QUEUE_ITEM_TOO_LARGE");
    while (this.queueBytes + entry.bytes > this.#maxQueueBytes) {
      const diagnosticIndex = this.#queue.findIndex((queued) => queued.priority === "DIAGNOSTIC");
      if (diagnosticIndex >= 0) {
        this.#queue.splice(diagnosticIndex, 1);
        continue;
      }
      if (priority === "DIAGNOSTIC") return;
      const sameSourceIndex = this.#queue.findIndex((queued) => queued.priority === "QUOTE" &&
        queued.envelope.sourceId === envelope.sourceId);
      const quoteIndex = sameSourceIndex >= 0 ? sameSourceIndex :
        this.#queue.findIndex((queued) => queued.priority === "QUOTE");
      if (quoteIndex < 0) return;
      this.#queue.splice(quoteIndex, 1);
    }
    this.#queue.push(entry);
    this.#flush();
  }

  connect(): void {
    if (this.#socket && (this.#socket.readyState === 0 || this.#socket.readyState === 1)) {
      if (this.#now() - this.#lastServerContactAtMs <= this.#livenessTimeoutMs) return;
      const staleSocket = this.#socket;
      this.#socket = null;
      staleSocket.close();
    }
    if (this.#probeInFlight) return;
    if (this.#timer !== null) {
      this.#clearTimer(this.#timer);
      this.#timer = null;
    }
    const token = ++this.#connectToken;
    let readiness: boolean | Promise<boolean>;
    try {
      readiness = this.#readinessProbe();
    } catch {
      this.#scheduleReconnect();
      return;
    }
    if (typeof (readiness as Promise<boolean>)?.then === "function") {
      this.#probeInFlight = true;
      void Promise.resolve(readiness).then((ready) => {
        if (token !== this.#connectToken) return;
        this.#probeInFlight = false;
        if (ready) this.#openSocket();
        else this.#scheduleReconnect();
      }).catch(() => {
        if (token !== this.#connectToken) return;
        this.#probeInFlight = false;
        this.#scheduleReconnect();
      });
      return;
    }
    if (!readiness) {
      this.#scheduleReconnect();
      return;
    }
    this.#openSocket();
  }

  #openSocket(): void {
    let socket: BridgeSocket;
    try {
      socket = this.#socketFactory(LOOPBACK_URL, ["tool-chenh.v1", this.#installationKey]);
    } catch {
      this.#scheduleReconnect();
      return;
    }
    this.#socket = socket;
    this.#lastServerContactAtMs = this.#now();
    const generation = ++this.#generation;
    socket.onopen = () => {
      if (this.#socket !== socket) return;
      this.#reconnectAttempts = 0;
      for (const entry of this.#queue) entry.sentGeneration = null;
      this.#flush(generation);
      try { void Promise.resolve(this.#onOpen()).catch(() => undefined); }
      catch { /* replay failure must not close the bridge */ }
    };
    socket.onmessage = (event) => this.#handleMessage(event.data);
    socket.onclose = () => {
      if (this.#socket !== socket) return;
      this.#socket = null;
      this.#scheduleReconnect();
    };
  }

  #scheduleReconnect(): void {
    if (this.#timer !== null) return;
    const delayMs = Math.min(30_000, 500 * 2 ** this.#reconnectAttempts++);
    this.#timer = this.#setTimer(() => {
      this.#timer = null;
      this.connect();
    }, delayMs);
  }

  close(): void {
    this.#connectToken++;
    this.#probeInFlight = false;
    if (this.#timer !== null) this.#clearTimer(this.#timer);
    this.#timer = null;
    const socket = this.#socket;
    this.#socket = null;
    socket?.close();
  }

  #ordered(): QueueEntry[] {
    return [...this.#queue].sort((left, right) =>
      left.envelope.sourceId.localeCompare(right.envelope.sourceId)
      || left.envelope.sequence - right.envelope.sequence
      || left.insertedAt - right.insertedAt);
  }

  #flush(generation = this.#generation): void {
    if (!this.#socket || this.#socket.readyState !== 1) return;
    for (const entry of this.#ordered()) {
      if (entry.sentGeneration === generation) continue;
      this.#socket.send(entry.serialized);
      entry.sentGeneration = generation;
    }
  }

  #handleMessage(raw: unknown): void {
    if (typeof raw !== "string") return;
    try {
      const parsed = ChromeBridgeControlMessageSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) return;
      this.#lastServerContactAtMs = this.#now();
      if (parsed.data.kind === "REQUEST_SNAPSHOT") {
        this.#enqueueSnapshotRecovery(parsed.data.sourceId);
        return;
      }
      if (parsed.data.kind === "RELOAD_SOURCE") {
        try { void Promise.resolve(this.#onSourceReload(parsed.data.sourceId)).catch(() => undefined); }
        catch { /* tab recovery must not disrupt the bridge */ }
        return;
      }
      if (parsed.data.kind === "NAVIGATE_SOURCE") {
        try { void Promise.resolve(this.#onSourceNavigate(parsed.data.sourceId, parsed.data.url)).catch(() => undefined); }
        catch { /* fresh launch recovery must not disrupt the bridge */ }
        return;
      }
      if (parsed.data.kind === "ENSURE_SOURCE") {
        const { lobby, url } = parsed.data;
        this.#enqueueSourceRecovery(() => this.#onSourceEnsure(lobby, url));
        return;
      }
      if (parsed.data.kind === "RESTORE_SOURCE") {
        const { lobby } = parsed.data;
        this.#enqueueSourceRecovery(() => this.#onSourceRestore(lobby));
        return;
      }
      if (parsed.data.kind === "FOCUS_SELECTION") {
        const { sourceId, providerEventId, providerMarketId, providerSelectionId } = parsed.data;
        try { void Promise.resolve(this.#onFocusSelection({ sourceId, providerEventId,
          providerMarketId, providerSelectionId })).catch(() => undefined); }
        catch { /* focus failure must not disrupt realtime collection */ }
        return;
      }
      if (parsed.data.kind === "PROBE_SELECTION_PRICE") {
        const { sourceId, requestId, providerEventId, providerMarketId, providerSelectionId,
          eventLabel, participantA, participantB, marketType, scope, selection, line } = parsed.data;
        try { void Promise.resolve(this.#onSelectionPriceProbe({ sourceId, requestId, providerEventId,
          providerMarketId, providerSelectionId, eventLabel, participantA, participantB,
          marketType, scope, selection, line }))
          .catch(() => undefined); }
        catch { /* visible price probe failure must not disrupt realtime collection */ }
        return;
      }
      if (parsed.data.kind === "PROBE_CMD_HIDDEN_MARKETS") {
        const { sourceId, requestId, providerEventId } = parsed.data;
        try { void Promise.resolve(this.#onCmdHiddenMarketProbe({ sourceId, requestId, providerEventId }))
          .catch(() => undefined); }
        catch { /* probe failure must not disrupt realtime collection */ }
        return;
      }
      if (parsed.data.kind === "REJECT") {
        const rejection = parsed.data;
        if (rejection.sourceId === null) return;
        if (rejection.reason === "SEQUENCE_GAP") {
          // A bounded/offline queue can legitimately coalesce old frames. If
          // the API restarts while such a hole exists, replaying that same
          // backlog would make the server close every new socket forever.
          // Drop only the rejected source and republish its authoritative
          // snapshot; healthy sources remain queued and connected.
          for (let index = this.#queue.length - 1; index >= 0; index--) {
            if (this.#queue[index]?.envelope.sourceId === rejection.sourceId) this.#queue.splice(index, 1);
          }
          try { void Promise.resolve(this.#onSnapshotRequest(rejection.sourceId)).catch(() => undefined); }
          catch { /* source recovery must not disrupt the bridge */ }
          return;
        }
        if (rejection.sequence !== null) {
          const index = this.#queue.findIndex((entry) => entry.envelope.sourceId === rejection.sourceId
            && entry.envelope.sequence === rejection.sequence);
          if (index >= 0) this.#queue.splice(index, 1);
        }
        return;
      }
      if (parsed.data.kind !== "ACK") return;
      const acknowledgement = parsed.data;
      const index = this.#queue.findIndex((entry) =>
        entry.envelope.sourceId === acknowledgement.sourceId
        && entry.envelope.sequence === acknowledgement.sequence);
      if (index >= 0) {
        this.#queue.splice(index, 1);
      }
    } catch {
      // Invalid control traffic cannot mutate the send queue.
    }
  }

  #enqueueSourceRecovery(task: () => void | Promise<void>): void {
    const invoke = async (): Promise<void> => {
      try { await task(); } catch { /* one source failure must not block the remaining reset */ }
    };
    const operation = this.#sourceRecoveryTail === null
      ? invoke()
      : this.#sourceRecoveryTail.then(invoke, invoke);
    const settled = operation.finally(() => {
      if (this.#sourceRecoveryTail === settled) this.#sourceRecoveryTail = null;
    });
    this.#sourceRecoveryTail = settled;
  }

  #enqueueSnapshotRecovery(sourceId: string): void {
    const invoke = async (): Promise<void> => {
      try { await this.#onSnapshotRequest(sourceId); }
      catch { /* one snapshot failure must not block the next provider */ }
    };
    const operation = this.#snapshotRecoveryTail === null
      ? invoke()
      : this.#snapshotRecoveryTail.then(invoke, invoke);
    const settled = operation.finally(() => {
      if (this.#snapshotRecoveryTail === settled) this.#snapshotRecoveryTail = null;
    });
    this.#snapshotRecoveryTail = settled;
  }

}
