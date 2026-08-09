import {
  AppSnapshotSchema,
  RealtimeMessageSchema,
  type AppSnapshot,
  type RealtimeMessage
} from "@tool-chenh/contracts";

export type ConnectionState = "CONNECTING" | "LIVE" | "DISCONNECTED";

export interface SnapshotClientOptions {
  readonly initialSnapshot?: AppSnapshot;
  readonly onSnapshot: (snapshot: AppSnapshot) => void;
  readonly onConnectionState: (state: ConnectionState) => void;
  readonly onDiagnostic?: (message: string) => void;
  readonly fetchSnapshot?: typeof fetch;
  readonly createWebSocket?: (url: string) => WebSocket;
}

function realtimeUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/api/realtime`;
}

export class SnapshotClient {
  #revision: number;
  #retryAttempt = 0;
  #stopped = false;
  #socket: WebSocket | undefined;
  #retryTimer: number | undefined;
  readonly #onSnapshot: (snapshot: AppSnapshot) => void;
  readonly #onConnectionState: (state: ConnectionState) => void;
  readonly #onDiagnostic: (message: string) => void;
  readonly #fetchSnapshot: typeof fetch;
  readonly #createWebSocket: (url: string) => WebSocket;

  constructor(options: SnapshotClientOptions) {
    this.#revision = options.initialSnapshot?.revision ?? -1;
    this.#onSnapshot = options.onSnapshot;
    this.#onConnectionState = options.onConnectionState;
    this.#onDiagnostic = options.onDiagnostic ?? (() => {});
    this.#fetchSnapshot = options.fetchSnapshot ?? window.fetch.bind(window);
    this.#createWebSocket = options.createWebSocket ?? ((url) => new WebSocket(url));
  }

  async start(): Promise<void> {
    this.#onConnectionState("CONNECTING");
    try {
      const response = await this.#fetchSnapshot("/api/snapshot", { cache: "no-store" });
      if (!response.ok) throw new Error(`Snapshot request failed with ${response.status}`);
      const parsed = AppSnapshotSchema.safeParse(await response.json());
      if (!parsed.success) {
        this.#onDiagnostic("Ignored invalid snapshot response.");
      } else {
        this.#acceptSnapshot(parsed.data);
      }
    } catch {
      this.#onConnectionState("DISCONNECTED");
    }
    if (!this.#stopped) this.#connect();
  }

  stop(): void {
    this.#stopped = true;
    if (this.#retryTimer !== undefined) window.clearTimeout(this.#retryTimer);
    this.#socket?.close();
  }

  #connect(): void {
    this.#onConnectionState("CONNECTING");
    try {
      const socket = this.#createWebSocket(realtimeUrl());
      this.#socket = socket;
      socket.onopen = () => {
        if (this.#socket !== socket) return;
        this.#retryAttempt = 0;
      };
      socket.onmessage = (event) => {
        if (this.#socket === socket) this.#handleMessage(event.data);
      };
      socket.onerror = () => {
        if (this.#socket === socket) this.#onConnectionState("DISCONNECTED");
      };
      socket.onclose = () => {
        if (this.#socket !== socket) return;
        this.#socket = undefined;
        this.#scheduleReconnect();
      };
    } catch {
      this.#onConnectionState("DISCONNECTED");
      this.#scheduleReconnect();
    }
  }

  #handleMessage(payload: unknown): void {
    if (typeof payload !== "string") return;
    try {
      const parsed = RealtimeMessageSchema.safeParse(JSON.parse(payload));
      if (!parsed.success) {
        this.#onDiagnostic("Ignored invalid realtime message.");
        return;
      }
      const message: RealtimeMessage = parsed.data;
      if (message.type === "SNAPSHOT") this.#acceptRealtimeSnapshot(message.data);
    } catch {
      this.#onDiagnostic("Ignored invalid realtime message.");
    }
  }

  #acceptSnapshot(snapshot: AppSnapshot): void {
    if (snapshot.revision <= this.#revision) return;
    this.#revision = snapshot.revision;
    this.#onSnapshot(snapshot);
  }

  #acceptRealtimeSnapshot(snapshot: AppSnapshot): void {
    if (snapshot.revision < this.#revision) return;
    if (snapshot.revision > this.#revision) {
      this.#revision = snapshot.revision;
      this.#onSnapshot(snapshot);
    }
    this.#onConnectionState("LIVE");
  }

  #scheduleReconnect(): void {
    if (this.#stopped) return;
    this.#onConnectionState("DISCONNECTED");
    const delay = Math.min(1_000 * 2 ** this.#retryAttempt, 10_000);
    this.#retryAttempt += 1;
    this.#retryTimer = window.setTimeout(() => this.#connect(), delay);
  }
}
