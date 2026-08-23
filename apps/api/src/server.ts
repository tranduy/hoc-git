import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { TwoLegPreflight } from "./preflight/two-leg-preflight.js";
import { FixtureAdapter, type FixtureSnapshot } from "@tool-chenh/adapters";
import type { Category, ChromeLobbyId, DataMode } from "@tool-chenh/contracts";
import { buildApp, validateViteOrigin } from "./app.js";
import { Runtime, type RuntimeOptions } from "./runtime.js";
import { createSessionServices } from "./sessions/session-services.js";
import { CatalogTelemetryRegistry } from "./routes/catalog-telemetry.js";
import { JsonlCatalogJournal } from "./routes/catalog-jsonl-journal.js";
import { FileTicketRealtimeAuditJournal } from "./routes/ticket-realtime-audit-journal.js";
import { FileTicketReportJournal } from "./routes/ticket-report-journal.js";
import { LiveCatalogBridge } from "./catalog/live-catalog-bridge.js";
import { resolveProviderFees } from "./providers/provider-fees.js";
import { FileBetHistory } from "./history/file-bet-history.js";
import { createDailyMaintenanceScheduler, createSessionMaintenanceRunner,
  MaintenanceJournal, SessionRefreshControl } from "./session-maintenance.js";
import { DurableCatalogStore } from "./catalog/durable-catalog-store.js";
import { bindGracefulShutdown } from "./process-shutdown.js";
import { ChromeBridgeRegistry } from "./chrome-bridge/chrome-bridge-registry.js";
import { CaptureStore } from "./chrome-bridge/capture-store.js";
import { ChromeCatalogDataPlane } from "./chrome-bridge/chrome-catalog-data-plane.js";
import { CmdHiddenMarketProbeCoordinator } from "./chrome-bridge/cmd-hidden-market-probe-coordinator.js";
import { SelectionPriceProbeCoordinator } from "./chrome-bridge/selection-price-probe-coordinator.js";
import { createChromeCatalogOverlay } from "./chrome-bridge/chrome-catalog-overlay.js";
import { isOpenProviderTicketEnabled } from "./chrome-bridge/chrome-bridge-feature-flags.js";
import { ChromeBridgeControlPlane } from "./chrome-bridge/chrome-bridge-control-plane.js";
import { refreshBridgeProviderSources } from "./chrome-bridge/provider-source-refresh.js";
import { AutomaticSourceRecovery, type RecoveryResult } from "./chrome-bridge/automatic-source-recovery.js";
import { ProviderFeedRegistry } from "./chrome-bridge/provider-feed-registry.js";
import type { ProviderFeedSnapshot, ProviderRecoveryRequest } from "./chrome-bridge/provider-feed-types.js";
import type { RefreshableProvider } from "./routes/maintenance.js";
import { resolveLocalAppData } from "./local-app-data.js";
import { LatestCatalogPersister } from "./catalog/latest-catalog-persister.js";
import { refreshCatalogSources } from "./catalog-refresh.js";
import { CatalogRevisionStore } from "./catalog/catalog-revision-store.js";

export interface ServerConfig {
  readonly host: string;
  readonly port: number;
  readonly viteOrigin: string;
  readonly dataMode: DataMode;
  readonly fixtureReplaySpeed: number;
}

interface RecoverySweepRegistry {
  list(): readonly ProviderFeedSnapshot[];
  sweep(eligibleAccountIds?: ReadonlySet<string>): readonly ProviderRecoveryRequest[];
  dispose(): void;
}

interface RecoverySweepActor {
  recover(request: ProviderRecoveryRequest): Promise<RecoveryResult>;
  dispose(): void | Promise<void>;
}

interface RecoverySweepOptions {
  readonly isRecoverySuppressed?: (accountId: string) => boolean;
  readonly onError?: (accountId: string | null, error: unknown) => void;
}

