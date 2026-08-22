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
  readonly refreshLaunches?: () => Promise<void>;
  readonly maxLaunchAttempts?: number;
  readonly beforeDelivery?: () => void | Promise<void>;
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
  const maxLaunchAttempts = Math.max(1, Math.floor(options.maxLaunchAttempts ?? 1));
  let launches: Awaited<ReturnType<typeof collectLaunches>> = [];
  for (let attempt = 1; attempt <= maxLaunchAttempts; attempt += 1) {
    launches = await collectLaunches(selected, options);
    const failure = launches.find((result) => !result.ok);
    if (failure === undefined) break;
    if (attempt === maxLaunchAttempts || options.refreshLaunches === undefined) {
      const reason = failure.error instanceof Error
        ? failure.error.message
        : "FABET_PROVIDER_LAUNCH_UNAVAILABLE";
      throw new Error(`${reason}:${failure.provider}`);
    }
    await options.refreshLaunches();
  }

  await options.beforeDelivery?.();

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

async function collectLaunches(
  selected: readonly (readonly [FabetProvider, ChromeLobbyId])[],
  options: RefreshOptions
) {
  return Promise.all(selected.map(async ([provider, lobby]) => {
    try {
      // K-Sports is launched through the authenticated Fabet portal. Its
      // stored sportsbook URL is only an identity marker; the portal obtains
      // a fresh one-time popup URL when the reset is delivered.
      const minAcquiredAtMs = provider === "SBOBET" ? 0 : options.minAcquiredAtMs;
      const launch = await options.withLatestFabetLaunch(provider, "FOOTBALL",
        async (url) => ({ lobby, url }), minAcquiredAtMs);
      return { ok: true, provider, launch } as const;
    } catch (error) {
      return { ok: false, provider, error } as const;
    }
  }));
}
