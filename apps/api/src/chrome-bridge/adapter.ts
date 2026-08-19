import type { ChromeBridgeEnvelope, ChromeLobbyId } from "@tool-chenh/contracts";

export type DecodedCatalogUpdate = {
  readonly sourceId: string;
  readonly sequence: number;
  readonly observedAtMs: number;
  readonly value: unknown;
  readonly invalidateAccountId?: never;
  readonly reason?: never;
} | {
  readonly sourceId: string;
  readonly sequence: number;
  readonly observedAtMs: number;
  readonly invalidateAccountId: string;
  readonly reason: "PROVIDER_STREAM_CLOSED" | "PROVIDER_STREAM_GAP";
  readonly value?: never;
};

export interface ChromeTrafficAdapter {
  readonly id: string;
  readonly lobby: ChromeLobbyId;
  readonly providerFamily: string;
  fingerprint(envelope: ChromeBridgeEnvelope): boolean;
  decode(envelope: ChromeBridgeEnvelope): readonly DecodedCatalogUpdate[];
  resetSource?(sourceId: string): void;
}
