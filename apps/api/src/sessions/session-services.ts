import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { SessionServices } from "../routes/sessions.js";
import { DomainDiscovery } from "./domain-discovery.js";
import {
  FabetBrowserDriver,
  PlaywrightFabetAutomation,
  type FabetBrowserAutomation
} from "./fabet-browser.js";
import { DpapiProtector } from "./dpapi-protector.js";
import { SecretVault } from "./secret-vault.js";
import { SessionManager } from "./session-manager.js";
import { TrustedDomainStore } from "./trusted-domain-store.js";
import type { SecretProtector, SessionValidator } from "./types.js";
import { AccountRegistry } from "../accounts/account-registry.js";
import type { ProviderProfileReader } from "../providers/provider-capabilities.js";
import { isVerifiedCmdFootballIdentity, PlaywrightCmdBrowserManager } from "../providers/cmd/cmd-browser-manager.js";
import { collectCmdIdentitySignals } from "../providers/browser-protocol-inspector.js";
import { CmdProfileReader } from "../providers/cmd/cmd-profile-reader.js";
import { CmdSessionValidator } from "../providers/cmd/cmd-session-validator.js";
import { CmdObservedCatalogReader } from "../providers/cmd/cmd-observed-catalog.js";
import { JitCmdFootballCatalogSource } from "../providers/cmd/cmd-football-jit-source.js";
import { PlaywrightSabaBrowserManager } from "../providers/saba/saba-browser-manager.js";
import { FabetSabaBrowserManager } from "../providers/saba/fabet-saba-browser-manager.js";
import { PlaywrightSabaFootballPushBrowserManager } from "../providers/saba/saba-football-push-browser-manager.js";
import { SabaObservedCatalogReader } from "../providers/saba/saba-observed-catalog.js";
import { SabaProfileReader } from "../providers/saba/saba-profile-reader.js";
import { SabaSessionValidator } from "../providers/saba/saba-session-validator.js";
import { SessionValidatorRegistry } from "./validators.js";
import { MultiProviderCatalogReader } from "../providers/multi-provider-catalog.js";
import { PlaywrightSbobetBrowserManager } from "../providers/sbobet/sbobet-browser-manager.js";
import { SbobetObservedCatalogReader } from "../providers/sbobet/sbobet-observed-catalog.js";
import { SbobetProfileReader } from "../providers/sbobet/sbobet-profile-reader.js";
import { SbobetSessionValidator } from "../providers/sbobet/sbobet-session-validator.js";
import { SbobetTicketPreflightReader } from "../providers/sbobet/sbobet-ticket-preflight-reader.js";
import { PlaywrightImFootballBrowserManager } from "../providers/im/im-football-browser-manager.js";
import { JitImFootballCatalogSource } from "../providers/im/im-football-jit-source.js";
import { ImFootballObservedCatalogReader } from "../providers/im/im-football-observed-catalog.js";
import { ImSessionValidator } from "../providers/im/im-session-validator.js";
import { ImProfileReader } from "../providers/im/im-profile-reader.js";
import { PlaywrightApsportBrowserManager } from "../providers/apsport/apsport-browser-manager.js";
import { ApsportSessionValidator } from "../providers/apsport/apsport-session-validator.js";
import { ApsportObservedCatalogReader } from "../providers/apsport/apsport-observed-catalog.js";
import { ApsportProfileReader } from "../providers/apsport/apsport-profile-reader.js";
import { PlaywrightBtiBrowserManager } from "../providers/bti/bti-browser-manager.js";
import { BtiSessionValidator } from "../providers/bti/bti-session-validator.js";
import { BtiObservedCatalogReader } from "../providers/bti/bti-observed-catalog.js";
import { BtiProfileReader } from "../providers/bti/bti-profile-reader.js";
import { ProviderPreflightRegistry } from "../preflight/provider-preflight-registry.js";
import { BtiTicketPreflightReader } from "../providers/bti/bti-ticket-preflight-reader.js";
import { ApsportTicketPreflightReader } from "../providers/apsport/apsport-ticket-preflight-reader.js";
import { SabaTicketPreflightReader } from "../providers/saba/saba-ticket-preflight-reader.js";
import type { FeeModel } from "@tool-chenh/core";
import { ReceiptProtocolRegistry } from "../receipts/receipt-protocol-registry.js";
import { SbobetReceiptProtocolReader } from "../providers/sbobet/sbobet-receipt-protocol-reader.js";
import { SbobetExecutionReceiptReader } from "../providers/sbobet/sbobet-execution-receipt-reader.js";
import type { ReceiptReader } from "../execution/receipt-reconciler.js";
import { CatalogSourceRegistry, type SupportedCatalogPair } from "../catalog/catalog-source-registry.js";
import { Tk88BrowserAutomation } from "./tk88-browser.js";
import { ConfiguredProxyAuthEgress, DirectAuthEgress, type AuthEgress } from "./auth-egress.js";
import { ProcessWarpCli, WarpSocksAuthEgress } from "./warp-socks-egress.js";
import { verifyRefreshedCatalogSources } from "./session-refresh.js";

