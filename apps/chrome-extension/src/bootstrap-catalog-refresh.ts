import type { ChromeLobbyId } from "@tool-chenh/contracts";

/**
 * Books whose full list arrives only when their page bootstraps.
 *
 * A fresh server process starts with no catalog while the worker, the tab and
 * the provider socket all stay alive, so ordinary live traffic never replaces
 * what it missed. Measured 2026-08-27: after a server restart SABA fell from 86
 * events with 19 upcoming to 68 with 4 and stayed there - its pre-match list
 * gone, which is most of what another book can be compared against.
 */
const BOOTSTRAP_CATALOG_LOBBIES: ReadonlySet<ChromeLobbyId> = new Set<ChromeLobbyId>(["SABA", "IM"]);

export interface AttachedLobby {
  readonly lobby: ChromeLobbyId;
  readonly tabId: number;
}

export interface BootstrapCatalogSource {
  readonly lobby: ChromeLobbyId;
  readonly tabId: number;
  readonly sourceId: string;
}

/** The attached sources worth asking for a fresh baseline when the bridge
 *  reconnects. Asking is not replaying: it is one current baseline per book,
 *  not every cached payload, which is what would flood a new process. */
export function bootstrapCatalogSources(
  attached: readonly AttachedLobby[]
): readonly BootstrapCatalogSource[] {
  const seen = new Set<number>();
  const sources: BootstrapCatalogSource[] = [];
  for (const entry of attached) {
    if (!BOOTSTRAP_CATALOG_LOBBIES.has(entry.lobby) || seen.has(entry.tabId)) continue;
    seen.add(entry.tabId);
    sources.push({ lobby: entry.lobby, tabId: entry.tabId,
      sourceId: `chrome:${entry.lobby}:${entry.tabId}` });
  }
  return sources;
}
