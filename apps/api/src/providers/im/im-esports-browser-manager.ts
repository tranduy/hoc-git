import { createHash } from "node:crypto";
import { join } from "node:path";
import type { ImEsportsMarketRecord } from "@tool-chenh/adapters";
import { chromium, type BrowserContext, type Page, type Response } from "playwright";
import { extractImCatalogRecords } from "./im-catalog-source.js";

interface OpenSession {
  readonly context: BrowserContext;
  readonly page: Page;
  records: readonly ImEsportsMarketRecord[];
}

function validateImLaunchUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.hostname !== "imesports.techplay.com" ||
    url.pathname !== "/esportsitev2/index.html") throw new Error("IM_ESPORTS_LAUNCH_REJECTED");
  return url.toString();
}

export class PlaywrightImEsportsBrowserManager {
  readonly #profilesRoot: string;
  readonly #headless: boolean;
  readonly #timeoutMs: number;
  readonly #sessions = new Map<string, OpenSession>();
  readonly #opening = new Map<string, Promise<OpenSession>>();

  constructor(options: { readonly profilesRoot: string; readonly headless?: boolean; readonly startupTimeoutMs?: number }) {
    this.#profilesRoot = options.profilesRoot;
    this.#headless = options.headless ?? false;
    this.#timeoutMs = options.startupTimeoutMs ?? 30_000;
  }

  async verifyLaunch(launchUrl: string): Promise<boolean> {
    const sessionId = `verify-${createHash("sha256").update(launchUrl).digest("hex").slice(0, 20)}`;
    try {
      const session = await this.#open({ sessionId, launchUrl });
      await this.#waitForCatalog(session);
      return true;
    } catch {
      return false;
    } finally {
      const session = this.#sessions.get(sessionId);
      this.#sessions.delete(sessionId);
      await session?.context.close().catch(() => undefined);
    }
  }

  async readCatalog(input: { readonly sessionId: string; readonly launchUrl: string }): Promise<readonly ImEsportsMarketRecord[]> {
    let session = await this.#get(input);
    try { return await this.#waitForCatalog(session); }
    catch {
      await session.context.close().catch(() => undefined);
      this.#sessions.delete(input.sessionId);
      session = await this.#get(input);
      return this.#waitForCatalog(session);
    }
  }

  async close(): Promise<void> {
    const sessions = [...this.#sessions.values()];
    this.#sessions.clear();
    await Promise.allSettled(sessions.map(async (session) => session.context.close()));
  }

  async #get(input: { readonly sessionId: string; readonly launchUrl: string }): Promise<OpenSession> {
    const current = this.#sessions.get(input.sessionId);
    if (current !== undefined && !current.page.isClosed()) return current;
    const opening = this.#opening.get(input.sessionId);
    if (opening !== undefined) return opening;
    const operation = this.#open(input).finally(() => this.#opening.delete(input.sessionId));
    this.#opening.set(input.sessionId, operation);
    return operation;
  }

  async #open(input: { readonly sessionId: string; readonly launchUrl: string }): Promise<OpenSession> {
    const launchUrl = validateImLaunchUrl(input.launchUrl);
    const profile = `im-esports-${createHash("sha256").update(input.sessionId).digest("hex").slice(0, 24)}`;
    const context = await chromium.launchPersistentContext(join(this.#profilesRoot, profile), {
      headless: this.#headless, acceptDownloads: false
    });
    try {
      const page = context.pages()[0] ?? await context.newPage();
      const session: OpenSession = { context, page, records: [] };
      const pending = new Set<Promise<void>>();
      const capture = async (response: Response): Promise<void> => {
        const url = new URL(response.url());
        if (response.request().method() !== "POST" || url.hostname !== "imesports.techplay.com" ||
          url.pathname !== "/api/GetIndexMatchV2" || !response.ok()) return;
        const records = extractImCatalogRecords(await response.json());
        if (records.length > 0) session.records = records;
      };
      page.on("response", (response) => {
        const operation = capture(response).catch(() => undefined).finally(() => pending.delete(operation));
        pending.add(operation);
      });
      await page.goto(launchUrl, { waitUntil: "domcontentloaded", timeout: this.#timeoutMs });
      this.#sessions.set(input.sessionId, session);
      return session;
    } catch {
      await context.close().catch(() => undefined);
      throw new Error("IM_ESPORTS_BROWSER_UNAVAILABLE");
    }
  }

  async #waitForCatalog(session: OpenSession): Promise<readonly ImEsportsMarketRecord[]> {
    const deadline = Date.now() + this.#timeoutMs;
    while (Date.now() < deadline) {
      if (session.records.some((record) => record.sportId === 45 && record.gameTypeCode === "SeriesWin")) {
        return session.records;
      }
      await session.page.waitForTimeout(100);
    }
    throw new Error("IM_ESPORTS_CATALOG_UNAVAILABLE");
  }
}
