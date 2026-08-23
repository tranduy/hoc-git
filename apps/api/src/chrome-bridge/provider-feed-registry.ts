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
  readonly #pendingWaitFinalizers = new Set<(error: Error) => void>();
  #disposed = false;

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
    const controller = this.#controller(accountId);
    const before = controller.snapshot();
    try {
      return controller.read();
    } finally {
      const after = controller.snapshot();
      if (before.state !== after.state || before.reason !== after.reason) this.#notify(after);
    }
  }

  snapshot(accountId: string): ProviderFeedSnapshot {
    return this.#controller(accountId).snapshot();
  }

  list(): readonly ProviderFeedSnapshot[] {
    return [...this.#controllers.values()].map((controller) => controller.snapshot());
  }

  sweep(eligibleAccountIds?: ReadonlySet<string>): readonly ProviderRecoveryRequest[] {
    const requests: ProviderRecoveryRequest[] = [];
    for (const controller of this.#controllers.values()) {
      const before = controller.snapshot();
      if (eligibleAccountIds !== undefined && !eligibleAccountIds.has(before.accountId)) continue;
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

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    const error = new Error("PROVIDER_FEED_REGISTRY_DISPOSED");
    for (const finalize of [...this.#pendingWaitFinalizers]) finalize(error);
    this.#listeners.clear();
  }

  waitForFreshBaseline(accountId: string, afterMs: number, timeoutMs: number): Promise<ProviderFeedSnapshot> {
    if (!Number.isFinite(afterMs) || !Number.isFinite(timeoutMs) || timeoutMs < 0) {
      return Promise.reject(new Error("PROVIDER_FEED_WAIT_INVALID"));
    }
    if (this.#disposed) return Promise.reject(new Error("PROVIDER_FEED_REGISTRY_DISPOSED"));
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
      let unsubscribe: () => void = () => {};
      const cleanup = (): void => {
        if (timer !== undefined) clearTimeout(timer);
        unsubscribe();
        this.#pendingWaitFinalizers.delete(cancel);
      };
      const finish = (snapshot: ProviderFeedSnapshot): void => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(snapshot);
      };
      const cancel = (error: Error): void => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };
      this.#pendingWaitFinalizers.add(cancel);
      unsubscribe = this.subscribe((snapshot) => {
        if (snapshot.accountId === accountId && isFreshBaseline(snapshot, afterMs)) finish(snapshot);
      });
      if (settled) {
        unsubscribe();
        return;
      }
      try { controller.read(); } catch { /* refresh state before the post-subscribe race check */ }
      const subscribedSnapshot = controller.snapshot();
      if (isFreshBaseline(subscribedSnapshot, afterMs)) {
        finish(subscribedSnapshot);
        return;
      }
      timer = setTimeout(() => {
        cancel(new Error("PROVIDER_FEED_BASELINE_TIMEOUT"));
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
