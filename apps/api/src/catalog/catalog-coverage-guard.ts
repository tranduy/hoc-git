interface CoverageState {
  acceptedCount: number;
  authoritativeGeneration: string | null;
}

export interface CatalogCoverageCandidate {
  readonly generation: string;
  readonly authoritativeBaseline: boolean;
  readonly providerEventIds: readonly string[];
}

export class CatalogCoverageGuard {
  readonly #states = new Map<string, CoverageState>();

  accept(sourceKey: string, candidate: CatalogCoverageCandidate): boolean {
    const current = this.#states.get(sourceKey);
    if (current === undefined) {
      this.#states.set(sourceKey, { acceptedCount: candidate.providerEventIds.length,
        authoritativeGeneration: candidate.authoritativeBaseline ? candidate.generation : null });
      return true;
    }
    if (candidate.authoritativeBaseline && current.authoritativeGeneration !== candidate.generation) {
      this.#states.set(sourceKey, { acceptedCount: candidate.providerEventIds.length,
        authoritativeGeneration: candidate.generation });
      return true;
    }
    if (candidate.providerEventIds.length >= Math.ceil(current.acceptedCount * 0.7)) {
      this.#states.set(sourceKey, { acceptedCount: candidate.providerEventIds.length,
        authoritativeGeneration: current.authoritativeGeneration });
      return true;
    }
    return false;
  }

  reset(sourceKey: string): void {
    this.#states.delete(sourceKey);
  }
}
