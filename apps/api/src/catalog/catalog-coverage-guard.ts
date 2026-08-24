interface CoverageState {
  acceptedEventIds: ReadonlySet<string>;
  consumedAuthoritativeGenerations: ReadonlySet<string>;
}

export interface CatalogCoverageCandidate {
  readonly generation: string;
  readonly authoritativeBaseline: boolean;
  readonly providerEventIds: readonly string[];
}

export interface CatalogCoverageCheckpoint {
  readonly owner: CatalogCoverageGuard;
  readonly states: ReadonlyMap<string, CoverageState>;
}

export class CatalogCoverageGuard {
  readonly #states = new Map<string, CoverageState>();

  accept(sourceKey: string, candidate: CatalogCoverageCandidate): boolean {
    if (!this.allows(sourceKey, candidate)) return false;
    this.commit(sourceKey, candidate);
    return true;
  }

  allows(sourceKey: string, candidate: CatalogCoverageCandidate): boolean {
    const current = this.#states.get(sourceKey);
    if (current === undefined) return true;
    if (candidate.authoritativeBaseline) {
      return !current.consumedAuthoritativeGenerations.has(candidate.generation);
    }
    const proposed = new Set(candidate.providerEventIds);
    return [...current.acceptedEventIds].every((eventId) => proposed.has(eventId));
  }

  commit(sourceKey: string, candidate: CatalogCoverageCandidate): void {
    this.#states.set(sourceKey, stateAfter(this.#states.get(sourceKey) ?? null, candidate));
  }

  reset(sourceKey: string): void {
    this.#states.delete(sourceKey);
  }

  checkpoint(): CatalogCoverageCheckpoint {
    return { owner: this, states: new Map([...this.#states].map(([key, state]) => [key, {
      acceptedEventIds: new Set(state.acceptedEventIds),
      consumedAuthoritativeGenerations: new Set(state.consumedAuthoritativeGenerations)
    }])) };
  }

  restoreCheckpoint(checkpoint: CatalogCoverageCheckpoint): void {
    if (checkpoint.owner !== this) throw new Error("CATALOG_COVERAGE_CHECKPOINT_OWNER_MISMATCH");
    this.#states.clear();
    for (const [key, state] of checkpoint.states) {
      this.#states.set(key, { acceptedEventIds: new Set(state.acceptedEventIds),
        consumedAuthoritativeGenerations: new Set(state.consumedAuthoritativeGenerations) });
    }
  }
}

function stateAfter(current: CoverageState | null, candidate: CatalogCoverageCandidate): CoverageState {
  const consumed = new Set(current?.consumedAuthoritativeGenerations ?? []);
  if (candidate.authoritativeBaseline) consumed.add(candidate.generation);
  return { acceptedEventIds: new Set(candidate.providerEventIds), consumedAuthoritativeGenerations: consumed };
}
