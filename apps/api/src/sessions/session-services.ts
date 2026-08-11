import { randomUUID } from "node:crypto";
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
import { PlaywrightCmdBrowserManager } from "../providers/cmd/cmd-browser-manager.js";
import { CmdProfileReader } from "../providers/cmd/cmd-profile-reader.js";
import { CmdSessionValidator } from "../providers/cmd/cmd-session-validator.js";
import { CmdObservedCatalogReader } from "../providers/cmd/cmd-observed-catalog.js";
import { PlaywrightSabaBrowserManager } from "../providers/saba/saba-browser-manager.js";
import { SabaObservedCatalogReader } from "../providers/saba/saba-observed-catalog.js";
import { SabaProfileReader } from "../providers/saba/saba-profile-reader.js";
import { SabaSessionValidator } from "../providers/saba/saba-session-validator.js";
import { PlaywrightSabaEsportsBrowserManager } from "../providers/saba/saba-esports-browser-manager.js";
import { SabaEsportsObservedCatalogReader } from "../providers/saba/saba-esports-observed-catalog.js";
import { SessionValidatorRegistry } from "./validators.js";
import { MultiProviderCatalogReader } from "../providers/multi-provider-catalog.js";
import { PlaywrightSbobetBrowserManager } from "../providers/sbobet/sbobet-browser-manager.js";
import { SbobetObservedCatalogReader } from "../providers/sbobet/sbobet-observed-catalog.js";
import { SbobetProfileReader } from "../providers/sbobet/sbobet-profile-reader.js";
import { SbobetSessionValidator } from "../providers/sbobet/sbobet-session-validator.js";
import { PlaywrightImEsportsBrowserManager } from "../providers/im/im-esports-browser-manager.js";
import { ImEsportsObservedCatalogReader } from "../providers/im/im-esports-observed-catalog.js";
import { ImSessionValidator } from "../providers/im/im-session-validator.js";
import { ImProfileReader } from "../providers/im/im-profile-reader.js";

export interface CreateSessionServicesOptions {
  readonly localAppData: string;
  readonly protector?: SecretProtector;
  readonly automation?: FabetBrowserAutomation;
  readonly fetch?: typeof globalThis.fetch;
  readonly clock?: { nowMs(): number };
  readonly idFactory?: () => string;
  readonly validators?: readonly SessionValidator[];
  readonly profileReaders?: readonly ProviderProfileReader[];
}

export interface ManagedSessionServices extends SessionServices {
  readonly accounts: AccountRegistry;
  readonly catalogReader: MultiProviderCatalogReader;
  readonly sabaCatalogReader: SabaObservedCatalogReader;
  tick(): Promise<void>;
  close(): Promise<void>;
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
    headless: false
  });
  const sabaBrowser = new PlaywrightSabaBrowserManager({
    profilesRoot: join(profilesRoot, "providers-saba"),
    headless: false
  });
  const sabaEsportsBrowser = new PlaywrightSabaEsportsBrowserManager({
    profilesRoot: join(profilesRoot, "providers-saba-esports"),
    headless: false
  });
  const sbobetBrowser = new PlaywrightSbobetBrowserManager({
    profilesRoot: join(profilesRoot, "providers-sbobet"), headless: false
  });
  const imEsportsBrowser = new PlaywrightImEsportsBrowserManager({
    profilesRoot: join(profilesRoot, "providers-im-esports"), headless: false
  });
  const automation = options.automation ?? new PlaywrightFabetAutomation({
    profilePath: join(profilesRoot, "fabet"),
    headless: false
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
  const manager = new SessionManager({
    vault,
    validators: new SessionValidatorRegistry(options.validators ?? [
      new CmdSessionValidator(cmdBrowser),
      new SabaSessionValidator(sabaEsportsBrowser),
      new SbobetSessionValidator(sbobetBrowser),
      new ImSessionValidator(imEsportsBrowser)
    ]),
    clock,
    idFactory,
    fabetDriver,
    resetFabetState: async () => trustStore.resetFabetHosts()
  });
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
      new SbobetProfileReader(),
      new ImProfileReader()
    ],
    clock,
    idFactory
  });
  const catalogReader = new CmdObservedCatalogReader({
    accounts,
    source: cmdBrowser,
    clock: { now: () => ({ wallClockNowMs: clock.nowMs(), monotonicNowMs: performance.now() }) },
    timezoneOffsetMinutes: 420
  });
  const sabaCatalogReader = new SabaObservedCatalogReader({
    accounts,
    source: sabaBrowser,
    clock: { now: () => ({ wallClockNowMs: clock.nowMs(), monotonicNowMs: performance.now() }) },
    timezoneOffsetMinutes: 420
  });
  const sbobetCatalogReader = new SbobetObservedCatalogReader({
    accounts, source: sbobetBrowser,
    clock: { now: () => ({ wallClockNowMs: clock.nowMs(), monotonicNowMs: performance.now() }) }
  });
  const sabaEsportsCatalogReader = new SabaEsportsObservedCatalogReader({
    accounts, source: sabaEsportsBrowser,
    clock: { now: () => ({ wallClockNowMs: clock.nowMs(), monotonicNowMs: performance.now() }) }
  });
  const imEsportsCatalogReader = new ImEsportsObservedCatalogReader({
    accounts, source: imEsportsBrowser,
    clock: { now: () => ({ wallClockNowMs: clock.nowMs(), monotonicNowMs: performance.now() }) }
  });
  return {
    manager,
    discovery,
    trustStore,
    accounts,
    catalogReader: new MultiProviderCatalogReader([
      catalogReader, sabaEsportsCatalogReader, imEsportsCatalogReader, sabaCatalogReader, sbobetCatalogReader
    ]),
    sabaCatalogReader,
    async tick(): Promise<void> {
      await manager.tick();
    },
    async close(): Promise<void> {
      await Promise.all([
        automation.close(), cmdBrowser.close(), sabaBrowser.close(), sabaEsportsBrowser.close(),
        sbobetBrowser.close(), imEsportsBrowser.close()
      ]);
    }
  };
}
