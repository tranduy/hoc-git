interface CoverageState {
  acceptedCount: number;
}

export class CatalogCoverageGuard {
  readonly #states = new Map<string, CoverageState>();

  accept(sourceKey: string, eventIds: readonly string[]): boolean {
    const current = this.#states.get(sourceKey);
    if (current === undefined) {
      this.#states.set(sourceKey, { acceptedCount: eventIds.length });
      return true;
    }
    if (eventIds.length >= Math.ceil(current.acceptedCount * 0.7)) {
      this.#states.set(sourceKey, { acceptedCount: eventIds.length });
      return true;
    }
    // A repeated partial viewport is still partial. Only an explicit Reset or
    // the scheduled 03:00 maintenance may authorize a catastrophically smaller
    // baseline; transport repetition must never overwrite a complete catalog.
    return false;
  }

  reset(sourceKey: string): void {
    this.#states.delete(sourceKey);
  }
}
