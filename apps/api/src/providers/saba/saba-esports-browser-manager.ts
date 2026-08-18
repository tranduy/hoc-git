import { createHash } from "node:crypto";
import { join } from "node:path";
import { normalizeSabaLolRecords } from "@tool-chenh/adapters";
import { chromium, type BrowserContext, type Page } from "playwright";
import { validateCmdLaunchUrl } from "../cmd/cmd-browser-manager.js";
import { exactSabaLolUrl } from "./saba-esports-navigation.js";
import { SabaPushDecoder } from "./saba-push-decoder.js";
import { parseSabaSocketFrame } from "./saba-socket-frame.js";

interface OpenSession {
  readonly context: BrowserContext;
  readonly page: Page;
  readonly snapshots: Map<string, readonly Readonly<Record<string, unknown>>[]>;
}

export class PlaywrightSabaEsportsBrowserManager {
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
    const id = `verify-${createHash("sha256").update(launchUrl).digest("hex").slice(0, 20)}`;
    try {
      const session = await this.#open({ sessionId: id, launchUrl });
      await this.#waitForCatalog(session);
      return true;
    } catch {
      return false;
    } finally {
      const session = this.#sessions.get(id);
      this.#sessions.delete(id);
      await session?.context.close().catch(() => undefined);
    }
  }

  async readCatalog(input: { readonly sessionId: string; readonly launchUrl: string }): Promise<readonly Readonly<Record<string, unknown>>[]> {
    let session = await this.#get(input);
    try {
      return await this.#waitForCatalog(session);
    } catch {
      await session.context.close().catch(() => undefined);
      this.#sessions.delete(input.sessionId);
      session = await this.#get(input);
      return this.#waitForCatalog(session);
    }
  }

  async readCatalogFromPage(page: Page): Promise<readonly Readonly<Record<string, unknown>>[]> {
    const snapshots = new Map<string, readonly Readonly<Record<string, unknown>>[]>();
    const session = { context: page.context(), page, snapshots };
    this.#captureSockets(page, snapshots);
    const deadline = Date.now() + this.#timeoutMs;
    let target: string | null = null;
    while (target === null && Date.now() < deadline) {
      try { target = exactSabaLolUrl(page.url()); } catch { await page.waitForTimeout(100); }
    }
    if (target === null) throw new Error("SABA_ESPORTS_BROWSER_UNAVAILABLE");
    // The Fabet popup has already loaded the provider before this reader can
    // subscribe to page websocket events. A same-URL goto may reuse the SPA
    // connection and emit no new snapshot, so force a clean document first.
    await page.goto("about:blank", { waitUntil: "domcontentloaded", timeout: this.#timeoutMs });
    await page.goto(target, { waitUntil: "domcontentloaded", timeout: this.#timeoutMs });
    return this.#waitForCatalog(session);
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
    const launchUrl = validateCmdLaunchUrl(input.launchUrl);
    const profile = `saba-esports-${createHash("sha256").update(input.sessionId).digest("hex").slice(0, 24)}`;
    const context = await chromium.launchPersistentContext(join(this.#profilesRoot, profile), {
      headless: this.#headless, acceptDownloads: false
    });
    try {
      const page = context.pages()[0] ?? await context.newPage();
      const snapshots = new Map<string, readonly Readonly<Record<string, unknown>>[]>();
      this.#captureSockets(page, snapshots);
      await page.goto(launchUrl, { waitUntil: "domcontentloaded", timeout: this.#timeoutMs });
      await page.waitForTimeout(1_500);
      if (await page.locator("body").innerText().catch(() => "") === "") {
        await page.reload({ waitUntil: "domcontentloaded", timeout: this.#timeoutMs });
      }
      await page.goto(exactSabaLolUrl(page.url()), { waitUntil: "domcontentloaded", timeout: this.#timeoutMs });
      const session = { context, page, snapshots };
      this.#sessions.set(input.sessionId, session);
      return session;
    } catch {
      await context.close().catch(() => undefined);
      throw new Error("SABA_ESPORTS_BROWSER_UNAVAILABLE");
    }
  }

  #captureSockets(page: Page, snapshots: Map<string, readonly Readonly<Record<string, unknown>>[]>): void {
    let socketIndex = 0;
    page.on("websocket", (socket) => {
      socketIndex += 1;
      const socketKey = socketIndex;
      const decoder = new SabaPushDecoder();
      socket.on("framereceived", (event) => {
        try {
          const frame = parseSabaSocketFrame(event.payload);
          if (frame === null) return;
          const applied = decoder.apply(frame);
          snapshots.set(`${socketKey}:${frame.bridgeId}`, applied.records);
        } catch {
          // A malformed or unrelated channel is quarantined independently.
        }
      });
    });
  }

  async #waitForCatalog(session: OpenSession): Promise<readonly Readonly<Record<string, unknown>>[]> {
    const deadline = Date.now() + this.#timeoutMs;
    while (Date.now() < deadline) {
      const records = [...session.snapshots.values()].flat();
      const normalized = normalizeSabaLolRecords(records, {
        observedAtMs: Date.now(), receivedMonotonicMs: performance.now(), sequence: 1
      });
      if (normalized.events.length > 0 && normalized.markets.length > 0) return records;
      await session.page.waitForTimeout(100);
    }
    throw new Error("SABA_ESPORTS_CATALOG_UNAVAILABLE");
  }
}
