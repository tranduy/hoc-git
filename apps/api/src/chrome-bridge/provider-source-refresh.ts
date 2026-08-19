import type { ChromeLobbyId } from "@tool-chenh/contracts";

type FabetProvider = "SABA" | "IM" | "SBOBET" | "APSPORT" | "BTI";

interface RefreshControlPlane {
  ensureLobby(lobby: ChromeLobbyId, url: string): number;
  restoreLobby(lobby: ChromeLobbyId): number;
}

interface RefreshOptions {
  readonly controlPlane: RefreshControlPlane;
  readonly withLatestFabetLaunch: <T>(provider: FabetProvider, category: "FOOTBALL",
    consume: (url: string) => Promise<T>, minAcquiredAtMs: number) => Promise<T>;
  readonly minAcquiredAtMs: number;
  readonly providers?: readonly FabetProvider[];
  readonly restoreCmd?: boolean;
}

const PROVIDER_LOBBIES = [
  ["SABA", "SABA"],
  ["IM", "IM"],
  ["SBOBET", "KSPORT"],
  ["APSPORT", "TSPORT"],
  ["BTI", "BTI"]
] as const satisfies readonly (readonly [FabetProvider, ChromeLobbyId])[];

export async function refreshBridgeProviderSources(options: RefreshOptions): Promise<number> {
  // Resolve the complete fresh launch set before touching any attached tab.
  // Partial success would mix old and new one-time tokens and make the button
  // report a successful refresh while one provider remains expired.
  const selected = options.providers === undefined
    ? PROVIDER_LOBBIES
    : PROVIDER_LOBBIES.filter(([provider]) => options.providers?.includes(provider));
  const launches = await Promise.all(
    selected.map(async ([provider, lobby]) =>
      options.withLatestFabetLaunch(provider, "FOOTBALL", async (url) => ({ lobby, url }),
        options.minAcquiredAtMs)));

  let requested = 0;
  for (const launch of launches) {
    const delivered = options.controlPlane.ensureLobby(launch.lobby, launch.url);
    if (delivered === 0) throw new Error(`CHROME_BRIDGE_ENSURE_UNDELIVERED:${launch.lobby}`);
    requested += delivered;
  }
  if (options.restoreCmd ?? true) {
    const restored = options.controlPlane.restoreLobby("CMD");
    if (restored === 0) throw new Error("CHROME_BRIDGE_RESTORE_UNDELIVERED:CMD");
    requested += restored;
  }
  return requested;
}
