import type { ChromeBridgeEnvelope, ChromeLobbyId } from "@tool-chenh/contracts";

export interface DecodedCatalogUpdate {
  readonly sourceId: string;
  readonly sequence: number;
  readonly observedAtMs: number;
  readonly value: unknown;
}

export interface ChromeTrafficAdapter {
  readonly id: string;
  readonly lobby: ChromeLobbyId;
  readonly providerFamily: string;
  fingerprint(envelope: ChromeBridgeEnvelope): boolean;
  decode(envelope: ChromeBridgeEnvelope): readonly DecodedCatalogUpdate[];
  resetSource?(sourceId: string): void;
}
