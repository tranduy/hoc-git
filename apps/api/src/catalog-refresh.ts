interface CatalogSourceStatus {
  readonly id: string;
  readonly sessionState: string;
  readonly acquiredAtMs?: number | null;
}

const BRIDGE_SOURCE = /^catalog-source:(CMD|IM|SABA|SBOBET|APSPORT|BTI):FOOTBALL$/u;
const REQUIRED_BRIDGE_PROVIDERS = ["CMD", "IM", "SABA", "SBOBET", "APSPORT", "BTI"] as const;

export async function refreshCatalogSources(options: {
  readonly legacyRefresh: () => Promise<void>;
  readonly prepareSources?: () => Promise<void>;
  readonly requestBridgeSnapshots?: (freshAfterMs: number) => number | Promise<number>;
  readonly statuses: () => Promise<readonly CatalogSourceStatus[]>;
  readonly now?: () => number;
  readonly timeoutMs?: number;
  readonly pollMs?: number;
}): Promise<void> {
  if (options.requestBridgeSnapshots === undefined) {
    await options.legacyRefresh();
    return;
  }
  const now = options.now ?? Date.now;
  const freshAfterMs = now();
  // Credential rotation is preferred, but the monitor is read-only and an
  // already attached provider tab can still be healthy while the Fabet root
  // domain is blocked. Always ask those tabs for a new snapshot; only surface
  // the preparation error when the attached readers cannot actually recover.
  let preparationError: unknown = null;
  try {
    await options.prepareSources?.();
  } catch (error) {
    preparationError = error;
  }
  let requestedSnapshots: number | null = null;
  try {
    requestedSnapshots = await options.requestBridgeSnapshots(freshAfterMs);
  } catch (error) {
    // A reset command that could not acquire or deliver every launch is a
    // failed reset even if an attached tab happens to publish concurrently.
    throw error;
  }
  if (requestedSnapshots === 0) {
    if (preparationError !== null) throw preparationError;
    throw new Error("CHROME_BRIDGE_NO_ATTACHED_SOURCE");
  }

  const timeoutMs = options.timeoutMs ?? 15_000;
  const pollMs = options.pollMs ?? 250;
  const deadline = now() + timeoutMs;
  let unavailable: string[] = [];
  do {
    const current = (await options.statuses()).filter((source) => BRIDGE_SOURCE.test(source.id));
    const byProvider = new Map(current.map((source) => [source.id.split(":")[1], source]));
    unavailable = REQUIRED_BRIDGE_PROVIDERS.filter((provider) => {
      const source = byProvider.get(provider);
      return source === undefined || source.sessionState !== "ACTIVE" ||
        source.acquiredAtMs === null || source.acquiredAtMs === undefined || source.acquiredAtMs < freshAfterMs;
    });
    if (unavailable.length === 0) return;
    if (now() >= deadline) break;
    await new Promise<void>((resolve) => setTimeout(resolve, Math.min(pollMs, Math.max(0, deadline - now()))));
  } while (true);
  if (preparationError !== null) throw preparationError;
  throw new Error(`CHROME_BRIDGE_REFRESH_INCOMPLETE:${unavailable.join(",") || "NO_CATALOG"}`);
}
