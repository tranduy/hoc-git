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
  let requestError: unknown = null;
  try {
    requestedSnapshots = await options.requestBridgeSnapshots(freshAfterMs);
  } catch (error) {
    // Continue through the freshness gate so one missing launch cannot hide
    // another provider whose replacement tab never produced a valid catalog.
    requestError = error;
  }
  if (requestedSnapshots === 0) {
    if (preparationError !== null) throw preparationError;
    throw new Error("CHROME_BRIDGE_NO_ATTACHED_SOURCE");
  }

  // Fabet launch capture can finish before an IM one-time page exposes both
  // signed catalog partitions. Its bounded in-page bootstrap retry completes
  // within ~20 seconds, so the reset gate must not declare the source dead at
  // the previous 15-second boundary.
  const timeoutMs = options.timeoutMs ?? 30_000;
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
    if (unavailable.length === 0) {
      // A provider card can be temporarily absent from Fabet even while its
      // already attached reader returns a snapshot acquired in this reset
      // cycle. Catalog freshness is the functional reset result; do not turn
      // a healthy live feed into a false global failure merely because there
      // was no replacement launch URL for that one provider.
      return;
    }
    if (now() >= deadline) break;
    await new Promise<void>((resolve) => setTimeout(resolve, Math.min(pollMs, Math.max(0, deadline - now()))));
  } while (true);
  const messages = [preparationError, requestError]
    .filter((error) => error !== null)
    .map((error) => error instanceof Error ? error.message : "SOURCE_REFRESH_FAILED");
  messages.push(`CHROME_BRIDGE_REFRESH_INCOMPLETE:${unavailable.join(",") || "NO_CATALOG"}`);
  throw new Error(messages.join(";"));
}
