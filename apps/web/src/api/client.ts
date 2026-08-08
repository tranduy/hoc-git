import type { AppSnapshot } from "@tool-chenh/contracts";

export type ConnectionState = "CONNECTING" | "LIVE" | "DISCONNECTED";

export type RealtimeMessage =
  | { readonly type: "SNAPSHOT"; readonly revision: number; readonly data: AppSnapshot }
  | { readonly type: "HEARTBEAT"; readonly revision: number; readonly serverTimeMs: number };

export interface SnapshotClientOptions {
  readonly initialSnapshot?: AppSnapshot;
  readonly onSnapshot: (snapshot: AppSnapshot) => void;
  readonly onConnectionState: (state: ConnectionState) => void;
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
  readonly #fetchSnapshot: typeof fetch;
  readonly #createWebSocket: (url: string) => WebSocket;

  constructor(options: SnapshotClientOptions) {
    this.#revision = options.initialSnapshot?.revision ?? -1;
    this.#onSnapshot = options.onSnapshot;
    this.#onConnectionState = options.onConnectionState;
    this.#fetchSnapshot = options.fetchSnapshot ?? window.fetch.bind(window);
    this.#createWebSocket = options.createWebSocket ?? ((url) => new WebSocket(url));
  }

  async start(): Promise<void> {
    this.#onConnectionState("CONNECTING");
    try {
      const response = await this.#fetchSnapshot("/api/snapshot", { cache: "no-store" });
      if (!response.ok) throw new Error(`Snapshot request failed with ${response.status}`);
      this.#acceptSnapshot(await response.json() as AppSnapshot);
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
        this.#retryAttempt = 0;
        this.#onConnectionState("LIVE");
      };
      socket.onmessage = (event) => this.#handleMessage(event.data);
      socket.onerror = () => this.#onConnectionState("DISCONNECTED");
      socket.onclose = () => this.#scheduleReconnect();
    } catch {
      this.#onConnectionState("DISCONNECTED");
      this.#scheduleReconnect();
    }
  }

  #handleMessage(payload: unknown): void {
    if (typeof payload !== "string") return;
    try {
      const message = JSON.parse(payload) as RealtimeMessage;
      if (message.type === "SNAPSHOT") this.#acceptSnapshot(message.data);
    } catch {
      // Ignore malformed realtime payloads until the next complete snapshot.
    }
  }

  #acceptSnapshot(snapshot: AppSnapshot): void {
    if (snapshot.revision <= this.#revision) return;
    this.#revision = snapshot.revision;
    this.#onSnapshot(snapshot);
  }

  #scheduleReconnect(): void {
    if (this.#stopped) return;
    this.#onConnectionState("DISCONNECTED");
    const delay = Math.min(1_000 * 2 ** this.#retryAttempt, 10_000);
    this.#retryAttempt += 1;
    this.#retryTimer = window.setTimeout(() => this.#connect(), delay);
  }
}
