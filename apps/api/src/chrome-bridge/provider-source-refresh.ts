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
  const selected = options.providers === undefined
    ? PROVIDER_LOBBIES
    : PROVIDER_LOBBIES.filter(([provider]) => options.providers?.includes(provider));
  const launches = await Promise.all(selected.map(async ([provider, lobby]) => {
    try {
      const launch = await options.withLatestFabetLaunch(provider, "FOOTBALL",
        async (url) => ({ lobby, url }), options.minAcquiredAtMs);
      return { ok: true, provider, launch } as const;
    } catch (error) {
      return { ok: false, provider, error } as const;
    }
  }));

  let requested = 0;
  let firstFailure: Error | null = null;
  for (const result of launches) {
    if (!result.ok) {
      const reason = result.error instanceof Error ? result.error.message : "FABET_PROVIDER_LAUNCH_UNAVAILABLE";
      firstFailure ??= new Error(`${reason}:${result.provider}`);
      continue;
    }
    const delivered = options.controlPlane.ensureLobby(result.launch.lobby, result.launch.url);
    if (delivered === 0) {
      firstFailure ??= new Error(`CHROME_BRIDGE_ENSURE_UNDELIVERED:${result.launch.lobby}`);
      continue;
    }
    requested += delivered;
  }
  if (options.restoreCmd ?? true) {
    const restored = options.controlPlane.restoreLobby("CMD");
    if (restored === 0) firstFailure ??= new Error("CHROME_BRIDGE_RESTORE_UNDELIVERED:CMD");
    else requested += restored;
  }
  if (firstFailure !== null) throw firstFailure;
  return requested;
}
