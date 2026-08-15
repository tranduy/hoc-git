import {
  ChromeBridgeControlMessageSchema,
  type ChromeBridgeEnvelope
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
}

export class LocalBridge {
  readonly #socketFactory: LocalBridgeOptions["socketFactory"];
  readonly #installationKey: string;
  readonly #maxQueueBytes: number;
  readonly #setTimer: (callback: () => void, delayMs: number) => unknown;
  readonly #clearTimer: (handle: unknown) => void;
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
    this.#maxQueueBytes = options.maxQueueBytes ?? 1_048_576;
    this.#setTimer = options.setTimer ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.#clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  }

  get queueBytes(): number {
    return this.#queue.reduce((total, entry) => total + entry.bytes, 0);
  }

  pendingSequences(): number[] {
    return this.#ordered().map((entry) => entry.envelope.sequence);
  }

  enqueue(envelope: ChromeBridgeEnvelope, priority: QueueEntry["priority"] = "QUOTE"): void {
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
    this.#queue.push(entry);
    this.#enforceBound(entry);
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
      if (!parsed.success || parsed.data.kind !== "ACK") return;
      const acknowledgement = parsed.data;
      const index = this.#queue.findIndex((entry) =>
        entry.envelope.sourceId === acknowledgement.sourceId
        && entry.envelope.sequence === acknowledgement.sequence);
      if (index >= 0) this.#queue.splice(index, 1);
    } catch {
      // Invalid control traffic cannot mutate the send queue.
    }
  }

  #enforceBound(justAdded: QueueEntry): void {
    while (this.queueBytes > this.#maxQueueBytes) {
      const diagnosticIndex = this.#queue.findIndex((entry) => entry.priority === "DIAGNOSTIC");
      if (diagnosticIndex < 0) {
        const addedIndex = this.#queue.indexOf(justAdded);
        if (addedIndex >= 0) this.#queue.splice(addedIndex, 1);
        throw new Error("BRIDGE_QUEUE_FULL");
      }
      this.#queue.splice(diagnosticIndex, 1);
    }
  }
}