export interface CreateSessionServicesOptions {
  readonly localAppData: string;
  readonly protector?: SecretProtector;
  readonly automation?: FabetBrowserAutomation;
  readonly fetch?: typeof globalThis.fetch;
  readonly clock?: { nowMs(): number };
  readonly idFactory?: () => string;
  readonly validators?: readonly SessionValidator[];
  readonly profileReaders?: readonly ProviderProfileReader[];
  readonly providerFees?: Partial<Record<"SABA" | "SBOBET" | "APSPORT" | "BTI", FeeModel>>;
  readonly fabetAuthProxyUrl?: string;
  readonly enableLocalWarpAuth?: boolean;
  readonly warpCliPath?: string;
  readonly warpProxyPort?: number;
}

export interface ManagedSessionServices extends SessionServices {
  readonly accounts: AccountRegistry;
  readonly catalogSources: CatalogSourceRegistry;
  readonly catalogReader: MultiProviderCatalogReader;
  readonly sabaCatalogReader: SabaObservedCatalogReader;
  readonly providerPreflight: ProviderPreflightRegistry;
  readonly receiptProtocol: ReceiptProtocolRegistry;
  readonly receiptReaders: readonly ReceiptReader[];
  readonly tk88Browser: Tk88BrowserAutomation;
  tick(): Promise<void>;
  renewAll(): Promise<void>;
  withLatestFabetLaunch<T>(provider: "SABA" | "IM" | "SBOBET" | "APSPORT" | "BTI",
    category: "FOOTBALL" | "LOL", consume: (url: string) => Promise<T>, minAcquiredAtMs?: number): Promise<T>;
  refreshAll(): Promise<void>;
  close(): Promise<void>;
}

const supportedCatalogPairs = ([
  { provider: "CMD", category: "FOOTBALL", alias: "CMD", anchorProvider: "FABET", anchorCategory: null },
  { provider: "SABA", category: "FOOTBALL", alias: "C-Sports · SABA" },
  { provider: "SBOBET", category: "FOOTBALL", alias: "K-Sports · SBOBET" },
  { provider: "APSPORT", category: "FOOTBALL", alias: "T-Sports · APSPORT" },
  { provider: "BTI", category: "FOOTBALL", alias: "BTI Football" },
  { provider: "IM", category: "FOOTBALL", alias: "I-Sports · IM", anchorProvider: "FABET", anchorCategory: null }
] as const).map((pair) => ({ ...pair, strategy: "FABET_LOGIN" as const })) satisfies readonly SupportedCatalogPair[];

function isSafeCapturedLaunch(value: string, expectedHost?: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.username === "" && url.password === "" &&
      (expectedHost === undefined || url.hostname === expectedHost);
  } catch {
    return false;
  }
}

