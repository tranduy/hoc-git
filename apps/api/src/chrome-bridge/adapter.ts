import type { ChromeBridgeEnvelope, ChromeLobbyId } from "@tool-chenh/contracts";
import type { FeedProvenance } from "./provider-feed-types.js";

export type DecodedCatalogUpdate = {
  readonly sourceId: string;
  readonly sequence: number;
  readonly observedAtMs: number;
  readonly value: unknown;
  readonly authoritativeBaseline?: boolean;
  readonly evidenceMode?: "BASELINE" | "DELTA";
  readonly generation?: string;
  readonly provenance?: FeedProvenance;
  readonly providerTimestampMs?: number | null;
  readonly invalidateAccountId?: never;
  readonly reason?: never;
  readonly transportAlive?: never;
} | {
  readonly sourceId: string;
  readonly sequence: number;
  readonly observedAtMs: number;
  readonly invalidateAccountId: string;
  readonly reason: "PROVIDER_STREAM_CLOSED" | "PROVIDER_STREAM_GAP";
  readonly value?: never;
  readonly evidenceMode?: never;
  readonly generation?: never;
  readonly provenance?: never;
  readonly providerTimestampMs?: never;
  readonly transportAlive?: never;
} | {
  readonly sourceId: string;
  readonly sequence: number;
  readonly observedAtMs: number;
  readonly transportAlive: true;
  readonly value?: never;
  readonly authoritativeBaseline?: never;
  readonly evidenceMode?: never;
  readonly generation?: never;
  readonly provenance?: never;
  readonly providerTimestampMs?: never;
  readonly invalidateAccountId?: never;
  readonly reason?: never;
};

export interface ChromeTrafficAdapter {
  readonly id: string;
  readonly lobby: ChromeLobbyId;
  readonly providerFamily: string;
  fingerprint(envelope: ChromeBridgeEnvelope): boolean;
  decode(envelope: ChromeBridgeEnvelope): readonly DecodedCatalogUpdate[];
  resetSource?(sourceId: string): void;
}
