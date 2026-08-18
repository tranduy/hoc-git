import type { ChromeBridgeControlMessage } from "@tool-chenh/contracts";

export interface BridgeControlSocket {
  readonly readyState: number;
  send(data: string): void;
}

export class ChromeBridgeControlPlane {
  readonly #socketsBySource = new Map<string, BridgeControlSocket>();

  attach(sourceId: string, socket: BridgeControlSocket): void {
    this.#socketsBySource.set(sourceId, socket);
  }

  detach(socket: BridgeControlSocket): void {
    for (const [sourceId, attached] of this.#socketsBySource) {
      if (attached === socket) this.#socketsBySource.delete(sourceId);
    }
  }

  sourceCount(): number { return this.#socketsBySource.size; }

  requestAllSnapshots(): number {
    return this.#broadcast("REQUEST_SNAPSHOT");
  }

  reloadAllSources(): number {
    return this.#broadcast("RELOAD_SOURCE");
  }

  reloadAllSourcesExcept(excludedLobbies: ReadonlySet<string>): number {
    let requested = 0;
    for (const [sourceId, socket] of this.#socketsBySource) {
      const lobby = sourceId.split(":")[1] ?? "";
      if (socket.readyState !== 1 || excludedLobbies.has(lobby)) continue;
      const control: ChromeBridgeControlMessage = { version: 1, kind: "RELOAD_SOURCE", sourceId };
      socket.send(JSON.stringify(control));
      requested += 1;
    }
    return requested;
  }

  navigateLobby(lobby: string, url: string): number {
    let requested = 0;
    for (const [sourceId, socket] of this.#socketsBySource) {
      if (socket.readyState !== 1 || !sourceId.startsWith(`chrome:${lobby}:`)) continue;
      const control: ChromeBridgeControlMessage = { version: 1, kind: "NAVIGATE_SOURCE", sourceId, url };
      socket.send(JSON.stringify(control));
      requested += 1;
    }
    return requested;
  }

  #broadcast(kind: "REQUEST_SNAPSHOT" | "RELOAD_SOURCE"): number {
    let requested = 0;
    for (const [sourceId, socket] of this.#socketsBySource) {
      if (socket.readyState !== 1) continue;
      const control: ChromeBridgeControlMessage = { version: 1, kind, sourceId };
      socket.send(JSON.stringify(control));
      requested += 1;
    }
    return requested;
  }
}