export function startProviderRecoverySweep(
  providerFeeds: RecoverySweepRegistry,
  automaticSourceRecovery: RecoverySweepActor,
  options: RecoverySweepOptions = {}
): { dispose(): Promise<void> } {
  let disposal: Promise<void> | null = null;
  const report = (accountId: string | null, error: unknown): void => {
    try { options.onError?.(accountId, error); } catch { /* reporting must not stop the sweep */ }
  };
  const feedSweep = setInterval(() => {
    try {
      const eligible = new Set(providerFeeds.list()
        .filter(({ accountId }) => options.isRecoverySuppressed?.(accountId) !== true)
        .map(({ accountId }) => accountId));
      for (const request of providerFeeds.sweep(eligible)) {
        try {
          void automaticSourceRecovery.recover(request).catch((error) => { report(request.accountId, error); });
        } catch (error) {
          report(request.accountId, error);
        }
      }
    } catch (error) {
      report(null, error);
    }
  }, 1_000);
  feedSweep.unref();
  return {
    dispose(): Promise<void> {
      if (disposal !== null) return disposal;
      clearInterval(feedSweep);
      const actorDisposal = automaticSourceRecovery.dispose();
      providerFeeds.dispose();
      disposal = Promise.resolve(actorDisposal);
      return disposal;
    }
  };
}

interface TargetedProviderRefreshOptions {
  readonly now?: () => number;
  readonly baselineTimeoutMs?: number;
  readonly deliver: (provider: RefreshableProvider) => Promise<number>;
  readonly waitForFreshBaseline: (accountId: string, afterMs: number,
    timeoutMs: number) => Promise<ProviderFeedSnapshot>;
}

export function createTargetedProviderRefresh(options: TargetedProviderRefreshOptions): {
  refresh(provider: RefreshableProvider): Promise<number>;
  isRecoverySuppressed(accountId: string): boolean;
} {
  const baselineTimeoutMs = options.baselineTimeoutMs ?? 10_000;
  if (!Number.isFinite(baselineTimeoutMs) || baselineTimeoutMs <= 0) {
    throw new Error("TARGETED_PROVIDER_REFRESH_OPTIONS_INVALID");
  }
  const now = options.now ?? Date.now;
  const owners = new Map<string, number>();
  const acquire = (accountId: string): void => { owners.set(accountId, (owners.get(accountId) ?? 0) + 1); };
  const release = (accountId: string): void => {
    const remaining = (owners.get(accountId) ?? 1) - 1;
    if (remaining <= 0) owners.delete(accountId);
    else owners.set(accountId, remaining);
  };
  return {
    async refresh(provider): Promise<number> {
      const accountId = `catalog-source:${provider}:FOOTBALL`;
      const requestedAtMs = now();
      acquire(accountId);
      try {
        const delivered = await options.deliver(provider);
        await options.waitForFreshBaseline(accountId, requestedAtMs, baselineTimeoutMs);
        return delivered;
      } finally {
        release(accountId);
      }
    },
    isRecoverySuppressed(accountId): boolean {
      return (owners.get(accountId) ?? 0) > 0;
    }
  };
}

const fixtureSources = [
  ["football/saba-snapshot.json", "SABA", "FOOTBALL"],
  ["football/im-snapshot.json", "IM", "FOOTBALL"],
  ["lol/saba-snapshot.json", "SABA", "LOL"],
  ["lol/im-snapshot.json", "IM", "LOL"]
] as const;

const chromeLobbyIds = new Set<ChromeLobbyId>(["IM", "BTI", "TSPORT", "KSPORT", "SABA", "CMD", "SBO"]);

function captureLobbies(value: string | undefined): readonly ChromeLobbyId[] | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  return value.split(",").map((item) => item.trim().toUpperCase())
    .filter((item): item is ChromeLobbyId => chromeLobbyIds.has(item as ChromeLobbyId));
}

export function shouldRunLegacySessionMaintenance(
  env: Readonly<Record<string, string | undefined>>
): boolean {
  const value = env.SESSION_MAINTENANCE_ENABLED?.trim();
  if (value === undefined || value === "") return true;
  if (value === "0") return false;
  if (value === "1") return true;
  throw new Error("SESSION_MAINTENANCE_ENABLED must be 0, 1 or unset");
}

export function shouldPersistCatalogJournal(
  env: Readonly<Record<string, string | undefined>>
): boolean {
  return env.TOOL_CHENH_CATALOG_JOURNAL_ENABLED?.trim() === "1";
}

