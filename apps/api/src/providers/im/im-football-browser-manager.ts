import { createHash } from "node:crypto";
import { join } from "node:path";
import type { SbobetCatalogInputRecord } from "@tool-chenh/adapters";
import { chromium, type BrowserContext, type Page, type Response } from "playwright";
import { installCatalogResourcePolicy } from "../browser-resource-policy.js";
import { extractImFootballCatalog, mergeImFootballDelta,
  mergeImFootballSnapshots } from "./im-football-catalog-source.js";
import { ImFootballDirectTransport, type ImFootballRequestTemplate } from "./im-football-direct-transport.js";

const imFootballHost = "imsports.directsb.net";
const snapshotPath = "/api/EventV6/GetSE";
const deltaPath = "/api/EventV6/GetSEDelta";
const catalogPaths = new Set([snapshotPath, deltaPath]);

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

export interface ImFootballCatalogSnapshot {
  readonly records: readonly SbobetCatalogInputRecord[];
  readonly observedAtMs: number;
  readonly receivedMonotonicMs: number;
}

interface LivePageState {
  readonly groups: Map<string, readonly SbobetCatalogInputRecord[]>;
  readonly pending: Set<Promise<void>>;
  readonly directTemplates: Map<string, ImFootballRequestTemplate>;
  observedAtMs: number;
  receivedMonotonicMs: number;
}

export function validateImFootballLaunchUrl(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("IM_FOOTBALL_LAUNCH_REJECTED"); }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" ||
    url.hostname !== imFootballHost) throw new Error("IM_FOOTBALL_LAUNCH_REJECTED");
  return url.toString();
}

export function isImFootballCatalogResponse(responseUrl: string, body: unknown): boolean {
  let url: URL;
  try { url = new URL(responseUrl); } catch { return false; }
  const root = object(body);
  if (url.protocol !== "https:" || url.hostname !== imFootballHost || !catalogPaths.has(url.pathname) ||
    root === null || root.StatusCode !== 100) return false;
  return url.pathname === snapshotPath ? Array.isArray(root.sel) : Array.isArray(root.dc);
}

export class PlaywrightImFootballBrowserManager {
  readonly #profilesRoot: string;
  readonly #headless: boolean;
  readonly #timeoutMs: number;
  readonly #livePages = new WeakMap<Page, LivePageState>();
  readonly #directTransport: ImFootballDirectTransport;
  #directState: LivePageState | null = null;

  constructor(options: { readonly profilesRoot: string; readonly headless?: boolean; readonly startupTimeoutMs?: number;
    readonly directTransport?: ImFootballDirectTransport }) {
    this.#profilesRoot = options.profilesRoot;
    this.#headless = options.headless ?? false;
    this.#timeoutMs = options.startupTimeoutMs ?? 30_000;
    this.#directTransport = options.directTransport ?? new ImFootballDirectTransport();
  }

