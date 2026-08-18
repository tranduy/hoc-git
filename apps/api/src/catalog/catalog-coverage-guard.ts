interface CoverageState {
  acceptedCount: number;
  pendingSignature: string | null;
  pendingCount: number;
}

export class CatalogCoverageGuard {
  readonly #states = new Map<string, CoverageState>();

  accept(sourceKey: string, eventIds: readonly string[]): boolean {
    const signature = [...eventIds].sort().join("\u0000");
    const current = this.#states.get(sourceKey);
    if (current === undefined) {
      this.#states.set(sourceKey, { acceptedCount: eventIds.length, pendingSignature: null, pendingCount: 0 });
      return true;
    }
    if (eventIds.length >= Math.ceil(current.acceptedCount * 0.7)) {
      this.#states.set(sourceKey, { acceptedCount: eventIds.length, pendingSignature: null, pendingCount: 0 });
      return true;
    }
    const pendingCount = current.pendingSignature === signature ? current.pendingCount + 1 : 1;
    if (pendingCount >= 3) {
      this.#states.set(sourceKey, { acceptedCount: eventIds.length, pendingSignature: null, pendingCount: 0 });
      return true;
    }
    this.#states.set(sourceKey, { ...current, pendingSignature: signature, pendingCount });
    return false;
  }
}