const fixtureMappingPolicy = {
  prematchToleranceMs: 120_000,
  liveClockToleranceMs: 20_000,
  aliasRegistry: {
    version: "fixture-v1",
    aliases: {
      FOOTBALL: {
        northbridge_fc: "northbridge_fc",
        riverside_united: "riverside_united",
        city_academy: "city_academy",
        united_academy: "united_academy"
      },
      LOL: {
        blue_comets: "blue_comets",
        red_phoenix: "red_phoenix",
        alpha_academy: "alpha_academy",
        beta_academy: "beta_academy",
        gamma_academy: "gamma_academy"
      }
    }
  }
} as const;

const inspectableFixtureEndMs = 90;
const fixtureInspectionTtlMs = 300_000;
const fixtureReevaluationIntervalMs = 250;

function positiveNumber(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be positive`);
  return parsed;
}

function portNumber(value: string | undefined): number {
  const port = positiveNumber(value, 4310, "API_PORT");
  if (!Number.isSafeInteger(port) || port > 65_535) {
    throw new Error("API_PORT must be an integer between 1 and 65535");
  }
  return port;
}

function loopbackHost(value: string | undefined): string {
  const host = value ?? "127.0.0.1";
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) {
    throw new Error("API_HOST must be a loopback host");
  }
  return host;
}

function dataMode(value: string | undefined): DataMode {
  if (value === undefined) return "LIVE";
  if (value === "1") return "FIXTURE";
  throw new Error("FIXTURE_MODE must be 1 or unset");
}

export function resolveServerConfig(env: Readonly<Record<string, string | undefined>>): ServerConfig {
  return {
    host: loopbackHost(env.API_HOST),
    port: portNumber(env.API_PORT),
    viteOrigin: validateViteOrigin(env.VITE_ORIGIN ?? "http://127.0.0.1:4311"),
    dataMode: dataMode(env.FIXTURE_MODE),
    fixtureReplaySpeed: positiveNumber(env.FIXTURE_REPLAY_SPEED, 1, "FIXTURE_REPLAY_SPEED")
  };
}

export function createLiveRuntime(
  adapters: RuntimeOptions["adapters"] = [],
  mappingPolicy?: RuntimeOptions["mappingPolicy"]
): Runtime {
  return new Runtime({ adapters, ...(mappingPolicy === undefined ? {} : { mappingPolicy }) });
}

export function createFixtureRuntime(speed: number): Runtime {
  const monotonicEpochMs = performance.now();
  const wallClockEpochMs = Date.now();
  const adapters = fixtureSources.map(([path, provider, category]) => {
    const sourceFixture = JSON.parse(
      readFileSync(new URL(`../../../fixtures/${path}`, import.meta.url), "utf8")
    ) as FixtureSnapshot;
    const fixture: FixtureSnapshot = {
      ...sourceFixture,
      records: sourceFixture.records.filter((record) => record.offsetMs <= inspectableFixtureEndMs)
    };
    return new FixtureAdapter(fixture, {
      id: fixture.adapterId,
      provider,
      category: category as Category,
      speed
    });
  });
  return new Runtime({
    adapters,
    mappingPolicy: fixtureMappingPolicy,
    opportunityPolicy: {
      baseCurrency: "USD",
      bankroll: "1000",
      minimumNetMargin: "0",
      minimumWorstCaseProfit: "0",
      minimumRoi: "0",
      minimumRemainingTtlMs: 0,
      providers: Object.fromEntries(["SABA", "IM"].map((provider) => [provider, {
        fee: { type: "PROFIT" as const, rate: "0.01" },
        constraint: { minStake: "1", maxStake: "1000", stakeStep: "1", balance: "1000" },
        fx: {
          sourceCurrency: "USD",
          baseCurrency: "USD",
          rate: "1",
          spreadRate: "0",
          asOfMs: wallClockEpochMs,
          maxAgeMs: fixtureInspectionTtlMs
        }
      }]))
    },
    freshnessPolicies: Object.fromEntries(["SABA", "IM"].map((provider) => [provider, {
      websocketTtlMs: fixtureInspectionTtlMs,
      pollingTtlMs: fixtureInspectionTtlMs,
      maxFutureClockSkewMs: 100,
      missingSourceTimestamp: "USE_RECEIVED_TIME" as const
    }])),
    clock: {
      now: () => {
        const elapsedMs = Math.max(0, performance.now() - monotonicEpochMs);
        return {
          monotonicNowMs: 100 + elapsedMs,
          wallClockNowMs: wallClockEpochMs + elapsedMs
        };
      }
    }
  });
}

export async function startServer(env: Readonly<Record<string, string | undefined>> = process.env) {
  const config = resolveServerConfig(env);
  const localAppData = resolveLocalAppData(env);
  if (localAppData === null) throw new Error("LOCAL_APP_DATA_REQUIRED");
  const sessionServices = createSessionServices({
    localAppData,
    providerFees: resolveProviderFees(env),
    ...(env.FABET_AUTH_PROXY_URL?.trim() ? { fabetAuthProxyUrl: env.FABET_AUTH_PROXY_URL.trim() } : {}),
    enableLocalWarpAuth: localWarpAuthEnabled(env.FABET_LOCAL_WARP_AUTH),
    ...(env.FABET_WARP_CLI_PATH?.trim() ? { warpCliPath: env.FABET_WARP_CLI_PATH.trim() } : {}),
    ...(env.FABET_WARP_PROXY_PORT?.trim()
      ? { warpProxyPort: positiveNumber(env.FABET_WARP_PROXY_PORT, 40_000, "FABET_WARP_PROXY_PORT") }
      : {}),
  });
  const catalogTelemetry = shouldPersistCatalogJournal(env)
    ? new CatalogTelemetryRegistry(undefined, new JsonlCatalogJournal(
      join(localAppData, "tool-chenh", "logs", "catalog-changes.jsonl")
    ))
    : new CatalogTelemetryRegistry();
  const catalogBridge = new LiveCatalogBridge();
  const runtime = config.dataMode === "FIXTURE"
    ? createFixtureRuntime(config.fixtureReplaySpeed)
    : createLiveRuntime(catalogBridge.adapters, catalogBridge.mappingPolicy);
  const controller = new AbortController();
  await runtime.start(controller.signal);
  const twoLegPreflight = new TwoLegPreflight({ opportunities: runtime, providers: sessionServices.providerPreflight });
  const betHistory = new FileBetHistory(join(localAppData, "tool-chenh", "history", "bets.jsonl"));
  const ticketRealtimeAudit = new FileTicketRealtimeAuditJournal(
    join(localAppData, "tool-chenh", "logs", "realtime-ticket-checks.jsonl")
  );
  const ticketReports = new FileTicketReportJournal(
    join(localAppData, "tool-chenh", "logs", "ticket-reports.jsonl")
  );
  const catalogStore = new DurableCatalogStore(join(localAppData, "tool-chenh", "catalog-cache"));
  const catalogPersister = new LatestCatalogPersister(catalogStore);
  const catalogRevisions = new CatalogRevisionStore();
  const chromeBridgeKey = env.CHROME_BRIDGE_KEY?.trim();
  const chromeBridgeRegistry = chromeBridgeKey ? new ChromeBridgeRegistry() : null;
  const chromeBridgeControlPlane = chromeBridgeRegistry ? new ChromeBridgeControlPlane({
    activeSourceIds: () => new Set(chromeBridgeRegistry.listSources().map((source) => source.sourceId))
  }) : null;
  const providerFeeds = chromeBridgeRegistry ? new ProviderFeedRegistry() : null;
  const cmdHiddenMarketProbe = chromeBridgeRegistry && chromeBridgeControlPlane
    ? new CmdHiddenMarketProbeCoordinator({ listSources: () => chromeBridgeRegistry.listSources(),
      controlPlane: chromeBridgeControlPlane })
    : null;
  const selectionPriceProbe = chromeBridgeRegistry && chromeBridgeControlPlane
    ? new SelectionPriceProbeCoordinator({ listSources: () => chromeBridgeRegistry.listSources(),
      controlPlane: chromeBridgeControlPlane })
    : null;
  const chromeCatalogDataPlane = chromeBridgeRegistry
    ? new ChromeCatalogDataPlane({ publish: (catalog, snapshotState) => {
      catalogRevisions.publish(catalog.accountId, catalog, { snapshotState, freshnessMs: 20_000 });
      catalogPersister.schedule(`catalog-source|${catalog.provider}|${catalog.category}`, catalog);
    }, ...(providerFeeds === null ? {} : { feedRegistry: providerFeeds }) })
    : null;
  if (chromeCatalogDataPlane !== null) {
    await Promise.all(["CMD", "IM", "SABA", "SBOBET", "APSPORT", "BTI"].map(async (provider) => {
      const catalog = await catalogStore.load(`catalog-source|${provider}|FOOTBALL`);
      if (catalog !== null) chromeCatalogDataPlane.restore(catalog);
    }));
  }
  if (chromeBridgeRegistry) {
    const allowedCaptureLobbies = captureLobbies(env.CHROME_BRIDGE_CAPTURE_LOBBIES);
    const captureStore = new CaptureStore({
      enabled: env.CHROME_BRIDGE_CAPTURE === "1",
      directory: join(localAppData, "tool-chenh", "chrome-bridge-captures"),
      ...(allowedCaptureLobbies === undefined ? {} : { allowedLobbies: allowedCaptureLobbies })
    });
    chromeBridgeRegistry.subscribe((envelope) => { void captureStore.record(envelope); });
    chromeBridgeRegistry.subscribe((envelope, context) => { chromeCatalogDataPlane?.ingest(envelope, context); });
    if (cmdHiddenMarketProbe !== null) {
      chromeBridgeRegistry.subscribe((envelope) => { cmdHiddenMarketProbe.ingest(envelope); });
    }
    if (selectionPriceProbe !== null) {
      chromeBridgeRegistry.subscribe((envelope) => { selectionPriceProbe.ingest(envelope); });
    }
  }
  const catalogAccess = chromeCatalogDataPlane === null
    ? { sources: sessionServices.catalogSources, reader: sessionServices.catalogReader }
    : createChromeCatalogOverlay({
      sources: sessionServices.catalogSources,
      reader: sessionServices.catalogReader,
      chrome: chromeCatalogDataPlane
    });
  const maintenance = new SessionRefreshControl({ refresh: async () => {
    // Only the explicit Reset button and scheduled 03:00 run enter this path.
    // They are the sole authority to replace a complete catalog with a much
    // smaller provider baseline after a real day/view transition.
    return refreshCatalogSources({
      legacyRefresh: () => sessionServices.refreshAll(),
      ...(chromeBridgeControlPlane === null ? {} : {
        prepareSources: async () => {
          await sessionServices.renewAll();
        }
      }),
      ...(chromeBridgeControlPlane === null
        ? {}
        : { requestBridgeSnapshots: async (freshAfterMs) => {
          return refreshBridgeProviderSources({
            controlPlane: chromeBridgeControlPlane,
            withLatestFabetLaunch: sessionServices.withLatestFabetLaunch,
            minAcquiredAtMs: freshAfterMs,
            refreshLaunches: () => sessionServices.refreshFabetLaunches(),
            maxLaunchAttempts: 3,
            // Do not discard healthy catalogs when launch preflight fails.
            // Reset coverage only once every provider can be delivered.
            beforeDelivery: () => chromeCatalogDataPlane?.resetCoverage()
          });
        } }),
      statuses: () => catalogAccess.sources.listStatuses(),
      ...(chromeBridgeRegistry === null ? {} : { bridgeSources: () => chromeBridgeRegistry.listSources() })
    });
  },
    journal: new MaintenanceJournal({ nowMs: Date.now },
      join(localAppData, "tool-chenh", "maintenance", "events.jsonl")) });
  const targetedProviderRefresh = chromeBridgeControlPlane === null || providerFeeds === null ? null
    : createTargetedProviderRefresh({
      deliver: async (provider) => refreshBridgeProviderSources({
          controlPlane: chromeBridgeControlPlane,
          withLatestFabetLaunch: sessionServices.withLatestFabetLaunch,
          minAcquiredAtMs: 0,
          providers: [provider],
          restoreCmd: false
        }),
      waitForFreshBaseline: providerFeeds.waitForFreshBaseline.bind(providerFeeds)
    });
  const refreshProvider = targetedProviderRefresh === null ? undefined
    : targetedProviderRefresh.refresh;
  const isRecoverySuppressed = (accountId: string): boolean => maintenance.status().running ||
    targetedProviderRefresh?.isRecoverySuppressed(accountId) === true;
  const automaticSourceRecovery = chromeBridgeControlPlane !== null && providerFeeds !== null
    ? new AutomaticSourceRecovery({
      controlPlane: chromeBridgeControlPlane,
      feedRegistry: providerFeeds,
      refreshFabetLaunches: async (signal) => {
        assertRecoveryActive(signal);
        await sessionServices.refreshFabetLaunches();
        assertRecoveryActive(signal);
      },
      withLatestFabetLaunch: async (provider, category, consume, minAcquiredAtMs, signal) =>
        sessionServices.withLatestFabetLaunch(provider, category, async (url) => {
          assertRecoveryActive(signal);
          const result = await consume(url);
          assertRecoveryActive(signal);
          return result;
        }, minAcquiredAtMs),
      isRecoverySuppressed,
      onError: (accountId, error) => {
        const reason = error instanceof Error ? error.message : String(error);
        process.stderr.write(`[source-recovery] ${accountId} failed: ${reason}\n`);
      }
    })
    : null;
  const app = buildApp(runtime, {
    viteOrigin: config.viteOrigin,
    heartbeatIntervalMs: fixtureReevaluationIntervalMs,
    sessionServices,
    accountRegistry: sessionServices.accounts,
    catalogSources: catalogAccess.sources,
    catalogReader: catalogAccess.reader,
    // The live comparison page consumes the bounded catalog read model
    // directly. Feeding every large provider catalog through the legacy
    // AppSnapshot mapper duplicates all mapping work and can block HTTP/WS.
    // Fixture mode keeps its deterministic observer path for integration tests.
    catalogTelemetry,
    catalogStore,
    catalogRevisions,
    providerPreflight: sessionServices.providerPreflight,
    providerPreflightOptions: { journal: ticketRealtimeAudit, reportJournal: ticketReports,
      ...(selectionPriceProbe === null ? {} : { visiblePriceProbe: selectionPriceProbe }) },
    twoLegPreflight,
    receiptProtocol: sessionServices.receiptProtocol,
    betHistory,
    maintenance,
    ...(refreshProvider === undefined ? {} : { refreshProvider }),
    ...(cmdHiddenMarketProbe === null ? {} : { cmdHiddenMarketProbe }),
    ...(chromeBridgeRegistry && chromeBridgeKey
      ? { chromeBridge: {
        registry: chromeBridgeRegistry,
        ...(chromeBridgeControlPlane === null ? {} : { controlPlane: chromeBridgeControlPlane }),
        installationKey: chromeBridgeKey,
        openProviderTicket: isOpenProviderTicketEnabled(env.ENABLE_OPEN_PROVIDER_TICKET)
      } }
      : {})
  });
  const providerRecovery = automaticSourceRecovery === null || providerFeeds === null
    ? null
    : startProviderRecoverySweep(providerFeeds, automaticSourceRecovery, {
      isRecoverySuppressed,
      onError: (accountId, error) => {
        const reason = error instanceof Error ? error.message : String(error);
        process.stderr.write(`[source-recovery] ${accountId ?? "sweep"} failed: ${reason}\n`);
      }
    });
  if (providerRecovery !== null) {
    app.addHook("onClose", async () => { await providerRecovery.dispose(); });
  }
  await app.listen({ host: config.host, port: config.port });
  const dailyMaintenance = createDailyMaintenanceScheduler(() => maintenance.runScheduled());
  dailyMaintenance.start();
  let sessionTimer: ReturnType<typeof setInterval> | null = null;
  if (shouldRunLegacySessionMaintenance(env)) {
    const maintainSessions = createSessionMaintenanceRunner(
      () => sessionServices.tick(),
      (error) => app.log.error({ error }, "Session maintenance failed; live catalog remains available")
    );
    void maintainSessions();
    sessionTimer = setInterval(() => { void maintainSessions(); }, 60_000);
    sessionTimer.unref();
  }
  return {
    app,
    runtime,
    async stop(): Promise<void> {
      dailyMaintenance.stop();
      if (sessionTimer !== null) clearInterval(sessionTimer);
      controller.abort();
      await app.close();
      await sessionServices.close();
    }
  };
}

export function localWarpAuthEnabled(value: string | undefined): boolean {
  return value === "1";
}

function assertRecoveryActive(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw new Error("RECOVERY_DISPOSED");
}

const entryPath = process.argv[1];
if (entryPath !== undefined && import.meta.url === pathToFileURL(entryPath).href) {
  startServer().then(({ stop }) => {
    bindGracefulShutdown({ lifecycle: process, stop, exit: (code) => process.exit(code) });
  }, () => {
    process.stderr.write("API failed to start\n");
    process.exitCode = 1;
  });
}
