import type { ChromeBridgeControlMessage, ChromeLobbyId } from "@tool-chenh/contracts";
import { chromeBridgeSourceIdentity, type ChromeBridgeAccountKey } from "./chrome-bridge-account.js";

export interface BridgeControlSocket {
  readonly readyState: number;
  send(data: string): void;
}

export interface ChromeBridgeControlPlaneOptions {
  readonly activeSourceIds?: () => ReadonlySet<string>;
}

interface AttachedSource {
  readonly sourceId: string;
  readonly lobby: ChromeLobbyId;
  readonly socket: BridgeControlSocket;
}

export class ChromeBridgeControlPlane {
  readonly #sourcesByAccount = new Map<ChromeBridgeAccountKey, AttachedSource>();
  #installationSocket: BridgeControlSocket | null = null;
  readonly #activeSourceIds: (() => ReadonlySet<string>) | null;

  constructor(options: ChromeBridgeControlPlaneOptions = {}) {
    this.#activeSourceIds = options.activeSourceIds ?? null;
  }

  attachInstallation(socket: BridgeControlSocket): void {
    this.#installationSocket = socket;
  }

  attach(sourceId: string, socket: BridgeControlSocket): void {
    this.#pruneInactiveSources();
    const identity = chromeBridgeSourceIdentity(sourceId);
    if (identity === null) return;
    this.#sourcesByAccount.set(identity.accountKey, { sourceId, lobby: identity.lobby, socket });
  }

  detach(socket: BridgeControlSocket): void {
    if (this.#installationSocket === socket) this.#installationSocket = null;
    for (const [accountKey, attached] of this.#sourcesByAccount) {
      // Identity guard: a late close from a superseded socket must not remove
      // the newer source now owning the same provider account.
      if (attached.socket === socket) this.#sourcesByAccount.delete(accountKey);
    }
  }

  sourceCount(): number {
    this.#pruneInactiveSources();
    return this.#sourcesByAccount.size;
  }

  requestAllSnapshots(): number {
    return this.#broadcast("REQUEST_SNAPSHOT");
  }

  requestLobbySnapshot(lobby: ChromeLobbyId): number {
    let requested = 0;
    for (const { sourceId, lobby: attachedLobby, socket } of this.#attachedSources()) {
      if (socket.readyState !== 1 || attachedLobby !== lobby) continue;
      const control: ChromeBridgeControlMessage = { version: 1, kind: "REQUEST_SNAPSHOT", sourceId };
      socket.send(JSON.stringify(control));
      requested += 1;
    }
    return requested;
  }

  reloadAllSources(): number {
    return this.#broadcast("RELOAD_SOURCE");
  }

  reloadAllSourcesExcept(excludedLobbies: ReadonlySet<string>): number {
    let requested = 0;
    for (const { sourceId, lobby, socket } of this.#attachedSources()) {
      if (socket.readyState !== 1 || excludedLobbies.has(lobby)) continue;
      const control: ChromeBridgeControlMessage = { version: 1, kind: "RELOAD_SOURCE", sourceId };
      socket.send(JSON.stringify(control));
      requested += 1;
    }
    return requested;
  }

  navigateLobby(lobby: string, url: string): number {
    let requested = 0;
    for (const { sourceId, lobby: attachedLobby, socket } of this.#attachedSources()) {
      if (socket.readyState !== 1 || attachedLobby !== lobby) continue;
      const control: ChromeBridgeControlMessage = { version: 1, kind: "NAVIGATE_SOURCE", sourceId, url };
      socket.send(JSON.stringify(control));
      requested += 1;
    }
    return requested;
  }

  ensureLobby(lobby: ChromeLobbyId, url: string): number {
    const socket = this.#installationSocket;
    if (socket === null || socket.readyState !== 1) return 0;
    const control: ChromeBridgeControlMessage = { version: 1, kind: "ENSURE_SOURCE", lobby, url };
    socket.send(JSON.stringify(control));
    return 1;
  }

  restoreLobby(lobby: ChromeLobbyId): number {
    const socket = this.#installationSocket;
    if (socket === null || socket.readyState !== 1) return 0;
    const control: ChromeBridgeControlMessage = { version: 1, kind: "RESTORE_SOURCE", lobby };
    socket.send(JSON.stringify(control));
    return 1;
  }

  probeCmdHiddenMarkets(sourceId: string, requestId: string, providerEventId: string): boolean {
    if (!sourceId.startsWith("chrome:CMD:")) return false;
    const socket = this.#exactSocket(sourceId);
    if (!socket || socket.readyState !== 1) return false;
    const control: ChromeBridgeControlMessage = { version: 1, kind: "PROBE_CMD_HIDDEN_MARKETS",
      sourceId, requestId, providerEventId };
    socket.send(JSON.stringify(control));
    return true;
  }

  probeSelectionPrice(sourceId: string, input: Omit<Extract<ChromeBridgeControlMessage,
    { readonly kind: "PROBE_SELECTION_PRICE" }>, "version" | "kind" | "sourceId">): boolean {
    const socket = this.#exactSocket(sourceId);
    if (!socket || socket.readyState !== 1) return false;
    const control: ChromeBridgeControlMessage = { version: 1, kind: "PROBE_SELECTION_PRICE", sourceId,
      ...input };
    socket.send(JSON.stringify(control));
    if (sourceId.startsWith("chrome:CMD:") || sourceId.startsWith("chrome:SABA:")) {
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
    for (const { sourceId, socket } of this.#attachedSources()) {
      if (socket.readyState !== 1) continue;
      const control: ChromeBridgeControlMessage = { version: 1, kind, sourceId };
      socket.send(JSON.stringify(control));
      requested += 1;
    }
    return requested;
  }

  #attachedSources(): readonly AttachedSource[] {
    this.#pruneInactiveSources();
    return [...this.#sourcesByAccount.values()];
  }

  #exactSocket(sourceId: string): BridgeControlSocket | undefined {
    this.#pruneInactiveSources();
    const identity = chromeBridgeSourceIdentity(sourceId);
    if (identity === null) return undefined;
    const attached = this.#sourcesByAccount.get(identity.accountKey);
    return attached?.sourceId === sourceId ? attached.socket : undefined;
  }

  #pruneInactiveSources(): void {
    if (this.#activeSourceIds === null) return;
    const active = this.#activeSourceIds();
    for (const [accountKey, attached] of this.#sourcesByAccount) {
      if (!active.has(attached.sourceId)) this.#sourcesByAccount.delete(accountKey);
    }
  }
}