export function createFabetAuthEgresses(options: {
  readonly authRoot: string;
  readonly proxyUrl?: string;
  readonly enableLocalWarp?: boolean;
  readonly warpCliPath?: string;
  readonly warpProxyPort?: number;
  readonly fileExists?: (path: string) => boolean;
}): readonly AuthEgress[] {
  const egresses: AuthEgress[] = [new DirectAuthEgress()];
  if (options.proxyUrl?.trim()) egresses.push(new ConfiguredProxyAuthEgress(options.proxyUrl.trim()));
  const warpCliPath = options.warpCliPath ?? "C:\\Program Files\\Cloudflare\\Cloudflare WARP\\warp-cli.exe";
  const localWarpEnabled = options.enableLocalWarp ?? process.platform === "win32";
  if (localWarpEnabled && (options.fileExists ?? existsSync)(warpCliPath)) {
    egresses.push(new WarpSocksAuthEgress({
      cli: new ProcessWarpCli({ executable: warpCliPath }),
      port: options.warpProxyPort ?? 40_000,
      leasePath: join(options.authRoot, "warp-auth-lease.json"),
    }));
  }
  return egresses;
}

export function createSessionServices(options: CreateSessionServicesOptions): ManagedSessionServices {
  if (options.localAppData.trim().length === 0) throw new Error("LOCAL_APP_DATA_REQUIRED");
  const clock = options.clock ?? { nowMs: Date.now };
  const root = resolve(join(options.localAppData, "tool-chenh", ".auth"));
  const vault = new SecretVault({
    directory: join(root, "vault"),
    protector: options.protector ?? new DpapiProtector()
  });
  const trustStore = new TrustedDomainStore({ vault, clock });
  const profilesRoot = join(root, "browser-profiles");
  const cmdBrowser = new PlaywrightCmdBrowserManager({
    profilesRoot: join(profilesRoot, "providers"),
    headless: true
  });
  const sabaDirectBrowser = new PlaywrightSabaBrowserManager({
    profilesRoot: join(profilesRoot, "providers-saba"),
    headless: true
  });
  const sabaFootballPushBrowser = new PlaywrightSabaFootballPushBrowserManager({
    profilesRoot: join(profilesRoot, "providers-saba-football-push"), headless: true
  });
  const sbobetBrowser = new PlaywrightSbobetBrowserManager({
    profilesRoot: join(profilesRoot, "providers-sbobet"), headless: true
  });
  const imFootballBrowser = new PlaywrightImFootballBrowserManager({
    profilesRoot: join(profilesRoot, "providers-im-football"), headless: true, startupTimeoutMs: 15_000
  });
  const apsportBrowser = new PlaywrightApsportBrowserManager({
    profilesRoot: join(profilesRoot, "providers-apsport"), headless: true
  });
  const btiBrowser = new PlaywrightBtiBrowserManager({
    profilesRoot: join(profilesRoot, "providers-bti"), headless: true
  });
  const automation = options.automation ?? new PlaywrightFabetAutomation({
    profilePath: join(profilesRoot, "fabet"),
    headless: false,
    vault,
  });
  const tk88Browser = new Tk88BrowserAutomation({
    profilePath: join(profilesRoot, "tk88"), headless: false,
    verifyProviderPage: async (provider, category, page) => provider === "CMD" && category === "FOOTBALL" &&
      isVerifiedCmdFootballIdentity(await collectCmdIdentitySignals(page))
  });
  const idFactory = options.idFactory ?? randomUUID;
  const fabetDriver = new FabetBrowserDriver({
    vault,
    trustStore,
    automation,
    profilesRoot,
    clock,
    idFactory
  });
  const fabetAuthEgresses = createFabetAuthEgresses({
    authRoot: root,
    ...(options.fabetAuthProxyUrl === undefined ? {} : { proxyUrl: options.fabetAuthProxyUrl }),
    ...(options.enableLocalWarpAuth === undefined ? {} : { enableLocalWarp: options.enableLocalWarpAuth }),
    ...(options.warpCliPath === undefined ? {} : { warpCliPath: options.warpCliPath }),
    ...(options.warpProxyPort === undefined ? {} : { warpProxyPort: options.warpProxyPort }),
  });
  const manager = new SessionManager({
    vault,
    validators: new SessionValidatorRegistry(options.validators ?? [
      new CmdSessionValidator(cmdBrowser),
      new SabaSessionValidator({ verifyLaunch: async (launchUrl) => isSafeCapturedLaunch(launchUrl) }),
      new SbobetSessionValidator({ verifyLaunch: async (launchUrl) => isSafeCapturedLaunch(launchUrl) }),
      new ImSessionValidator({ verifyLaunch: async (launchUrl) =>
        isSafeCapturedLaunch(launchUrl, "imesports.techplay.com") || imFootballBrowser.verifyLaunch(launchUrl) }),
      new ApsportSessionValidator(apsportBrowser),
      new BtiSessionValidator(btiBrowser)
    ]),
    clock,
    idFactory,
    fabetDriver,
    fabetAuthEgresses,
    resetFabetState: async () => trustStore.resetFabetHosts(),
    resetTk88State: async () => tk88Browser.resetProfile(),
    initializeTk88State: async (hostname) => tk88Browser.openPortal(hostname)
  });
  const sabaBrowser = new FabetSabaBrowserManager({ fabet: {
    withProviderPage: manager.withFabetProviderPage.bind(manager)
  }, fallback: sabaDirectBrowser, catalogFallback: sabaFootballPushBrowser });
  const discovery = new DomainDiscovery({
    trustStore,
    fetch: options.fetch ?? globalThis.fetch
  });
  const accounts = new AccountRegistry({
    vault,
    sessions: manager,
    readers: options.profileReaders ?? [
      new CmdProfileReader({ source: cmdBrowser, clock }),
      new SabaProfileReader({ source: sabaBrowser, clock }),
      new SbobetProfileReader({ source: sbobetBrowser, clock }),
      new ImProfileReader(),
      new ApsportProfileReader({ source: apsportBrowser, clock }),
      new BtiProfileReader({ source: btiBrowser, clock })
    ],
    clock,
    idFactory
  });
  const catalogSources = new CatalogSourceRegistry({ sessions: manager, accounts, supportedPairs: supportedCatalogPairs });
  const catalogReader = new CmdObservedCatalogReader({
    jitSource: new JitCmdFootballCatalogSource({
      fabet: { withProviderPage: manager.withFabetProviderPage.bind(manager) },
      browser: cmdBrowser,
      tk88: { withProviderPage: async (consume) =>
        tk88Browser.withVerifiedProviderPage("CMD", "FOOTBALL", consume) },
      sessionAccess: manager
    }),
    clock: { now: () => ({ wallClockNowMs: clock.nowMs(), monotonicNowMs: performance.now() }) },
    timezoneOffsetMinutes: 420
  });
  const sabaCatalogReader = new SabaObservedCatalogReader({
    accounts: catalogSources, source: { readCatalog: sabaBrowser.readRawCatalog.bind(sabaBrowser) },
    clock: { now: () => ({ wallClockNowMs: clock.nowMs(), monotonicNowMs: performance.now() }) }
  });
  const sbobetCatalogReader = new SbobetObservedCatalogReader({
    accounts: catalogSources, source: sbobetBrowser,
    clock: { now: () => ({ wallClockNowMs: clock.nowMs(), monotonicNowMs: performance.now() }) }
  });
  const imFootballCatalogReader = new ImFootballObservedCatalogReader({
    source: new JitImFootballCatalogSource({
      fabet: { withProviderPage: manager.withFabetProviderPage.bind(manager) },
      browser: imFootballBrowser
    })
  });
  const apsportCatalogReader = new ApsportObservedCatalogReader({ accounts: catalogSources, source: apsportBrowser });
  const btiCatalogReader = new BtiObservedCatalogReader({ accounts: catalogSources, source: btiBrowser });
  const providerPreflight = new ProviderPreflightRegistry({ accounts,
    readers: [new SabaTicketPreflightReader({ source: sabaBrowser,
      ...(options.providerFees?.SABA === undefined ? {} : { fee: options.providerFees.SABA }) }),
      new BtiTicketPreflightReader({ source: btiBrowser,
        ...(options.providerFees?.BTI === undefined ? {} : { fee: options.providerFees.BTI }) }),
      new ApsportTicketPreflightReader({ source: apsportBrowser,
        ...(options.providerFees?.APSPORT === undefined ? {} : { fee: options.providerFees.APSPORT }) }),
      new SbobetTicketPreflightReader({ source: sbobetBrowser,
        ...(options.providerFees?.SBOBET === undefined ? {} : { fee: options.providerFees.SBOBET }) })] });
  const receiptProtocol = new ReceiptProtocolRegistry({ accounts,
    readers: [new SbobetReceiptProtocolReader({ source: sbobetBrowser })] });
  const receiptReaders: readonly ReceiptReader[] = [new SbobetExecutionReceiptReader({
    accounts, source: sbobetBrowser
  })];
  const multiProviderCatalogReader = new MultiProviderCatalogReader({ sources: catalogSources,
    onAuthenticationFailure: async (failure) => { await manager.reportProviderFailure(failure); }, readers: [
    { provider: "CMD", category: "FOOTBALL", reader: catalogReader,
      cancel: async () => { await Promise.allSettled([automation.close(), cmdBrowser.close(), tk88Browser.close()]); } },
    { provider: "IM", category: "FOOTBALL", reader: imFootballCatalogReader,
      cancel: () => automation.close() },
    { provider: "SABA", category: "FOOTBALL", reader: sabaCatalogReader,
      cancel: async () => { await Promise.allSettled([automation.close(), sabaBrowser.close()]); } },
    { provider: "SBOBET", category: "FOOTBALL", reader: sbobetCatalogReader, cancel: () => sbobetBrowser.close() },
    { provider: "APSPORT", category: "FOOTBALL", reader: apsportCatalogReader, cancel: () => apsportBrowser.close() },
    { provider: "BTI", category: "FOOTBALL", reader: btiCatalogReader, cancel: () => btiBrowser.close() }
  ] });
  return {
    manager,
    discovery,
    trustStore,
    accounts,
    catalogSources,
    catalogReader: multiProviderCatalogReader,
    sabaCatalogReader,
    providerPreflight,
    receiptProtocol,
    receiptReaders,
    tk88Browser,
    async tick(): Promise<void> {
      await manager.tick();
    },
    async renewAll(): Promise<void> {
      await multiProviderCatalogReader.restartAll();
      const statuses = (await manager.listStatuses()).sessions;
      const operations = statuses.flatMap((status) => {
        if (status.source === "FABET_LOGIN" && status.provider === "FABET") return [manager.renew(status.id)];
        if (status.source === "MANUAL_PROVIDER_SESSION") return [manager.validate(status.id)];
        return [];
      });
      const results = await Promise.allSettled(operations);
      if (results.some((result) => result.status === "rejected" || result.value.state !== "ACTIVE")) {
        throw new Error("SESSION_REFRESH_FAILED");
      }
      catalogSources.invalidateSessionCache();
    },
    withLatestFabetLaunch: manager.withLatestFabetLaunch.bind(manager),
    async refreshAll(): Promise<void> {
      await this.renewAll();
      await verifyRefreshedCatalogSources({
        listSources: () => catalogSources.listStatuses(),
        readCatalog: (accountId) => multiProviderCatalogReader.read(accountId)
      });
    },
    async close(): Promise<void> {
      await Promise.all([
        automation.close(), cmdBrowser.close(), sabaBrowser.close(), sabaFootballPushBrowser.close(),
        sbobetBrowser.close(), apsportBrowser.close(), btiBrowser.close(), tk88Browser.close()
      ]);
    }
  };
}
