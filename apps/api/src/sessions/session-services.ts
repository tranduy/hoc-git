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
import { SessionValidatorRegistry } from "./validators.js";

export interface CreateSessionServicesOptions {
  readonly localAppData: string;
  readonly protector?: SecretProtector;
  readonly automation?: FabetBrowserAutomation;
  readonly fetch?: typeof globalThis.fetch;
  readonly clock?: { nowMs(): number };
  readonly idFactory?: () => string;
  readonly validators?: readonly SessionValidator[];
}

export interface ManagedSessionServices extends SessionServices {
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
    validators: new SessionValidatorRegistry(options.validators ?? []),
    clock,
    idFactory,
    fabetDriver,
    resetFabetState: async () => trustStore.resetFabetHosts()
  });
  const discovery = new DomainDiscovery({
    trustStore,
    fetch: options.fetch ?? globalThis.fetch
  });
  return {
    manager,
    discovery,
    trustStore,
    async tick(): Promise<void> {
      await manager.tick();
    },
    async close(): Promise<void> {
      await automation.close();
    }
  };
}
