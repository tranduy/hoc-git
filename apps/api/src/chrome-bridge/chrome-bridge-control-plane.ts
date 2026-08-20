import type { ChromeBridgeControlMessage, ChromeLobbyId } from "@tool-chenh/contracts";

export interface BridgeControlSocket {
  readonly readyState: number;
  send(data: string): void;
}

export class ChromeBridgeControlPlane {
  readonly #socketsBySource = new Map<string, BridgeControlSocket>();
  readonly #installationSockets = new Set<BridgeControlSocket>();

  attachInstallation(socket: BridgeControlSocket): void {
    this.#installationSockets.add(socket);
  }

  attach(sourceId: string, socket: BridgeControlSocket): void {
    this.#socketsBySource.set(sourceId, socket);
  }

  detach(socket: BridgeControlSocket): void {
    this.#installationSockets.delete(socket);
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

  ensureLobby(lobby: ChromeLobbyId, url: string): number {
    for (const socket of this.#installationSockets) {
      if (socket.readyState !== 1) continue;
      const control: ChromeBridgeControlMessage = { version: 1, kind: "ENSURE_SOURCE", lobby, url };
      socket.send(JSON.stringify(control));
      return 1;
    }
    return 0;
  }

  restoreLobby(lobby: ChromeLobbyId): number {
    for (const socket of this.#installationSockets) {
      if (socket.readyState !== 1) continue;
      const control: ChromeBridgeControlMessage = { version: 1, kind: "RESTORE_SOURCE", lobby };
      socket.send(JSON.stringify(control));
      return 1;
    }
    return 0;
  }

  probeCmdHiddenMarkets(sourceId: string, requestId: string, providerEventId: string): boolean {
    if (!sourceId.startsWith("chrome:CMD:")) return false;
    const socket = this.#socketsBySource.get(sourceId);
    if (!socket || socket.readyState !== 1) return false;
    const control: ChromeBridgeControlMessage = { version: 1, kind: "PROBE_CMD_HIDDEN_MARKETS",
      sourceId, requestId, providerEventId };
    socket.send(JSON.stringify(control));
    return true;
  }

  probeSelectionPrice(sourceId: string, input: Omit<Extract<ChromeBridgeControlMessage,
    { readonly kind: "PROBE_SELECTION_PRICE" }>, "version" | "kind" | "sourceId">): boolean {
    const socket = this.#socketsBySource.get(sourceId);
    if (!socket || socket.readyState !== 1) return false;
    const control: ChromeBridgeControlMessage = { version: 1, kind: "PROBE_SELECTION_PRICE", sourceId,
      ...input };
    socket.send(JSON.stringify(control));
    if (sourceId.startsWith("chrome:CMD:")) {
      // Installed bundles predating participant identity used a strict schema and
      // silently rejected the expanded command. The two strict shapes are
      // mutually exclusive, so exactly one probe runs during the rollout.
      const { participantA: _participantA, participantB: _participantB, ...legacyInput } = input;
      socket.send(JSON.stringify({ version: 1, kind: "PROBE_SELECTION_PRICE", sourceId, ...legacyInput }));
    }
    return true;
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
