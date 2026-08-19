import type { ChromeLobbyId } from "@tool-chenh/contracts";
import { refreshBridgeProviderSources } from "./provider-source-refresh.js";

type FabetProvider = "SABA" | "IM" | "SBOBET" | "APSPORT" | "BTI";

interface RecoveryControlPlane {
  ensureLobby(lobby: ChromeLobbyId, url: string): number;
  restoreLobby(lobby: ChromeLobbyId): number;
}

interface AutomaticSourceRecoveryOptions {
  readonly controlPlane: RecoveryControlPlane;
  readonly refreshFabetLaunches: () => Promise<void>;
  readonly withLatestFabetLaunch: <T>(provider: FabetProvider, category: "FOOTBALL",
    consume: (url: string) => Promise<T>, minAcquiredAtMs: number) => Promise<T>;
  readonly now?: () => number;
  readonly onError?: (accountId: string, error: unknown) => void;
}

const fabetAccount = /^catalog-source:(SABA|IM|SBOBET|APSPORT|BTI):FOOTBALL$/u;

export class AutomaticSourceRecovery {
  readonly #options: AutomaticSourceRecoveryOptions;
  readonly #inflight = new Map<string, Promise<void>>();

  constructor(options: AutomaticSourceRecoveryOptions) {
    this.#options = options;
  }

  recover(accountId: string): Promise<void> {
    const existing = this.#inflight.get(accountId);
    if (existing !== undefined) return existing;
    const providerMatch = fabetAccount.exec(accountId);
    if (accountId !== "catalog-source:CMD:FOOTBALL" && providerMatch === null) {
      return Promise.resolve();
    }

    const operation = this.#recoverKnownSource(accountId, providerMatch?.[1] as FabetProvider | undefined)
      .catch((error) => { this.#options.onError?.(accountId, error); })
      .finally(() => {
        if (this.#inflight.get(accountId) === operation) this.#inflight.delete(accountId);
      });
    this.#inflight.set(accountId, operation);
    return operation;
  }

  async #recoverKnownSource(accountId: string, provider: FabetProvider | undefined): Promise<void> {
    if (accountId === "catalog-source:CMD:FOOTBALL") {
      if (this.#options.controlPlane.restoreLobby("CMD") === 0) {
        throw new Error("CHROME_BRIDGE_RESTORE_UNDELIVERED:CMD");
      }
      return;
    }
    if (provider === undefined) return;

    const recoveryStartedAtMs = (this.#options.now ?? Date.now)();
    // Capture fresh one-time launches without restartAll(): the five healthy
    // readers and their Chrome tabs must remain untouched while one provider
    // is being recovered.
    await this.#options.refreshFabetLaunches();
    await refreshBridgeProviderSources({
      controlPlane: this.#options.controlPlane,
      withLatestFabetLaunch: this.#options.withLatestFabetLaunch,
      minAcquiredAtMs: recoveryStartedAtMs,
      providers: [provider],
      restoreCmd: false
    });
  }
}
