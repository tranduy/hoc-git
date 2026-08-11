import { createHash } from "node:crypto";
import { join } from "node:path";
import type { SbobetCatalogInputRecord } from "@tool-chenh/adapters";
import { chromium, type BrowserContext, type Page } from "playwright";
import { extractBtiCatalogRecords } from "./bti-direct-catalog.js";

interface OpenSession {
  readonly context: BrowserContext;
  readonly page: Page;
  readonly initialUrl: string;
}

export interface BtiCatalogSnapshot {
  readonly records: readonly SbobetCatalogInputRecord[];
  readonly observedAtMs: number;
  readonly receivedMonotonicMs: number;
}

export interface BtiProfileSnapshot {
  readonly displayName: string;
  readonly balanceText: string;
  readonly currencyCode: string;
  readonly observedAtMs: number;
}

export interface BtiIdentityEvidence {
  readonly hostname: string;
  readonly title: string;
  readonly hasFootball: boolean;
  readonly hasLiveInitial: boolean;
}

function safeLaunch(value: string): URL {
  if (value.length === 0 || value.length > 24_000) throw new Error("BTI_LAUNCH_URL_INVALID");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("BTI_LAUNCH_URL_INVALID");
  return url;
}

export function isVerifiedBtiIdentity(value: BtiIdentityEvidence): boolean {
  return /^prod\d+\.fxf\d+\.com$/u.test(value.hostname) && value.title === "Sportsbook" && value.hasFootball && value.hasLiveInitial;
}

export class PlaywrightBtiBrowserManager {
  readonly #profilesRoot: string;
  readonly #headless: boolean;
  readonly #timeoutMs: number;
  readonly #sessions = new Map<string, OpenSession>();
  readonly #opening = new Map<string, Promise<OpenSession>>();
  readonly #reads = new Map<string, Promise<BtiCatalogSnapshot>>();

  constructor(options: { profilesRoot: string; headless?: boolean; startupTimeoutMs?: number }) {
    this.#profilesRoot = options.profilesRoot;
    this.#headless = options.headless ?? false;
    this.#timeoutMs = options.startupTimeoutMs ?? 30_000;
  }

  async verifyLaunch(launchUrl: string): Promise<boolean> {
    try { await this.#get({ sessionId: "validator", launchUrl }); return true; }
    catch { return false; }
  }

  async readCatalog(input: { sessionId: string; launchUrl: string }): Promise<BtiCatalogSnapshot> {
    const active = this.#reads.get(input.sessionId);
    if (active !== undefined) return active;
    const next = this.#read(input).finally(() => {
      if (this.#reads.get(input.sessionId) === next) this.#reads.delete(input.sessionId);
    });
    this.#reads.set(input.sessionId, next);
    return next;
  }

  async readProfile(input: { sessionId: string; launchUrl: string }): Promise<BtiProfileSnapshot> {
    const session = await this.#get(input);
    const profile = await session.page.evaluate(() => {
      const token = localStorage.getItem("CT_APP_AUTHORIZATION");
      if (token === null) return null;
      try {
        const encoded = token.split(".")[1];
        if (encoded === undefined) return null;
        const normalized = encoded.replace(/-/gu, "+").replace(/_/gu, "/");
        const payload: unknown = JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")));
        if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
        const claims = payload as Record<string, unknown>;
        if (typeof claims.customerLogin !== "string" || typeof claims.currencyCode !== "string" ||
          typeof claims.balance !== "number" || !Number.isFinite(claims.balance) || claims.balance < 0) return null;
        return { displayName: claims.customerLogin, balanceText: `${claims.balance} K`, currencyCode: claims.currencyCode };
      } catch { return null; }
    });
    if (profile === null) throw new Error("BTI_PROFILE_UNAVAILABLE");
    return { ...profile, observedAtMs: Date.now() };
  }

  async close(): Promise<void> {
    const sessions = [...this.#sessions.values()];
    this.#sessions.clear();
    this.#reads.clear();
    await Promise.allSettled(sessions.map((session) => session.context.close()));
  }

  async #read(input: { sessionId: string; launchUrl: string }): Promise<BtiCatalogSnapshot> {
    const session = await this.#get(input);
    const payload: unknown = await session.page.evaluate(async (url) => {
      const response = await fetch(url, { credentials: "include" });
      if (!response.ok) throw new Error("BTI_CATALOG_UNAVAILABLE");
      return response.json();
    }, session.initialUrl);
    const records = extractBtiCatalogRecords(payload);
    if (records.length === 0) throw new Error("BTI_CATALOG_EMPTY");
    return { records, observedAtMs: Date.now(), receivedMonotonicMs: performance.now() };
  }

  async #get(input: { sessionId: string; launchUrl: string }): Promise<OpenSession> {
    const key = createHash("sha256").update(input.launchUrl).digest("hex").slice(0, 24);
    const current = this.#sessions.get(key);
    if (current !== undefined && !current.page.isClosed()) return current;
    const pending = this.#opening.get(key);
    if (pending !== undefined) return pending;
    const next = this.#open(input.launchUrl, key).finally(() => this.#opening.delete(key));
    this.#opening.set(key, next);
    return next;
  }

  async #open(launchUrl: string, key: string): Promise<OpenSession> {
    const launch = safeLaunch(launchUrl);
    let context: BrowserContext | null = null;
    try {
      context = await chromium.launchPersistentContext(join(this.#profilesRoot,
        `bti-${key}`), {
        headless: this.#headless, acceptDownloads: false
      });
      const page = context.pages()[0] ?? await context.newPage();
      let initialUrl = "";
      page.on("response", (response) => {
        try {
          const url = new URL(response.url());
          if (url.pathname === "/api/eventlist/asia/leagues/v2/1/live/initial" && response.status() === 200) initialUrl = url.toString();
        } catch { /* Ignore malformed third-party URLs. */ }
      });
      await page.goto(launch.toString(), { waitUntil: "domcontentloaded", timeout: this.#timeoutMs });
      const deadline = Date.now() + this.#timeoutMs;
      let evidence: BtiIdentityEvidence = { hostname: launch.hostname, title: "", hasFootball: false, hasLiveInitial: false };
      while (!isVerifiedBtiIdentity(evidence) && Date.now() < deadline) {
        evidence = {
          hostname: new URL(page.url()).hostname.toLowerCase(),
          title: await page.title(),
          hasFootball: await page.locator(".navigation_asia_fe_Sport_sportName").filter({ hasText: /^Bóng đá$/u }).first().isVisible().catch(() => false),
          hasLiveInitial: initialUrl !== ""
        };
        if (!isVerifiedBtiIdentity(evidence)) await page.waitForTimeout(100);
      }
      if (!isVerifiedBtiIdentity(evidence) || initialUrl === "") throw new Error("BTI_SCHEMA_CHANGED");
      const session = { context, page, initialUrl };
      this.#sessions.set(key, session);
      context = null;
      return session;
    } catch {
      throw new Error("BTI_BROWSER_UNAVAILABLE");
    } finally {
      await context?.close().catch(() => undefined);
    }
  }
}
