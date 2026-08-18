interface CatalogSourceStatus {
  readonly id: string;
  readonly sessionState: string;
  readonly acquiredAtMs?: number | null;
}

const BRIDGE_SOURCE = /^catalog-source:(CMD|IM|SABA|SBOBET|APSPORT|BTI):FOOTBALL$/u;

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
  // A manual refresh is an explicit credential rotation. Never hide an auth
  // or launch-capture failure and then fall back to an old one-time URL.
  await options.prepareSources?.();
  if (await options.requestBridgeSnapshots(freshAfterMs) === 0) {
    throw new Error("CHROME_BRIDGE_NO_ATTACHED_SOURCE");
  }

  const timeoutMs = options.timeoutMs ?? 15_000;
  const pollMs = options.pollMs ?? 250;
  const deadline = now() + timeoutMs;
  let unavailable: string[] = [];
  do {
    const current = (await options.statuses()).filter((source) => BRIDGE_SOURCE.test(source.id));
    unavailable = current.filter((source) => source.sessionState !== "ACTIVE" ||
      source.acquiredAtMs === null || source.acquiredAtMs === undefined || source.acquiredAtMs < freshAfterMs)
      .map((source) => source.id.split(":")[1] ?? source.id);
    if (current.length > 0 && unavailable.length === 0) return;
    if (now() >= deadline) break;
    await new Promise<void>((resolve) => setTimeout(resolve, Math.min(pollMs, Math.max(0, deadline - now()))));
  } while (true);
  throw new Error(`CHROME_BRIDGE_REFRESH_INCOMPLETE:${unavailable.join(",") || "NO_CATALOG"}`);
}
