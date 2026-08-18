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
  readonly installationKey: string;
  readonly maxQueueBytes?: number;
  readonly setTimer?: (callback: () => void, delayMs: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
  readonly onOpen?: () => void | Promise<void>;
  readonly onSnapshotRequest?: (sourceId: string) => void | Promise<void>;
  readonly onSourceReload?: (sourceId: string) => void | Promise<void>;
  readonly onSourceNavigate?: (sourceId: string, url: string) => void | Promise<void>;
  readonly onFocusSelection?: (request: Omit<Extract<ChromeBridgeControlMessage,
    { readonly kind: "FOCUS_SELECTION" }>, "version" | "kind">) => void | Promise<void>;
}

export class LocalBridge {
  readonly #socketFactory: LocalBridgeOptions["socketFactory"];
  readonly #installationKey: string;
  readonly #maxQueueBytes: number;
  readonly #setTimer: (callback: () => void, delayMs: number) => unknown;
  readonly #clearTimer: (handle: unknown) => void;
  readonly #onOpen: () => void | Promise<void>;
  readonly #onSnapshotRequest: (sourceId: string) => void | Promise<void>;
  readonly #onSourceReload: (sourceId: string) => void | Promise<void>;
  readonly #onSourceNavigate: NonNullable<LocalBridgeOptions["onSourceNavigate"]>;
  readonly #onFocusSelection: NonNullable<LocalBridgeOptions["onFocusSelection"]>;
  readonly #queue: QueueEntry[] = [];
  #socket: BridgeSocket | null = null;
  #timer: unknown = null;
  #generation = 0;
  #reconnectAttempts = 0;
  #insertCounter = 0;

  constructor(options: LocalBridgeOptions) {
    if (!options.installationKey.trim()) throw new Error("INSTALLATION_KEY_REQUIRED");
    this.#socketFactory = options.socketFactory;
    this.#installationKey = options.installationKey;
    this.#maxQueueBytes = options.maxQueueBytes ?? 16 * 1024 * 1024;
    this.#setTimer = options.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.#clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
    this.#onOpen = options.onOpen ?? (() => undefined);
    this.#onSnapshotRequest = options.onSnapshotRequest ?? (() => undefined);
    this.#onSourceReload = options.onSourceReload ?? (() => undefined);
    this.#onSourceNavigate = options.onSourceNavigate ?? (() => undefined);
    this.#onFocusSelection = options.onFocusSelection ?? (() => undefined);
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
    if (this.#socket && (this.#socket.readyState === 0 || this.#socket.readyState === 1)) return;
    if (this.#timer !== null) {
      this.#clearTimer(this.#timer);
      this.#timer = null;
    }
    const socket = this.#socketFactory(LOOPBACK_URL, ["tool-chenh.v1", this.#installationKey]);
    this.#socket = socket;
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
      const delayMs = Math.min(30_000, 500 * 2 ** this.#reconnectAttempts++);
      this.#timer = this.#setTimer(() => {
        this.#timer = null;
        this.connect();
      }, delayMs);
    };
  }

  close(): void {
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
      if (parsed.data.kind === "REQUEST_SNAPSHOT") {
        try { void Promise.resolve(this.#onSnapshotRequest(parsed.data.sourceId)).catch(() => undefined); }
        catch { /* source recovery must not disrupt the bridge */ }
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
      if (parsed.data.kind === "FOCUS_SELECTION") {
        const { sourceId, providerEventId, providerMarketId, providerSelectionId } = parsed.data;
        try { void Promise.resolve(this.#onFocusSelection({ sourceId, providerEventId,
          providerMarketId, providerSelectionId })).catch(() => undefined); }
        catch { /* focus failure must not disrupt realtime collection */ }
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

}
