import { createHash } from "node:crypto";
import { join } from "node:path";
import { normalizeSabaFootballRecords } from "@tool-chenh/adapters";
import { chromium, type BrowserContext, type Page, type WebSocket } from "playwright";
import { clickSafeStructuralCategory, findCmdCatalogPage } from "../browser-protocol-inspector.js";
import { validateCmdLaunchUrl } from "../cmd/cmd-browser-manager.js";
import { SabaPushDecoder } from "./saba-push-decoder.js";
import { parseSabaSocketFrame } from "./saba-socket-frame.js";

interface OpenSession {
  readonly context: BrowserContext;
  readonly page: Page;
  readonly snapshots: Map<string, readonly Readonly<Record<string, unknown>>[]>;
}

export class PlaywrightSabaFootballPushBrowserManager {
  readonly #profilesRoot: string;
  readonly #headless: boolean;
  readonly #timeoutMs: number;
  readonly #sessions = new Map<string, OpenSession>();
  readonly #opening = new Map<string, Promise<OpenSession>>();
  readonly #reading = new Map<string, Promise<readonly Readonly<Record<string, unknown>>[]>>();

  constructor(options: { readonly profilesRoot: string; readonly headless?: boolean; readonly startupTimeoutMs?: number }) {
    if (options.profilesRoot.trim().length === 0) throw new Error("SABA_FOOTBALL_BROWSER_OPTIONS_INVALID");
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
      await this.#invalidate(sessionId);
    }
  }

  async readCatalog(input: {
    readonly sessionId: string;
    readonly launchUrl: string;
  }): Promise<readonly Readonly<Record<string, unknown>>[]> {
    const pending = this.#reading.get(input.sessionId);
    if (pending !== undefined) return pending;
    const operation = this.#readWithRecovery(input).finally(() => this.#reading.delete(input.sessionId));
    this.#reading.set(input.sessionId, operation);
    return operation;
  }

  async close(): Promise<void> {
    const sessions = [...this.#sessions.values()];
    this.#sessions.clear();
    await Promise.allSettled(sessions.map(async (session) => session.context.close()));
  }

  async #readWithRecovery(input: { readonly sessionId: string; readonly launchUrl: string }): Promise<readonly Readonly<Record<string, unknown>>[]> {
    let session = await this.#get(input);
    try {
      return await this.#waitForCatalog(session);
    } catch {
      await this.#invalidate(input.sessionId, session);
      session = await this.#get(input);
      return this.#waitForCatalog(session);
    }
  }

  async #get(input: { readonly sessionId: string; readonly launchUrl: string }): Promise<OpenSession> {
    const current = this.#sessions.get(input.sessionId);
    if (current !== undefined && !current.page.isClosed()) return current;
    const pending = this.#opening.get(input.sessionId);
    if (pending !== undefined) return pending;
    const operation = this.#open(input).finally(() => this.#opening.delete(input.sessionId));
    this.#opening.set(input.sessionId, operation);
    return operation;
  }

  async #open(input: { readonly sessionId: string; readonly launchUrl: string }): Promise<OpenSession> {
    const launchUrl = validateCmdLaunchUrl(input.launchUrl);
    const profile = `saba-football-push-${createHash("sha256").update(input.sessionId).digest("hex").slice(0, 24)}`;
    const context = await chromium.launchPersistentContext(join(this.#profilesRoot, profile), {
      headless: this.#headless, acceptDownloads: false
    });
    const snapshots = new Map<string, readonly Readonly<Record<string, unknown>>[]>();
    let socketGeneration = 0;
    const attachSocket = (socket: WebSocket): void => {
      socketGeneration += 1;
      const generation = socketGeneration;
      // A reconnect must not mix an old snapshot with deltas from a new socket.
      snapshots.clear();
      const decoder = new SabaPushDecoder();
      socket.on("framereceived", (event) => {
        let frame = null;
        try {
          frame = parseSabaSocketFrame(event.payload);
          if (frame === null) return;
          const applied = decoder.apply(frame);
          snapshots.set(`${generation}:${frame.bridgeId}`, applied.records);
        } catch {
          // Never keep publishing stale values from a channel after a malformed
          // frame or sequence gap. Other independently valid channels survive.
          if (frame !== null) snapshots.delete(`${generation}:${frame.bridgeId}`);
        }
      });
    };
    const attachPage = (page: Page): void => { page.on("websocket", attachSocket); };
    context.pages().forEach(attachPage);
    context.on("page", attachPage);
    try {
      let page = context.pages()[0] ?? await context.newPage();
      await page.goto(launchUrl, { waitUntil: "domcontentloaded", timeout: this.#timeoutMs });
      await page.waitForTimeout(1_500);
      page = await findCmdCatalogPage(context.pages()) ?? page;
      await clickSafeStructuralCategory(page, "1", 0).catch(() => false);
      const session = { context, page, snapshots };
      this.#sessions.set(input.sessionId, session);
      return session;
    } catch {
      await context.close().catch(() => undefined);
      throw new Error("SABA_FOOTBALL_BROWSER_UNAVAILABLE");
    }
  }

  async #waitForCatalog(session: OpenSession): Promise<readonly Readonly<Record<string, unknown>>[]> {
    const deadline = Date.now() + this.#timeoutMs;
    while (Date.now() < deadline) {
      const records = [...session.snapshots.values()].flat();
      const normalized = normalizeSabaFootballRecords(records, {
        observedAtMs: Date.now(), receivedMonotonicMs: performance.now(), sequence: 1
      });
      if (normalized.events.length > 0 && normalized.markets.length > 0) return records;
      await session.page.waitForTimeout(50);
    }
    throw new Error("SABA_FOOTBALL_CATALOG_UNAVAILABLE");
  }

  async #invalidate(sessionId: string, expected?: OpenSession): Promise<void> {
    const current = this.#sessions.get(sessionId);
    if (current === undefined || (expected !== undefined && current !== expected)) return;
    this.#sessions.delete(sessionId);
    await current.context.close().catch(() => undefined);
  }
}
