import type { AttachedLobbyTab } from "./tab-registry.js";

export interface TabBootstrapperDependencies {
  readonly has: (key: string) => Promise<boolean>;
  readonly mark: (key: string) => Promise<void>;
  readonly reload: (tabId: number) => Promise<void>;
}

export type TabReloadAuthorization = "EXPLICIT_RESET";

export class TabBootstrapper {
  readonly #dependencies: TabBootstrapperDependencies;
  readonly #inFlight = new Map<number, Promise<void>>();

  constructor(dependencies: TabBootstrapperDependencies) {
    this.#dependencies = dependencies;
  }

  ensure(tab: AttachedLobbyTab, authorization?: TabReloadAuthorization): Promise<void> {
    if (authorization === undefined) return Promise.resolve();
    const current = this.#inFlight.get(tab.tabId);
    if (current !== undefined) return current;
    const operation = this.#ensure(tab).finally(() => {
      if (this.#inFlight.get(tab.tabId) === operation) this.#inFlight.delete(tab.tabId);
    });
    this.#inFlight.set(tab.tabId, operation);
    return operation;
  }

  async #ensure(tab: AttachedLobbyTab): Promise<void> {
    const key = `fieldline-bootstrap:${tab.lobby}:${tab.tabId}`;
    if (await this.#dependencies.has(key)) return;
    try {
      await this.#dependencies.reload(tab.tabId);
      await this.#dependencies.mark(key);
    } catch {
      // A closed/navigating tab is retried the next time it is recognized.
    }
  }
}
