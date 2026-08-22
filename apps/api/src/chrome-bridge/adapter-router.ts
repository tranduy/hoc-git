import type { ChromeBridgeEnvelope } from "@tool-chenh/contracts";
import type { ChromeTrafficAdapter } from "./adapter.js";
export type { ChromeTrafficAdapter } from "./adapter.js";

export type AdapterRouteResult = {
  readonly status: "CANDIDATE" | "TRUSTED" | "QUARANTINED";
  readonly sourceId: string;
  readonly providerFamily: string | null;
  readonly adapter: ChromeTrafficAdapter | null;
  readonly reason: string | null;
};

export interface RoutedSourceIdentity {
  readonly sourceId: string;
  readonly providerFamily: string;
}

export function canCompareSources(left: RoutedSourceIdentity, right: RoutedSourceIdentity): boolean {
  return left.sourceId !== right.sourceId && left.providerFamily !== right.providerFamily;
}

interface SourceFingerprintState {
  adapterId: string | null;
  confirmations: number;
  quarantined: boolean;
}

export class AdapterRouter {
  readonly #adapters: readonly ChromeTrafficAdapter[];
  readonly #confirmationsRequired: number;
  readonly #states = new Map<string, SourceFingerprintState>();

  constructor(adapters: readonly ChromeTrafficAdapter[], options: { readonly confirmationsRequired?: number } = {}) {
    this.#adapters = adapters;
    this.#confirmationsRequired = options.confirmationsRequired ?? 2;
  }

  route(envelope: ChromeBridgeEnvelope): AdapterRouteResult {
    const state = this.#states.get(envelope.sourceId) ?? {
      adapterId: null, confirmations: 0, quarantined: false
    };
    this.#states.set(envelope.sourceId, state);
    if (state.quarantined) return result("QUARANTINED", envelope.sourceId, null, null, "FINGERPRINT_CONFLICT");

    const matches = this.#adapters.filter((adapter) =>
      adapter.lobby === envelope.lobby && adapter.fingerprint(envelope));
    if (matches.length > 1) {
      state.quarantined = true;
      return result("QUARANTINED", envelope.sourceId, null, null, "FINGERPRINT_CONFLICT");
    }
    const matched = matches[0];
    if (!matched) return result("CANDIDATE", envelope.sourceId, null, null, null);
    if (state.adapterId !== null && state.adapterId !== matched.id) {
      state.quarantined = true;
      return result("QUARANTINED", envelope.sourceId, null, null, "FINGERPRINT_CHANGED");
    }
    state.adapterId = matched.id;
    state.confirmations++;
    if (state.confirmations < this.#confirmationsRequired) {
      return result("CANDIDATE", envelope.sourceId, matched.providerFamily, null, null);
    }
    return result("TRUSTED", envelope.sourceId, matched.providerFamily, matched, null);
  }

  resetSource(sourceId: string): void {
    this.#states.delete(sourceId);
    for (const adapter of this.#adapters) adapter.resetSource?.(sourceId);
  }
}

function result(
  status: AdapterRouteResult["status"],
  sourceId: string,
  providerFamily: string | null,
  adapter: ChromeTrafficAdapter | null,
  reason: string | null
): AdapterRouteResult {
  return { status, sourceId, providerFamily, adapter, reason };
}
