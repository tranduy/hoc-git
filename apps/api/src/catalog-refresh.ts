interface CatalogSourceStatus {
  readonly id: string;
  readonly sessionState: string;
  readonly acquiredAtMs?: number | null;
}

interface BridgeSourceStatus {
  readonly lobby: string;
  readonly tabId: number;
  readonly state: string;
  readonly lastAcceptedAtMs: number;
}

const BRIDGE_SOURCE = /^catalog-source:(CMD|IM|SABA|SBOBET|APSPORT|BTI):FOOTBALL$/u;
const REQUIRED_BRIDGE_PROVIDERS = ["CMD", "IM", "SABA", "SBOBET", "APSPORT", "BTI"] as const;
const REQUIRED_BRIDGE_LOBBIES = ["CMD", "IM", "SABA", "KSPORT", "TSPORT", "BTI"] as const;

export async function refreshCatalogSources(options: {
  readonly legacyRefresh: () => Promise<void>;
  readonly prepareSources?: () => Promise<void>;
  readonly requestBridgeSnapshots?: (freshAfterMs: number) => number | Promise<number>;
  readonly statuses: () => Promise<readonly CatalogSourceStatus[]>;
  readonly bridgeSources?: () => readonly BridgeSourceStatus[] | Promise<readonly BridgeSourceStatus[]>;
  readonly now?: () => number;
  readonly timeoutMs?: number;
  readonly pollMs?: number;
  readonly stabilityMs?: number;
  readonly sleep?: (delayMs: number) => Promise<void>;
}): Promise<void> {
  if (options.requestBridgeSnapshots === undefined) {
    await options.legacyRefresh();
    return;
  }
  const now = options.now ?? Date.now;
  const freshAfterMs = now();
  const previousTabIds = new Map<string, Set<number>>();
  if (options.bridgeSources !== undefined) {
    for (const source of await options.bridgeSources()) {
      const ids = previousTabIds.get(source.lobby) ?? new Set<number>();
      ids.add(source.tabId);
      previousTabIds.set(source.lobby, ids);
    }
  }
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
  const stabilityMs = options.bridgeSources === undefined ? 0 : options.stabilityMs ?? 10_000;
  const sleep = options.sleep ?? ((delayMs: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, delayMs)));
  const deadline = now() + timeoutMs;
  let unavailable: string[] = [];
  let unreplaced: string[] = [];
  let unstable: string[] = [];
  let stabilityStartedAtMs: number | null = null;
  let stabilityBaseline = new Map<string, { readonly tabId: number; readonly lastAcceptedAtMs: number }>();
  do {
    const current = (await options.statuses()).filter((source) => BRIDGE_SOURCE.test(source.id));
    const byProvider = new Map(current.map((source) => [source.id.split(":")[1], source]));
    unavailable = REQUIRED_BRIDGE_PROVIDERS.filter((provider) => {
      const source = byProvider.get(provider);
      return source === undefined || source.sessionState !== "ACTIVE" ||
        source.acquiredAtMs === null || source.acquiredAtMs === undefined || source.acquiredAtMs < freshAfterMs;
    });
    let replacements = new Map<string, BridgeSourceStatus>();
    if (options.bridgeSources !== undefined) {
      const bridgeSources = await options.bridgeSources();
      for (const lobby of REQUIRED_BRIDGE_LOBBIES) {
        const replacement = bridgeSources.filter((source) => source.lobby === lobby && source.state === "LIVE" &&
          source.lastAcceptedAtMs >= freshAfterMs && !previousTabIds.get(lobby)?.has(source.tabId))
          .sort((left, right) => right.lastAcceptedAtMs - left.lastAcceptedAtMs)[0];
        if (replacement !== undefined) replacements.set(lobby, replacement);
      }
      unreplaced = REQUIRED_BRIDGE_LOBBIES.filter((lobby) => !replacements.has(lobby));
    }
    if (unavailable.length === 0 && unreplaced.length === 0) {
      // A provider card can be temporarily absent from Fabet even while its
      // already attached reader returns a snapshot acquired in this reset
      // cycle. Catalog freshness is the functional reset result; do not turn
      // a healthy live feed into a false global failure merely because there
      // was no replacement launch URL for that one provider.
      if (stabilityMs <= 0) return;
      const replacementChanged = REQUIRED_BRIDGE_LOBBIES.some((lobby) =>
        stabilityBaseline.get(lobby)?.tabId !== replacements.get(lobby)?.tabId);
      if (stabilityStartedAtMs === null || replacementChanged) {
        stabilityStartedAtMs = now();
        stabilityBaseline = new Map([...replacements].map(([lobby, source]) => [lobby, {
          tabId: source.tabId, lastAcceptedAtMs: source.lastAcceptedAtMs
        }]));
        unstable = [...REQUIRED_BRIDGE_LOBBIES];
      } else {
        unstable = REQUIRED_BRIDGE_LOBBIES.filter((lobby) => {
          const source = replacements.get(lobby);
          const baseline = stabilityBaseline.get(lobby);
          return source === undefined || baseline === undefined || source.lastAcceptedAtMs <= baseline.lastAcceptedAtMs;
        });
        if (now() - stabilityStartedAtMs >= stabilityMs && unstable.length === 0) return;
      }
    } else {
      stabilityStartedAtMs = null;
      stabilityBaseline.clear();
      unstable = [];
    }
    if (now() >= deadline) break;
    await sleep(Math.min(pollMs, Math.max(0, deadline - now())));
  } while (true);
  const messages = [preparationError, requestError]
    .filter((error) => error !== null)
    .map((error) => error instanceof Error ? error.message : "SOURCE_REFRESH_FAILED");
  if (unavailable.length > 0) messages.push(`CHROME_BRIDGE_REFRESH_INCOMPLETE:${unavailable.join(",")}`);
  if (unreplaced.length > 0) {
    messages.push(`CHROME_BRIDGE_TAB_REPLACEMENT_INCOMPLETE:${unreplaced.join(",")}`);
  }
  if (unstable.length > 0) messages.push(`CHROME_BRIDGE_STABILITY_INCOMPLETE:${unstable.join(",")}`);
  if (messages.length === 0) messages.push("CHROME_BRIDGE_REFRESH_INCOMPLETE:NO_CATALOG");
  throw new Error(messages.join(";"));
}