  async verifyLaunch(launchUrlValue: string): Promise<boolean> {
    const launchUrl = validateImFootballLaunchUrl(launchUrlValue);
    const profile = `im-football-verify-${createHash("sha256").update(launchUrl).digest("hex").slice(0, 20)}`;
    let context: BrowserContext | null = null;
    try {
      context = await chromium.launchPersistentContext(join(this.#profilesRoot, profile), {
        headless: this.#headless, acceptDownloads: false
      });
      await installCatalogResourcePolicy(context);
      const page = context.pages()[0] ?? await context.newPage();
      let verified = false;
      const pending = new Set<Promise<void>>();
      const capture = async (response: Response): Promise<void> => {
        if (response.request().method() !== "POST" || !response.ok()) return;
        const body: unknown = await response.json();
        if (isImFootballCatalogResponse(response.url(), body)) verified = true;
      };
      page.on("response", (response) => {
        const operation = capture(response).catch(() => undefined).finally(() => pending.delete(operation));
        pending.add(operation);
      });
      await page.goto(launchUrl, { waitUntil: "domcontentloaded", timeout: this.#timeoutMs });
      const deadline = Date.now() + this.#timeoutMs;
      while (!verified && Date.now() < deadline) await page.waitForTimeout(100);
      await Promise.allSettled([...pending]);
      return verified;
    } catch {
      return false;
    } finally {
      await context?.close().catch(() => undefined);
    }
  }

  async readCatalogFromPage(page: Page): Promise<ImFootballCatalogSnapshot> {
    if (page.isClosed()) throw new Error("IM_FOOTBALL_CATALOG_UNAVAILABLE");
    let state = this.#livePages.get(page);
    if (state === undefined) {
      state = { groups: new Map(), pending: new Set(), directTemplates: new Map(),
        observedAtMs: 0, receivedMonotonicMs: 0 };
      this.#livePages.set(page, state);
      this.#directState = state;
      page.on("response", (response) => {
        const operation = this.#captureLiveResponse(state!, response).catch(() => undefined)
          .finally(() => state!.pending.delete(operation));
        state!.pending.add(operation);
      });
    }
    const hasRecords = [...state.groups.values()].some((records) => records.length > 0);
    if (hasRecords && state.directTemplates.size > 0) {
      await this.#refreshDirectSnapshots(state);
    } else {
      await page.reload({ waitUntil: "domcontentloaded", timeout: this.#timeoutMs }).catch(() => undefined);
    }
    const deadline = Date.now() + this.#timeoutMs;
    while (Date.now() < deadline) {
      await Promise.allSettled([...state.pending]);
      const records = mergeImFootballSnapshots([...state.groups.values()]);
      if (records.length > 0) return {
        records,
        observedAtMs: state.observedAtMs,
        receivedMonotonicMs: state.receivedMonotonicMs
      };
      await page.waitForTimeout(50);
    }
    throw new Error("IM_FOOTBALL_CATALOG_UNAVAILABLE");
  }

  async readCatalogDirect(): Promise<ImFootballCatalogSnapshot> {
    const state = this.#directState;
    if (state === null || state.directTemplates.size === 0) {
      throw new Error("IM_FOOTBALL_DIRECT_LEASE_UNAVAILABLE");
    }
    try {
      await this.#refreshDirectSnapshots(state);
    } catch {
      state.directTemplates.clear();
      throw new Error("IM_FOOTBALL_DIRECT_UNAVAILABLE");
    }
    const records = mergeImFootballSnapshots([...state.groups.values()]);
    if (records.length === 0) throw new Error("IM_FOOTBALL_CATALOG_UNAVAILABLE");
    return { records, observedAtMs: state.observedAtMs, receivedMonotonicMs: state.receivedMonotonicMs };
  }

  async #captureLiveResponse(state: LivePageState, response: Response): Promise<void> {
    if (response.request().method() !== "POST" || !response.ok()) return;
    const body: unknown = await response.json();
    if (!isImFootballCatalogResponse(response.url(), body)) return;
    const path = new URL(response.url()).pathname;
    if (path === snapshotPath) {
      let group = "snapshot";
      let requestBody: Readonly<Record<string, unknown>> | null = null;
      try {
        requestBody = response.request().postDataJSON() as Record<string, unknown>;
        if (requestBody.Market === 2 || requestBody.Market === 3) group = `market-${requestBody.Market}`;
      } catch { /* retain fail-closed generic group */ }
      if (requestBody !== null) {
        try {
          state.directTemplates.set(group, {
            url: response.url(), headers: await response.request().allHeaders(), body: requestBody
          });
        } catch { /* A catalog response can remain valid even when its replay lease cannot be captured. */ }
      }
      state.groups.set(group, extractImFootballCatalog(body));
    } else {
      for (const [group, records] of state.groups) state.groups.set(group, mergeImFootballDelta(records, body));
    }
    state.observedAtMs = Date.now();
    state.receivedMonotonicMs = performance.now();
  }

  async #refreshDirectSnapshots(state: LivePageState): Promise<void> {
    const snapshots = [...state.directTemplates.entries()].filter(([, template]) => {
      try { return new URL(template.url).pathname === snapshotPath; } catch { return false; }
    });
    if (snapshots.length === 0) return;
    const payloads = await Promise.all(snapshots.map(async ([group, template]) =>
      [group, await this.#directTransport.read(template)] as const));
    for (const [group, payload] of payloads) state.groups.set(group, extractImFootballCatalog(payload));
    state.observedAtMs = Date.now();
    state.receivedMonotonicMs = performance.now();
  }
}
