import { rm } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import type { Category, ProviderId } from "@tool-chenh/contracts";

export interface Tk88LoungeIdentity {
  readonly provider: Exclude<ProviderId, "FABET">;
  readonly category: Category;
  readonly portalUrl: string;
  readonly trustedHostname: string;
  readonly launcherLabel: string;
}

interface Tk88BrowserOptions {
  readonly profilePath: string;
  readonly headless?: boolean;
  readonly navigationTimeoutMs?: number;
  readonly launch?: (profilePath: string, headless: boolean) => Promise<BrowserContext>;
  readonly verifyProviderPage?: (provider: Exclude<ProviderId, "FABET">, category: Category,
    page: Page) => Promise<boolean>;
}

class AsyncLock {
  #tail: Promise<void> = Promise.resolve();

  async run<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.#tail;
    let release!: () => void;
    this.#tail = new Promise<void>((resolveLock) => { release = resolveLock; });
    await previous;
    try { return await operation(); }
    finally { release(); }
  }
}

function validatedIdentity(identity: Tk88LoungeIdentity): Tk88LoungeIdentity {
  const trustedHostname = identity.trustedHostname.trim().toLowerCase();
  const launcherLabel = identity.launcherLabel.trim().replace(/\s+/gu, " ");
  let portal: URL;
  try { portal = new URL(identity.portalUrl); }
  catch { throw new Error("TK88_LOUNGE_CONFIG_INVALID"); }
  if (portal.protocol !== "https:" || portal.username !== "" || portal.password !== "" ||
    portal.hostname !== trustedHostname || portal.search !== "" || portal.hash !== "" ||
    trustedHostname.length === 0 || launcherLabel.length === 0) {
    throw new Error("TK88_LOUNGE_CONFIG_INVALID");
  }
  return { ...identity, portalUrl: portal.href, trustedHostname, launcherLabel };
}

function loungeKey(identity: Tk88LoungeIdentity): string {
  return [identity.provider, identity.category, identity.trustedHostname, identity.launcherLabel].join("|");
}

export class Tk88BrowserAutomation {
  readonly #profilePath: string;
  readonly #headless: boolean;
  readonly #navigationTimeoutMs: number;
  readonly #launch: NonNullable<Tk88BrowserOptions["launch"]>;
  readonly #verifyProviderPage: Tk88BrowserOptions["verifyProviderPage"];
  readonly #pages = new Map<string, Page>();
  readonly #locks = new Map<string, AsyncLock>();
  #context: Promise<BrowserContext> | null = null;
  readonly #providerScanLock = new AsyncLock();

  constructor(options: Tk88BrowserOptions) {
    this.#profilePath = resolve(options.profilePath);
    if (basename(this.#profilePath).toLowerCase() !== "tk88") throw new Error("TK88_PROFILE_PATH_INVALID");
    this.#headless = options.headless ?? false;
    this.#navigationTimeoutMs = options.navigationTimeoutMs ?? 15_000;
    if (!Number.isFinite(this.#navigationTimeoutMs) || this.#navigationTimeoutMs <= 0) {
      throw new Error("TK88_NAVIGATION_TIMEOUT_INVALID");
    }
    this.#launch = options.launch ?? (async (profilePath, headless) => chromium.launchPersistentContext(profilePath, {
      headless, viewport: null
    }));
    this.#verifyProviderPage = options.verifyProviderPage;
  }

  async withVerifiedProviderPage<T>(provider: Exclude<ProviderId, "FABET">, category: Category,
    consume: (page: Page) => Promise<T>): Promise<T> {
    const verifier = this.#verifyProviderPage;
    if (verifier === undefined) throw new Error("TK88_PROVIDER_PAGE_UNAVAILABLE");
    return this.#providerScanLock.run(async () => {
      let context: BrowserContext;
      try { context = await this.#contextForUse(); }
      catch { throw new Error("TK88_PROVIDER_PAGE_UNAVAILABLE"); }
      const matches: Page[] = [];
      for (const page of context.pages()) {
        if (page.isClosed()) continue;
        try {
          if (await verifier(provider, category, page)) matches.push(page);
        } catch {
          // One malformed or navigating tab cannot make another verified tab usable.
        }
      }
      if (matches.length === 0) throw new Error("TK88_PROVIDER_PAGE_UNAVAILABLE");
      if (matches.length !== 1) throw new Error("TK88_PROVIDER_PAGE_AMBIGUOUS");
      return consume(matches[0]!);
    });
  }

  async withLoungePage<T>(identityInput: Tk88LoungeIdentity, consume: (page: Page) => Promise<T>): Promise<T> {
    const identity = validatedIdentity(identityInput);
    const key = loungeKey(identity);
    const lock = this.#locks.get(key) ?? new AsyncLock();
    this.#locks.set(key, lock);
    return lock.run(async () => {
      let page: Page;
      try {
        const current = this.#pages.get(key);
        if (current === undefined || current.isClosed()) {
          page = await (await this.#contextForUse()).newPage();
          this.#pages.set(key, page);
        } else {
          page = current;
        }
        if (page.url() !== identity.portalUrl) {
          await page.goto(identity.portalUrl, { waitUntil: "domcontentloaded", timeout: this.#navigationTimeoutMs });
        }
      } catch {
        throw new Error("TK88_LOUNGE_UNAVAILABLE");
      }
      return consume(page);
    });
  }

  async openPortal(hostnameInput: string): Promise<void> {
    const hostname = hostnameInput.trim().toLowerCase();
    let root: URL;
    try { root = new URL(`https://${hostname}/`); }
    catch { throw new Error("TK88_PORTAL_CONFIG_INVALID"); }
    if (hostname.length === 0 || root.hostname !== hostname || root.pathname !== "/" || root.search !== "" ||
      root.hash !== "" || root.username !== "" || root.password !== "") {
      throw new Error("TK88_PORTAL_CONFIG_INVALID");
    }
    await this.withLoungePage({
      provider: "CMD", category: "FOOTBALL", portalUrl: root.href,
      trustedHostname: hostname, launcherLabel: "CMD"
    }, async () => undefined);
  }

  async close(): Promise<void> {
    const context = this.#context;
    this.#context = null;
    this.#pages.clear();
    this.#locks.clear();
    if (context !== null) await (await context).close();
  }

  async resetProfile(): Promise<void> {
    await this.close();
    await rm(this.#profilePath, { recursive: true, force: true });
  }

  #contextForUse(): Promise<BrowserContext> {
    this.#context ??= this.#launch(this.#profilePath, this.#headless).catch((error: unknown) => {
      this.#context = null;
      throw error;
    });
    return this.#context;
  }
}
