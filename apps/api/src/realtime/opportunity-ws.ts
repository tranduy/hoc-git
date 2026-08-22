import {
  RealtimeMessageSchema,
  type AppSnapshot,
  type RealtimeMessage
} from "@tool-chenh/contracts";
import type { FastifyInstance } from "fastify";
import type WebSocket from "ws";
import type { Runtime } from "../runtime.js";
import type { CatalogRevisionStore, StoredCatalogRevision } from "../catalog/catalog-revision-store.js";

const webSocketOpen = 1;

interface Client {
  readonly socket: WebSocket;
  lastRevision: number;
  lastCatalogSequence: number;
}

export interface BoundedSocket {
  readonly readyState: number;
  readonly bufferedAmount: number;
  close(code?: number, reason?: string): void;
  terminate(): void;
  send(payload: string, callback?: (error?: Error | null) => void): void;
}

function serialize(message: RealtimeMessage): string {
  return JSON.stringify(RealtimeMessageSchema.parse(message));
}

function closeQuietly(socket: BoundedSocket, code: number, reason: string): void {
  try {
    socket.close(code, reason);
  } catch {
    socket.terminate();
  }
}

export function sendBoundedMessage(
  socket: BoundedSocket,
  payload: string,
  maxBufferedBytes: number
): boolean {
  if (socket.readyState !== webSocketOpen) return false;
  const payloadBytes = Buffer.byteLength(payload, "utf8");
  if (payloadBytes > maxBufferedBytes) {
    closeQuietly(socket, 1009, "message too large");
    return false;
  }
  if (socket.bufferedAmount + payloadBytes > maxBufferedBytes) {
    closeQuietly(socket, 1013, "client too slow");
    return false;
  }
  try {
    socket.send(payload, (error) => {
      if (error != null) closeQuietly(socket, 1011, "send failed");
    });
    return true;
  } catch {
    closeQuietly(socket, 1011, "send failed");
    return false;
  }
}

export function registerOpportunityWebsocket(
  app: FastifyInstance,
  runtime: Runtime,
  options: {
    readonly heartbeatIntervalMs: number;
    readonly maxBufferedBytes: number;
  },
  catalogRevisions?: CatalogRevisionStore
): void {
  const clients = new Set<Client>();
  const broadcastSnapshot = (snapshot: AppSnapshot): void => {
    const payload = serialize({ type: "SNAPSHOT", revision: snapshot.revision, data: snapshot });
    for (const client of clients) {
      if (snapshot.revision <= client.lastRevision) continue;
      if (sendBoundedMessage(client.socket, payload, options.maxBufferedBytes)) {
        client.lastRevision = snapshot.revision;
      } else {
        clients.delete(client);
      }
    }
  };
  const unsubscribe = runtime.subscribe(broadcastSnapshot);
  const broadcastCatalogRevision = (entry: StoredCatalogRevision): void => {
    const payload = serialize({ type: "CATALOG_REVISION", sequence: entry.sequence,
      accountId: entry.accountId, revision: entry.revision, observedAtMs: entry.observedAtMs,
      snapshotState: entry.snapshotState });
    for (const client of clients) {
      if (entry.sequence <= client.lastCatalogSequence) continue;
      if (sendBoundedMessage(client.socket, payload, options.maxBufferedBytes)) {
        client.lastCatalogSequence = entry.sequence;
      } else clients.delete(client);
    }
  };
  const unsubscribeCatalogs = catalogRevisions?.subscribe(broadcastCatalogRevision) ?? (() => undefined);
  const heartbeat = setInterval(() => {
    const snapshot = runtime.getSnapshot();
    const payload = serialize({
      type: "HEARTBEAT",
      revision: snapshot.revision,
      serverTimeMs: Date.now()
    });
    for (const client of clients) {
      if (!sendBoundedMessage(client.socket, payload, options.maxBufferedBytes)) {
        clients.delete(client);
      }
    }
  }, options.heartbeatIntervalMs);
  heartbeat.unref();

  app.get("/api/realtime", { websocket: true }, (socket) => {
    const client: Client = { socket, lastRevision: -1, lastCatalogSequence: -1 };
    clients.add(client);
    socket.once("close", () => clients.delete(client));
    socket.once("error", () => clients.delete(client));
    broadcastSnapshot(runtime.getSnapshot());
    if (catalogRevisions !== undefined) {
      const baseline = catalogRevisions.baseline();
      const payload = serialize({ type: "CATALOG_REVISION_BASELINE",
        sequence: baseline.sequence, entries: baseline.entries });
      if (sendBoundedMessage(socket, payload, options.maxBufferedBytes)) {
        client.lastCatalogSequence = baseline.sequence;
      } else clients.delete(client);
    }
  });

  app.addHook("onClose", async () => {
    clearInterval(heartbeat);
    unsubscribe();
    unsubscribeCatalogs();
    for (const client of clients) client.socket.terminate();
    clients.clear();
  });
}
