import type { ObservedProviderCatalog } from "../providers/cmd/cmd-observed-catalog.js";
import { ProviderFeedController } from "./provider-feed-controller.js";
import { providerFeedPolicies } from "./provider-feed-policies.js";
import type { FeedDecision, ProviderFeedEvidence, ProviderFeedSnapshot,
  ProviderRecoveryRequest } from "./provider-feed-types.js";

export interface ProviderFeedRegistryOptions {
  readonly now?: () => number;
}

export class ProviderFeedRegistry {
  readonly #controllers = new Map<string, ProviderFeedController>();
  readonly #listeners = new Set<(snapshot: ProviderFeedSnapshot) => void>();

  constructor(options: ProviderFeedRegistryOptions = {}) {
    for (const [accountId, policy] of [...providerFeedPolicies].sort(([left], [right]) => left.localeCompare(right))) {
      this.#controllers.set(accountId, new ProviderFeedController({ accountId, policy,
        ...(options.now === undefined ? {} : { now: options.now }) }));
    }
  }

  accept(evidence: ProviderFeedEvidence): FeedDecision {
    const controller = this.#controllers.get(evidence.accountId);
    if (controller === undefined) return rejected();
    let decision = controller.accept(evidence);
    if (decision.publish?.snapshotState === "FRESH") {
      try { controller.read(); }
      catch {
        decision = { ...decision, publish: { ...decision.publish, snapshotState: "STALE" }, stateChanged: true };
      }
    }
    if (decision.accepted || decision.stateChanged) this.#notify(controller.snapshot());
    return decision;
  }

  restore(catalog: ObservedProviderCatalog): FeedDecision {
    const controller = this.#controllers.get(catalog.accountId);
    if (controller === undefined) return rejected();
    const decision = controller.restore(catalog);
    if (decision.accepted || decision.stateChanged) this.#notify(controller.snapshot());
    return decision;
  }

  read(accountId: string): ObservedProviderCatalog {
    return this.#controller(accountId).read();
  }

  snapshot(accountId: string): ProviderFeedSnapshot {
    return this.#controller(accountId).snapshot();
  }

  list(): readonly ProviderFeedSnapshot[] {
    return [...this.#controllers.values()].map((controller) => controller.snapshot());
  }

  sweep(): readonly ProviderRecoveryRequest[] {
    const requests: ProviderRecoveryRequest[] = [];
    for (const controller of this.#controllers.values()) {
      const before = controller.snapshot();
      const request = controller.sweep();
      const after = controller.snapshot();
      if (request !== null) requests.push(request);
      if (request !== null || before.state !== after.state || before.reason !== after.reason) this.#notify(after);
    }
    return requests;
  }

  subscribe(listener: (snapshot: ProviderFeedSnapshot) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  waitForFreshBaseline(accountId: string, afterMs: number, timeoutMs: number): Promise<ProviderFeedSnapshot> {
    if (!Number.isFinite(afterMs) || !Number.isFinite(timeoutMs) || timeoutMs < 0) {
      return Promise.reject(new Error("PROVIDER_FEED_WAIT_INVALID"));
    }
    let controller: ProviderFeedController;
    try {
      controller = this.#controller(accountId);
    } catch (error) {
      return Promise.reject(error);
    }
    try { controller.read(); } catch { /* read refreshes a formerly LIVE snapshot before the wait check */ }
    const current = controller.snapshot();
    if (isFreshBaseline(current, afterMs)) return Promise.resolve(current);

    return new Promise((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const cleanup = (): void => {
        if (timer !== undefined) clearTimeout(timer);
        unsubscribe();
      };
      const finish = (snapshot: ProviderFeedSnapshot): void => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(snapshot);
      };
      const unsubscribe = this.subscribe((snapshot) => {
        if (snapshot.accountId === accountId && isFreshBaseline(snapshot, afterMs)) finish(snapshot);
      });
      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error("PROVIDER_FEED_BASELINE_TIMEOUT"));
      }, timeoutMs);
    });
  }

  #controller(accountId: string): ProviderFeedController {
    const controller = this.#controllers.get(accountId);
    if (controller === undefined) throw new Error("PROVIDER_FEED_UNKNOWN");
    return controller;
  }

  #notify(snapshot: ProviderFeedSnapshot): void {
    for (const listener of [...this.#listeners]) {
      try { listener(snapshot); } catch { /* feed observers must not interrupt ingestion */ }
    }
  }
}

function isFreshBaseline(snapshot: ProviderFeedSnapshot, afterMs: number): boolean {
  return snapshot.state === "LIVE" && snapshot.lastCompleteBaselineAtMs !== null &&
    snapshot.lastCompleteBaselineAtMs > afterMs;
}

function rejected(): FeedDecision {
  return { accepted: false, publish: null, stateChanged: false };
}
