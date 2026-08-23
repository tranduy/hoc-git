interface CoverageState {
  acceptedEventIds: ReadonlySet<string>;
  consumedAuthoritativeGenerations: ReadonlySet<string>;
}

export interface CatalogCoverageCandidate {
  readonly generation: string;
  readonly authoritativeBaseline: boolean;
  readonly providerEventIds: readonly string[];
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
    if (candidate.authoritativeBaseline && !current.consumedAuthoritativeGenerations.has(candidate.generation)) {
      return true;
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
}

function stateAfter(current: CoverageState | null, candidate: CatalogCoverageCandidate): CoverageState {
  const consumed = new Set(current?.consumedAuthoritativeGenerations ?? []);
  if (candidate.authoritativeBaseline) consumed.add(candidate.generation);
  return { acceptedEventIds: new Set(candidate.providerEventIds), consumedAuthoritativeGenerations: consumed };
}
