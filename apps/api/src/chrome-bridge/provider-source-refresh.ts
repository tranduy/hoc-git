type FabetProvider = "SABA" | "IM" | "SBOBET" | "APSPORT" | "BTI";

interface RefreshControlPlane {
  reloadAllSources(): number;
  navigateLobby(lobby: string, url: string): number;
}

interface RefreshOptions {
  readonly controlPlane: RefreshControlPlane;
  readonly withLatestFabetLaunch: <T>(provider: FabetProvider, category: "FOOTBALL",
    consume: (url: string) => Promise<T>, minAcquiredAtMs: number) => Promise<T>;
  readonly minAcquiredAtMs: number;
}

const PROVIDER_LOBBIES = [
  ["SABA", "SABA"],
  ["IM", "IM"],
  ["SBOBET", "KSPORT"],
  ["APSPORT", "TSPORT"],
  ["BTI", "BTI"]
] as const satisfies readonly (readonly [FabetProvider, string])[];

export async function refreshBridgeProviderSources(options: RefreshOptions): Promise<number> {
  // Resolve the complete fresh launch set before touching any attached tab.
  // Partial success would mix old and new one-time tokens and make the button
  // report a successful refresh while one provider remains expired.
  const launches = await Promise.all(PROVIDER_LOBBIES.map(async ([provider, lobby]) =>
    options.withLatestFabetLaunch(provider, "FOOTBALL", async (url) => ({ lobby, url }),
      options.minAcquiredAtMs)));

  let requested = options.controlPlane.reloadAllSources();
  for (const launch of launches) {
    const delivered = options.controlPlane.navigateLobby(launch.lobby, launch.url);
    if (delivered === 0) throw new Error(`CHROME_BRIDGE_NAVIGATION_UNDELIVERED:${launch.lobby}`);
    requested += delivered;
  }
  return requested;
}
